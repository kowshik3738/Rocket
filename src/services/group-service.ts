import { arrayRemove, arrayUnion, collection, doc, documentId, getDoc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, startAfter, Timestamp, updateDoc, where } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { isValidCoordinates, LiveLocation, LiveLocationDuration, liveLocationManager } from '@/services/location-service';
import { ChatFile } from '@/services/messaging-service';
import { dispatchPushNotification } from '@/services/notification-service';
import { getFriends } from '@/services/social-service';
import { getUserProfile, UserProfile } from '@/services/user-service';

export const MAX_GROUP_MEMBERS = 30;
export const MAX_GROUP_NAME_LENGTH = 60;

export type Group = { id: string; name: string; createdBy: string; createdAt: Timestamp | null; updatedAt: Timestamp | null; memberIds: string[]; adminIds: string[]; lastMessage: string | null; lastMessageAt: Timestamp | null; lastMessageSenderId: string | null };
export type GroupMessage = { id: string; senderId: string; text: string; imageUrl: string | null; videoUrl: string | null; fileUrl: string | null; fileName: string | null; fileSize: number | null; fileMimeType: string | null; createdAt: Timestamp | null; forwarded?: boolean | null; location?: { latitude: number; longitude: number } | null; locationType?: 'current' | 'live' | null; liveLocationShareId?: string | null; audioUrl?: string | null; audioDurationMs?: number | null; audioMimeType?: string | null; };

function mapGroup(id: string, data: Record<string, unknown>): Group {
  return { id, name: data.name as string, createdBy: data.createdBy as string, createdAt: data.createdAt as Timestamp ?? null, updatedAt: data.updatedAt as Timestamp ?? null, memberIds: data.memberIds as string[], adminIds: data.adminIds as string[], lastMessage: data.lastMessage as string ?? null, lastMessageAt: data.lastMessageAt as Timestamp ?? null, lastMessageSenderId: data.lastMessageSenderId as string ?? null };
}
function cleanName(name: string) { return name.trim().replace(/\s+/g, ' '); }
function assertName(name: string) { if (!name || name.length > MAX_GROUP_NAME_LENGTH) throw new Error(`Group names must be 1 to ${MAX_GROUP_NAME_LENGTH} characters.`); }
function assertAttachment(text: string, imageUrl?: string | null, videoUrl?: string | null, file?: ChatFile | null, audioUrl?: string | null) {
  if (!text && !imageUrl && !videoUrl && !file && !audioUrl) throw new Error('Write a message or add an attachment.');
  if ([imageUrl, videoUrl, file, audioUrl].filter(Boolean).length > 1) throw new Error('A message can contain only one attachment.');
  if ((imageUrl && !/^https:\/\//.test(imageUrl)) || (videoUrl && !/^https:\/\//.test(videoUrl)) || (file && (!/^https:\/\//.test(file.fileUrl) || !file.fileName.trim())) || (audioUrl && !/^https:\/\//.test(audioUrl))) throw new Error('The selected attachment is invalid.');
}

export async function createGroup(creatorId: string, name: string, selectedFriendIds: string[]): Promise<string> {
  const clean = cleanName(name); assertName(clean);
  const memberIds = Array.from(new Set([creatorId, ...selectedFriendIds]));
  if (memberIds.length < 2) throw new Error('Choose at least one friend to create a group.');
  if (memberIds.length > MAX_GROUP_MEMBERS) throw new Error(`Groups can have at most ${MAX_GROUP_MEMBERS} members.`);
  const friends = await getFriends(creatorId);
  const friendIds = new Set(friends.map((friend) => friend.uid));
  if (selectedFriendIds.some((uid) => uid === creatorId || !friendIds.has(uid))) throw new Error('Groups can only include your accepted friends.');
  const ref = doc(collection(db, 'groups'));
  await runTransaction(db, async (transaction) => {
    transaction.set(ref, { name: clean, createdBy: creatorId, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), memberIds, adminIds: [creatorId], lastMessage: null, lastMessageAt: null, lastMessageSenderId: null });
  });
  return ref.id;
}

export function subscribeToGroups(uid: string, onChange: (groups: Group[]) => void, onError: (error: Error) => void) {
  return onSnapshot(query(collection(db, 'groups'), where('memberIds', 'array-contains', uid), limit(100)), (snapshot) => onChange(snapshot.docs.map((item) => mapGroup(item.id, item.data())).sort((a, b) => (b.lastMessageAt?.toMillis() ?? 0) - (a.lastMessageAt?.toMillis() ?? 0))), onError);
}
export async function getGroups(uid: string): Promise<Group[]> {
  const snapshot = await getDocs(query(collection(db, 'groups'), where('memberIds', 'array-contains', uid), limit(100)));
  return snapshot.docs.map((item) => mapGroup(item.id, item.data())).sort((a, b) => (b.lastMessageAt?.toMillis() ?? 0) - (a.lastMessageAt?.toMillis() ?? 0));
}
export async function getGroup(groupId: string, uid: string): Promise<Group> {
  const snapshot = await getDoc(doc(db, 'groups', groupId));
  if (!snapshot.exists()) throw new Error('This group could not be found.');
  const group = mapGroup(snapshot.id, snapshot.data());
  if (!group.memberIds.includes(uid)) throw new Error('You are not a member of this group.');
  return group;
}
export function subscribeToGroupMessages(groupId: string, onChange: (messages: GroupMessage[]) => void, onError: (error: Error) => void) {
  return onSnapshot(query(collection(db, 'groups', groupId, 'messages'), orderBy('createdAt', 'desc'), limit(200)), (snapshot) => onChange(snapshot.docs.map((item) => { const data = item.data(); return { id: item.id, senderId: data.senderId, text: data.text, imageUrl: data.imageUrl ?? null, videoUrl: data.videoUrl ?? null, fileUrl: data.fileUrl ?? null, fileName: data.fileName ?? null, fileSize: data.fileSize ?? null, fileMimeType: data.fileMimeType ?? null, createdAt: data.createdAt ?? null, forwarded: data.forwarded === true, location: (data.location as { latitude: number; longitude: number } | undefined) ?? null, locationType: (data.locationType as 'current' | 'live' | undefined) ?? null, liveLocationShareId: (data.liveLocationShareId as string | undefined) ?? null, audioUrl: data.audioUrl ?? null, audioDurationMs: data.audioDurationMs ?? null, audioMimeType: data.audioMimeType ?? null }; }).reverse()), onError);
}
export async function getOlderGroupMessages(
  groupId: string,
  oldestCreatedAt: Timestamp,
  oldestMessageId?: string | null,
  pageSize = 50
): Promise<GroupMessage[]> {
  const olderQuery = oldestMessageId
    ? query(
        collection(db, 'groups', groupId, 'messages'),
        orderBy('createdAt', 'desc'),
        orderBy(documentId(), 'desc'),
        startAfter(oldestCreatedAt, oldestMessageId),
        limit(pageSize)
      )
    : query(
        collection(db, 'groups', groupId, 'messages'),
        orderBy('createdAt', 'desc'),
        startAfter(oldestCreatedAt),
        limit(pageSize)
      );
  const snapshot = await getDocs(olderQuery);
  return snapshot.docs.map((item) => { const data = item.data(); return { id: item.id, senderId: data.senderId, text: data.text, imageUrl: data.imageUrl ?? null, videoUrl: data.videoUrl ?? null, fileUrl: data.fileUrl ?? null, fileName: data.fileName ?? null, fileSize: data.fileSize ?? null, fileMimeType: data.fileMimeType ?? null, createdAt: data.createdAt ?? null, forwarded: data.forwarded === true, location: (data.location as { latitude: number; longitude: number } | undefined) ?? null, locationType: (data.locationType as 'current' | 'live' | undefined) ?? null, liveLocationShareId: (data.liveLocationShareId as string | undefined) ?? null, audioUrl: data.audioUrl ?? null, audioDurationMs: data.audioDurationMs ?? null, audioMimeType: data.audioMimeType ?? null }; }).reverse();
}
export async function sendGroupMessage(group: Group, senderId: string, text: string, imageUrl?: string | null, videoUrl?: string | null, file?: ChatFile | null, forwarded = false, audioUrl?: string | null, audioDurationMs?: number | null, audioMimeType?: string | null) {
  const clean = text.trim(); assertAttachment(clean, imageUrl, videoUrl, file, audioUrl);
  if (audioUrl) {
    if (audioDurationMs == null || !Number.isInteger(audioDurationMs) || audioDurationMs <= 0 || audioDurationMs > 600000) {
      throw new Error('The voice message duration is invalid.');
    }
  }
  if (!group.memberIds.includes(senderId)) throw new Error('You are no longer a member of this group.');
  const groupRef = doc(db, 'groups', group.id); const messageRef = doc(collection(db, 'groups', group.id, 'messages'));
  let activeMemberIds: string[] = group.memberIds || [];
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(groupRef);
    if (!current.exists() || !(current.data().memberIds as string[]).includes(senderId)) throw new Error('You are no longer a member of this group.');
    activeMemberIds = (current.data().memberIds as string[]) || activeMemberIds;
    transaction.set(messageRef, { senderId, text: clean, ...(imageUrl ? { imageUrl } : {}), ...(videoUrl ? { videoUrl } : {}), ...(file ? { fileUrl: file.fileUrl, fileName: file.fileName, ...(file.fileSize != null ? { fileSize: file.fileSize } : {}), ...(file.fileMimeType ? { fileMimeType: file.fileMimeType } : {}) } : {}), ...(audioUrl ? { audioUrl, audioDurationMs, ...(audioMimeType ? { audioMimeType } : {}) } : {}), ...(forwarded ? { forwarded: true } : {}), createdAt: serverTimestamp() });
    transaction.update(groupRef, { lastMessage: audioUrl ? 'Voice message' : imageUrl ? 'Photo' : videoUrl ? 'Video' : file ? `File: ${file.fileName}` : clean, lastMessageAt: serverTimestamp(), lastMessageSenderId: senderId, updatedAt: serverTimestamp() });
  });

  const recipients = activeMemberIds.filter((id) => id !== senderId);
  for (const recipientUid of recipients) {
    void dispatchPushNotification({
      recipientUid,
      kind: 'group_message',
      data: {
        groupId: group.id,
        messageId: messageRef.id,
      },
    }).catch((err) => {
      console.warn(`[Push] Failed to dispatch group message notification to ${recipientUid}:`, err);
    });
  }
}
export async function getGroupProfiles(memberIds: string[]): Promise<Record<string, UserProfile>> { const profiles = await Promise.all(memberIds.map((uid) => getUserProfile(uid))); return profiles.reduce<Record<string, UserProfile>>((result, profile) => { if (profile) result[profile.uid] = profile; return result; }, {}); }
export async function renameGroup(group: Group, uid: string, name: string) { const clean = cleanName(name); assertName(clean); if (!group.adminIds.includes(uid)) throw new Error('Only group admins can rename this group.'); await updateDoc(doc(db, 'groups', group.id), { name: clean, updatedAt: serverTimestamp() }); }
export async function addGroupMember(group: Group, uid: string, friendId: string) { if (!group.adminIds.includes(uid)) throw new Error('Only group admins can add members.'); if (group.memberIds.includes(friendId)) return; if (group.memberIds.length >= MAX_GROUP_MEMBERS) throw new Error(`Groups can have at most ${MAX_GROUP_MEMBERS} members.`); const friends = await getFriends(uid); if (!friends.some((friend) => friend.uid === friendId)) throw new Error('You can only add your accepted friends.'); await updateDoc(doc(db, 'groups', group.id), { memberIds: arrayUnion(friendId), updatedAt: serverTimestamp() }); }
export async function removeGroupMember(group: Group, uid: string, memberId: string) { if (!group.adminIds.includes(uid)) throw new Error('Only group admins can remove members.'); if (memberId === uid) throw new Error('Use Leave group to remove yourself.'); if (group.adminIds.includes(memberId)) throw new Error('Transfer admin access before removing an admin.'); await updateDoc(doc(db, 'groups', group.id), { memberIds: arrayRemove(memberId), updatedAt: serverTimestamp() }); }
export async function leaveGroup(group: Group, uid: string) { if (!group.memberIds.includes(uid)) return; if (group.adminIds.includes(uid)) throw new Error('Admins cannot leave until another admin is assigned (admin transfer is not available yet).'); await updateDoc(doc(db, 'groups', group.id), { memberIds: arrayRemove(uid), updatedAt: serverTimestamp() }); }
export async function getEligibleFriends(uid: string, memberIds: string[]) { return (await getFriends(uid)).filter((friend) => !memberIds.includes(friend.uid)); }

export async function sendGroupLocationMessage(
  group: Group,
  senderId: string,
  latitude: number,
  longitude: number
): Promise<void> {
  if (!isValidCoordinates(latitude, longitude)) throw new Error('Invalid coordinates.');
  if (!group.memberIds.includes(senderId)) throw new Error('You are no longer a member of this group.');

  const groupRef = doc(db, 'groups', group.id);
  const messageRef = doc(collection(db, 'groups', group.id, 'messages'));
  let activeMemberIds: string[] = group.memberIds || [];

  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(groupRef);
    if (!current.exists() || !(current.data().memberIds as string[]).includes(senderId)) {
      throw new Error('You are no longer a member of this group.');
    }
    activeMemberIds = (current.data().memberIds as string[]) || activeMemberIds;
    transaction.set(messageRef, {
      senderId,
      text: '📍 Location',
      location: { latitude, longitude },
      locationType: 'current',
      createdAt: serverTimestamp(),
    });
    transaction.update(groupRef, {
      lastMessage: 'Location',
      lastMessageAt: serverTimestamp(),
      lastMessageSenderId: senderId,
      updatedAt: serverTimestamp(),
    });
  });

  const recipients = activeMemberIds.filter((id) => id !== senderId);
  for (const recipientUid of recipients) {
    void dispatchPushNotification({
      recipientUid,
      kind: 'group_message',
      data: {
        groupId: group.id,
        messageId: messageRef.id,
      },
    }).catch((err) => {
      console.warn(`[Push] Failed to dispatch group location notification to ${recipientUid}:`, err);
    });
  }
}

export async function startGroupLiveLocation(
  group: Group,
  senderId: string,
  latitude: number,
  longitude: number,
  durationMinutes: LiveLocationDuration
): Promise<string> {
  if (!isValidCoordinates(latitude, longitude)) throw new Error('Invalid coordinates.');
  if (!group.memberIds.includes(senderId)) throw new Error('You are no longer a member of this group.');

  const groupRef = doc(db, 'groups', group.id);
  const messageRef = doc(collection(db, 'groups', group.id, 'messages'));
  const liveLocationRef = doc(collection(db, 'groups', group.id, 'liveLocations'));
  const shareId = liveLocationRef.id;
  let activeMemberIds: string[] = group.memberIds || [];

  const expiresAtMillis = Date.now() + durationMinutes * 60 * 1000;

  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(groupRef);
    if (!current.exists() || !(current.data().memberIds as string[]).includes(senderId)) {
      throw new Error('You are no longer a member of this group.');
    }
    activeMemberIds = (current.data().memberIds as string[]) || activeMemberIds;

    transaction.set(liveLocationRef, {
      ownerId: senderId,
      latitude,
      longitude,
      startedAt: serverTimestamp(),
      durationMinutes,
      expiresAt: Timestamp.fromMillis(expiresAtMillis),
      stoppedAt: null,
      updatedAt: serverTimestamp(),
    });

    transaction.set(messageRef, {
      senderId,
      text: '📡 Live location',
      locationType: 'live',
      liveLocationShareId: shareId,
      createdAt: serverTimestamp(),
    });

    transaction.update(groupRef, {
      lastMessage: 'Live location',
      lastMessageAt: serverTimestamp(),
      lastMessageSenderId: senderId,
      updatedAt: serverTimestamp(),
    });
  });

  const recipients = activeMemberIds.filter((id) => id !== senderId);
  for (const recipientUid of recipients) {
    void dispatchPushNotification({
      recipientUid,
      kind: 'group_message',
      data: {
        groupId: group.id,
        messageId: messageRef.id,
      },
    }).catch((err) => {
      console.warn(`[Push] Failed to dispatch group live location notification to ${recipientUid}:`, err);
    });
  }

  await liveLocationManager.startTracking(
    shareId,
    { latitude, longitude },
    expiresAtMillis,
    async (coords) => {
      await updateGroupLiveLocationCoordinates(group.id, shareId, senderId, coords.latitude, coords.longitude);
    },
    () => {
      // Stopped
    }
  );

  return shareId;
}

export async function updateGroupLiveLocationCoordinates(
  groupId: string,
  shareId: string,
  senderId: string,
  latitude: number,
  longitude: number
): Promise<void> {
  if (!isValidCoordinates(latitude, longitude)) return;
  const liveLocationRef = doc(db, 'groups', groupId, 'liveLocations', shareId);
  await updateDoc(liveLocationRef, {
    latitude,
    longitude,
    updatedAt: serverTimestamp(),
  });
}

export async function stopGroupLiveLocationShare(
  groupId: string,
  shareId: string,
  senderId: string
): Promise<void> {
  const liveLocationRef = doc(db, 'groups', groupId, 'liveLocations', shareId);
  try {
    await updateDoc(liveLocationRef, {
      stoppedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } finally {
    await liveLocationManager.stopTracking(shareId);
  }
}

export function subscribeToGroupLiveLocationDoc(
  groupId: string,
  shareId: string,
  onUpdate: (data: LiveLocation | null) => void,
  onError: (err: Error) => void
): () => void {
  const liveLocationRef = doc(db, 'groups', groupId, 'liveLocations', shareId);
  return onSnapshot(
    liveLocationRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        onUpdate(null);
        return;
      }
      const data = snapshot.data();
      onUpdate({
        id: snapshot.id,
        ownerId: (data.ownerId as string) || '',
        latitude: (data.latitude as number) || 0,
        longitude: (data.longitude as number) || 0,
        durationMinutes: data.durationMinutes as LiveLocationDuration,
        startedAt: data.startedAt ?? null,
        expiresAt: data.expiresAt ?? null,
        stoppedAt: data.stoppedAt ?? null,
        updatedAt: data.updatedAt ?? null,
      });
    },
    onError
  );
}
