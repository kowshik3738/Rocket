import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    query,
    runTransaction,
    serverTimestamp,
    Timestamp,
    updateDoc,
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
    if (outgoing.exists() && outgoing.data().status === 'pending') {
      throw new Error('Friend request already sent.');
    }
    if (incoming.exists() && incoming.data().status === 'pending') {
      throw new Error('This person has already sent you a friend request.');
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
  if (request.recipientId !== currentUid || request.status !== 'pending') {
    throw new Error('This friend request cannot be accepted.');
  }

  const requestRef = doc(db, 'friendRequests', request.id);
  const friendshipRef = doc(db, 'friendships', friendshipId(request.senderId, request.recipientId));
  const senderFriendRef = doc(db, 'userFriends', `${request.senderId}_${request.recipientId}`);
  const recipientFriendRef = doc(db, 'userFriends', `${request.recipientId}_${request.senderId}`);

  try {
    await runTransaction(db, async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);
    const friendshipSnapshot = await transaction.get(friendshipRef);
    if (!requestSnapshot.exists() || requestSnapshot.data().status !== 'pending') {
      throw new Error('This friend request is no longer pending.');
    }
    if (friendshipSnapshot.exists()) {
      throw new Error('You are already friends.');
    }

    transaction.update(requestRef, { status: 'accepted', acceptedAt: serverTimestamp() });
    transaction.set(friendshipRef, {
      userA: request.senderId,
      userB: request.recipientId,
      requestId: request.id,
      createdAt: serverTimestamp(),
    });
    transaction.set(senderFriendRef, {
      ownerId: request.senderId,
      friendId: request.recipientId,
      requestId: request.id,
      createdAt: serverTimestamp(),
    });
    transaction.set(recipientFriendRef, {
      ownerId: request.recipientId,
      friendId: request.senderId,
      requestId: request.id,
      createdAt: serverTimestamp(),
    });
    });
  } catch (error) {
    throw error;
  }
}

export async function declineFriendRequest(request: FriendRequest, currentUid: string): Promise<void> {
  if (request.recipientId !== currentUid || request.status !== 'pending') {
    throw new Error('This friend request cannot be declined.');
  }
  await updateDoc(doc(db, 'friendRequests', request.id), {
    status: 'declined',
    declinedAt: serverTimestamp(),
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
