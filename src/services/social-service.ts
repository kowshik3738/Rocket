import {
  collection,
  deleteDoc,
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
export type RelationshipStatus = 'add' | 'sent' | 'incoming' | 'friends' | 'blocked';

export type UserBlock = {
  id: string;
  blockerUid: string;
  blockedUid: string;
  createdAt: Timestamp | null;
};

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

function blockId(blockerUid: string, blockedUid: string) {
  return `${blockerUid}_${blockedUid}`;
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

export async function getBlockedUids(currentUid: string): Promise<string[]> {
  try {
    const blocksQuery = query(
      collection(db, 'userBlocks'),
      where('blockerUid', '==', currentUid),
      limit(100),
    );
    const snapshot = await getDocs(blocksQuery);
    return snapshot.docs.map((blockDoc) => blockDoc.data().blockedUid as string);
  } catch {
    return [];
  }
}

export async function getBlockedUsers(currentUid: string): Promise<UserProfile[]> {
  const uids = await getBlockedUids(currentUid);
  const profiles = await Promise.all(uids.map((uid) => getUserProfile(uid)));
  return profiles.filter((profile): profile is UserProfile => profile !== null);
}

export async function isUserBlocked(currentUid: string, targetUid: string): Promise<boolean> {
  try {
    const blockRef = doc(db, 'userBlocks', blockId(currentUid, targetUid));
    const snapshot = await getDoc(blockRef);
    return snapshot.exists();
  } catch {
    return false;
  }
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
    const [snapshot, blockedUids] = await Promise.all([
      getDocs(usersQuery),
      getBlockedUids(currentUid),
    ]);
    const blockedSet = new Set(blockedUids);
    const profiles = snapshot.docs
      .map(profileFromSnapshot)
      .filter((profile) => profile.uid !== currentUid && !blockedSet.has(profile.uid));
    return profiles;
  } catch (error) {
    throw error;
  }
}

export async function getRelationshipStatus(currentUid: string, otherUid: string): Promise<RelationshipStatus> {
  const [friendshipSnapshot, blockSnapshot] = await Promise.all([
    getDoc(doc(db, 'friendships', friendshipId(currentUid, otherUid))),
    getDoc(doc(db, 'userBlocks', blockId(currentUid, otherUid))),
  ]);
  if (blockSnapshot.exists()) {
    return 'blocked';
  }
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
  const blockRef = doc(db, 'userBlocks', blockId(senderId, recipientId));

  await runTransaction(db, async (transaction) => {
    const [outgoing, incoming, friendship, block] = await Promise.all([
      transaction.get(outgoingRef),
      transaction.get(incomingRef),
      transaction.get(friendshipRef),
      transaction.get(blockRef),
    ]);
    if (block.exists()) {
      throw new Error('You have blocked this user. Unblock them first to send a friend request.');
    }
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
      const blockRef = doc(db, 'userBlocks', blockId(currentUid, senderId));
      const [friendshipSnapshot, blockSnapshot] = await Promise.all([
        transaction.get(friendshipRef),
        transaction.get(blockRef),
      ]);
      if (blockSnapshot.exists()) {
        throw new Error('You have blocked this user.');
      }
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

export async function blockUser(currentUid: string, targetUid: string): Promise<void> {
  if (currentUid === targetUid) {
    throw new Error('You cannot block yourself.');
  }

  const targetBlockRef = doc(db, 'userBlocks', blockId(currentUid, targetUid));
  const friendshipRef = doc(db, 'friendships', friendshipId(currentUid, targetUid));
  const outgoingRequestRef = doc(db, 'friendRequests', requestId(currentUid, targetUid));
  const incomingRequestRef = doc(db, 'friendRequests', requestId(targetUid, currentUid));
  const currentUserEdgeRef = doc(db, 'userFriends', `${currentUid}_${targetUid}`);
  const otherUserEdgeRef = doc(db, 'userFriends', `${targetUid}_${currentUid}`);

  await runTransaction(db, async (transaction) => {
    const [
      blockSnapshot,
      friendshipSnapshot,
      outgoingRequestSnapshot,
      incomingRequestSnapshot,
      currentUserEdgeSnapshot,
      otherUserEdgeSnapshot,
    ] = await Promise.all([
      transaction.get(targetBlockRef),
      transaction.get(friendshipRef),
      transaction.get(outgoingRequestRef),
      transaction.get(incomingRequestRef),
      transaction.get(currentUserEdgeRef),
      transaction.get(otherUserEdgeRef),
    ]);

    if (blockSnapshot.exists()) {
      return;
    }

    let linkedRequestRef = outgoingRequestRef;
    let linkedRequestSnapshot = outgoingRequestSnapshot;

    if (friendshipSnapshot.exists()) {
      const linkedRequestId = friendshipSnapshot.data().requestId;
      if (typeof linkedRequestId !== 'string') {
        throw new Error('This friendship is no longer valid.');
      }
      linkedRequestRef = doc(db, 'friendRequests', linkedRequestId);
      linkedRequestSnapshot = linkedRequestId === outgoingRequestRef.id
        ? outgoingRequestSnapshot
        : linkedRequestId === incomingRequestRef.id
          ? incomingRequestSnapshot
          : await transaction.get(linkedRequestRef);
    } else if (incomingRequestSnapshot.exists() && incomingRequestSnapshot.data().status === 'accepted') {
      linkedRequestRef = incomingRequestRef;
      linkedRequestSnapshot = incomingRequestSnapshot;
    }

    if (linkedRequestSnapshot.exists() && linkedRequestSnapshot.data().status === 'accepted') {
      transaction.update(linkedRequestRef, {
        status: 'declined',
        acceptedAt: deleteField(),
        declinedAt: serverTimestamp(),
      });
      if (friendshipSnapshot.exists()) transaction.delete(friendshipRef);
      if (currentUserEdgeSnapshot.exists()) transaction.delete(currentUserEdgeRef);
      if (otherUserEdgeSnapshot.exists()) transaction.delete(otherUserEdgeRef);
    } else {
      if (friendshipSnapshot.exists()) transaction.delete(friendshipRef);
      if (currentUserEdgeSnapshot.exists()) transaction.delete(currentUserEdgeRef);
      if (otherUserEdgeSnapshot.exists()) transaction.delete(otherUserEdgeRef);
    }

    if (outgoingRequestSnapshot.exists() && outgoingRequestSnapshot.data().status === 'pending') {
      transaction.update(outgoingRequestRef, {
        status: 'declined',
        declinedAt: serverTimestamp(),
      });
    }

    if (incomingRequestSnapshot.exists() && incomingRequestSnapshot.data().status === 'pending') {
      transaction.update(incomingRequestRef, {
        status: 'declined',
        declinedAt: serverTimestamp(),
      });
    }

    transaction.set(targetBlockRef, {
      blockerUid: currentUid,
      blockedUid: targetUid,
      createdAt: serverTimestamp(),
    });
  });
}

export async function unblockUser(currentUid: string, targetUid: string): Promise<void> {
  if (currentUid === targetUid) {
    throw new Error('You cannot unblock yourself.');
  }

  const targetBlockRef = doc(db, 'userBlocks', blockId(currentUid, targetUid));
  await deleteDoc(targetBlockRef);
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
