import {
    collection,
    deleteField,
    doc,
    getDoc,
    getDocs,
    limit,
    query,
    runTransaction,
    serverTimestamp,
    Timestamp,
    where,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { getUserProfile, UserProfile } from '@/services/user-service';

export type FriendRequestStatus = 'pending' | 'accepted' | 'declined';
export type RelationshipStatus = 'add' | 'sent' | 'incoming' | 'friends';

export type FriendRequest = {
  id: string;
  senderId: string;
  recipientId: string;
  status: FriendRequestStatus;
  createdAt: Timestamp | null;
  sender: UserProfile | null;
};

export type SearchUser = UserProfile & {
  relationship: RelationshipStatus;
};

export type Friend = UserProfile;

function requestId(senderId: string, recipientId: string) {
  return `${senderId}_${recipientId}`;
}

function friendshipId(firstUid: string, secondUid: string) {
  return [firstUid, secondUid].sort().join('_');
}

function profileFromSnapshot(snapshot: { id: string; data: () => Record<string, unknown> }): UserProfile {
  const data = snapshot.data();
  return {
    uid: data.uid as string,
    displayName: data.displayName as string,
    username: data.username as string,
    usernameLower: data.usernameLower as string,
    bio: (data.bio as string | undefined) ?? '',
    createdAt: (data.createdAt as Timestamp | undefined) ?? null,
  };
}

export async function searchUsers(searchTerm: string, currentUid: string): Promise<UserProfile[]> {
  const normalizedSearch = searchTerm.trim().toLowerCase();
  if (!normalizedSearch) {
    return [];
  }

  try {
    const usersQuery = query(
      collection(db, 'users'),
      where('usernameLower', '>=', normalizedSearch),
      where('usernameLower', '<=', `${normalizedSearch}\uf8ff`),
      limit(20),
    );
    const snapshot = await getDocs(usersQuery);
    const profiles = snapshot.docs
      .map(profileFromSnapshot)
      .filter((profile) => profile.uid !== currentUid);
    return profiles;
  } catch (error) {
    throw error;
  }
}

export async function getRelationshipStatus(currentUid: string, otherUid: string): Promise<RelationshipStatus> {
  const friendshipSnapshot = await getDoc(doc(db, 'friendships', friendshipId(currentUid, otherUid)));
  if (friendshipSnapshot.exists()) {
    return 'friends';
  }

  const [outgoingSnapshot, incomingSnapshot] = await Promise.all([
    getDoc(doc(db, 'friendRequests', requestId(currentUid, otherUid))),
    getDoc(doc(db, 'friendRequests', requestId(otherUid, currentUid))),
  ]);
  if (outgoingSnapshot.exists() && outgoingSnapshot.data().status === 'pending') {
    return 'sent';
  }
  if (incomingSnapshot.exists() && incomingSnapshot.data().status === 'pending') {
    return 'incoming';
  }
  return 'add';
}

export async function getSearchUsers(searchTerm: string, currentUid: string): Promise<SearchUser[]> {
  const profiles = await searchUsers(searchTerm, currentUid);
  return Promise.all(profiles.map(async (profile) => ({
    ...profile,
    relationship: await getRelationshipStatus(currentUid, profile.uid),
  })));
}

export async function sendFriendRequest(senderId: string, recipientId: string): Promise<void> {
  if (senderId === recipientId) {
    throw new Error('You cannot send a friend request to yourself.');
  }

  const outgoingRef = doc(db, 'friendRequests', requestId(senderId, recipientId));
  const incomingRef = doc(db, 'friendRequests', requestId(recipientId, senderId));
  const friendshipRef = doc(db, 'friendships', friendshipId(senderId, recipientId));

  await runTransaction(db, async (transaction) => {
    const [outgoing, incoming, friendship] = await Promise.all([
      transaction.get(outgoingRef),
      transaction.get(incomingRef),
      transaction.get(friendshipRef),
    ]);
    if (friendship.exists()) {
      throw new Error('You are already friends.');
    }
    if (incoming.exists() && incoming.data().status === 'pending') {
      throw new Error('This person has already sent you a friend request.');
    }

    if (outgoing.exists()) {
      if (outgoing.data().status === 'pending') {
        throw new Error('Friend request already sent.');
      }
      if (outgoing.data().status === 'declined') {
        transaction.update(outgoingRef, {
          status: 'pending',
          declinedAt: deleteField(),
        });
        return;
      }
      throw new Error('This friend request has already been resolved.');
    }

    transaction.set(outgoingRef, {
      senderId,
      recipientId,
      status: 'pending',
      createdAt: serverTimestamp(),
    });
  });
}

export async function getIncomingFriendRequests(currentUid: string): Promise<FriendRequest[]> {
  const requestsQuery = query(
    collection(db, 'friendRequests'),
    where('recipientId', '==', currentUid),
    limit(50),
  );
  const snapshot = await getDocs(requestsQuery);
  return Promise.all(snapshot.docs.filter((requestSnapshot) => requestSnapshot.data().status === 'pending').map(async (requestSnapshot) => {
    const data = requestSnapshot.data();
    return {
      id: requestSnapshot.id,
      senderId: data.senderId as string,
      recipientId: data.recipientId as string,
      status: data.status as FriendRequestStatus,
      createdAt: (data.createdAt as Timestamp | undefined) ?? null,
      sender: await getUserProfile(data.senderId as string),
    };
  }));
}

export async function acceptFriendRequest(request: FriendRequest, currentUid: string): Promise<void> {
  const requestRef = doc(db, 'friendRequests', request.id);

  try {
    await runTransaction(db, async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists() || requestSnapshot.data().status !== 'pending') {
        throw new Error('This friend request is no longer pending.');
      }

      const senderId = requestSnapshot.data().senderId as string;
      const recipientId = requestSnapshot.data().recipientId as string;
      if (recipientId !== currentUid || senderId === recipientId) {
        throw new Error('This friend request cannot be accepted.');
      }

      const friendshipRef = doc(db, 'friendships', friendshipId(senderId, recipientId));
      const friendshipSnapshot = await transaction.get(friendshipRef);
      if (friendshipSnapshot.exists()) {
        throw new Error('You are already friends.');
      }

      const [userA, userB] = [senderId, recipientId].sort();
      const senderFriendRef = doc(db, 'userFriends', `${senderId}_${recipientId}`);
      const recipientFriendRef = doc(db, 'userFriends', `${recipientId}_${senderId}`);
      transaction.update(requestRef, { status: 'accepted', acceptedAt: serverTimestamp() });
      transaction.set(friendshipRef, {
        userA,
        userB,
        requestId: request.id,
        createdAt: serverTimestamp(),
      });
      transaction.set(senderFriendRef, {
        ownerId: senderId,
        friendId: recipientId,
        requestId: request.id,
        createdAt: serverTimestamp(),
      });
      transaction.set(recipientFriendRef, {
        ownerId: recipientId,
        friendId: senderId,
        requestId: request.id,
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    throw error;
  }
}

export async function unfriend(currentUid: string, otherUid: string): Promise<void> {
  if (currentUid === otherUid) {
    throw new Error('You cannot remove yourself as a friend.');
  }

  const friendshipRef = doc(db, 'friendships', friendshipId(currentUid, otherUid));
  const outgoingRequestRef = doc(db, 'friendRequests', requestId(currentUid, otherUid));
  const incomingRequestRef = doc(db, 'friendRequests', requestId(otherUid, currentUid));
  const currentUserEdgeRef = doc(db, 'userFriends', `${currentUid}_${otherUid}`);
  const otherUserEdgeRef = doc(db, 'userFriends', `${otherUid}_${currentUid}`);

  await runTransaction(db, async (transaction) => {
    const [
      friendshipSnapshot,
      outgoingRequestSnapshot,
      incomingRequestSnapshot,
      currentUserEdgeSnapshot,
      otherUserEdgeSnapshot,
    ] = await Promise.all([
      transaction.get(friendshipRef),
      transaction.get(outgoingRequestRef),
      transaction.get(incomingRequestRef),
      transaction.get(currentUserEdgeRef),
      transaction.get(otherUserEdgeRef),
    ]);

    let requestRef = outgoingRequestRef;
    let requestSnapshot = outgoingRequestSnapshot;
    if (friendshipSnapshot.exists()) {
      const linkedRequestId = friendshipSnapshot.data().requestId;
      if (typeof linkedRequestId !== 'string') {
        throw new Error('This friendship is no longer valid.');
      }
      requestRef = doc(db, 'friendRequests', linkedRequestId);
      requestSnapshot = linkedRequestId === outgoingRequestRef.id
        ? outgoingRequestSnapshot
        : linkedRequestId === incomingRequestRef.id
          ? incomingRequestSnapshot
          : await transaction.get(requestRef);
    } else if (incomingRequestSnapshot.exists() && incomingRequestSnapshot.data().status === 'accepted') {
      requestRef = incomingRequestRef;
      requestSnapshot = incomingRequestSnapshot;
    }

    if (!requestSnapshot.exists() || requestSnapshot.data().status !== 'accepted') {
      // A concurrent unfriend may already have completed. Treat the now-absent
      // relationship as a successful, idempotent result.
      if (!friendshipSnapshot.exists()) return;
      throw new Error('This friendship is no longer active.');
    }

    const request = requestSnapshot.data();
    const matchesParticipants = (request.senderId === currentUid && request.recipientId === otherUid)
      || (request.senderId === otherUid && request.recipientId === currentUid);
    if (!matchesParticipants) {
      throw new Error('This friendship is no longer valid.');
    }

    transaction.update(requestRef, {
      status: 'declined',
      acceptedAt: deleteField(),
      declinedAt: serverTimestamp(),
    });
    if (friendshipSnapshot.exists()) transaction.delete(friendshipRef);
    if (currentUserEdgeSnapshot.exists()) transaction.delete(currentUserEdgeRef);
    if (otherUserEdgeSnapshot.exists()) transaction.delete(otherUserEdgeRef);
  });
}

export async function declineFriendRequest(request: FriendRequest, currentUid: string): Promise<void> {
  const requestRef = doc(db, 'friendRequests', request.id);
  await runTransaction(db, async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);
    if (
      !requestSnapshot.exists()
      || requestSnapshot.data().recipientId !== currentUid
      || requestSnapshot.data().status !== 'pending'
    ) {
      throw new Error('This friend request is no longer pending.');
    }
    transaction.update(requestRef, {
      status: 'declined',
      declinedAt: serverTimestamp(),
    });
  });
}

export async function getFriends(currentUid: string): Promise<Friend[]> {
  const friendsQuery = query(
    collection(db, 'userFriends'),
    where('ownerId', '==', currentUid),
    limit(100),
  );
  const snapshot = await getDocs(friendsQuery);
  const friends = await Promise.all(snapshot.docs.map((friendSnapshot) => getUserProfile(friendSnapshot.data().friendId as string)));
  return friends.filter((friend): friend is UserProfile => friend !== null);
}
