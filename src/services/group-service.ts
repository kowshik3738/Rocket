import { arrayRemove, arrayUnion, collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, Timestamp, updateDoc, where } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { ChatFile } from '@/services/messaging-service';
import { getFriends } from '@/services/social-service';
import { getUserProfile, UserProfile } from '@/services/user-service';

export const MAX_GROUP_MEMBERS = 30;
export const MAX_GROUP_NAME_LENGTH = 60;

export type Group = { id: string; name: string; createdBy: string; createdAt: Timestamp | null; updatedAt: Timestamp | null; memberIds: string[]; adminIds: string[]; lastMessage: string | null; lastMessageAt: Timestamp | null; lastMessageSenderId: string | null };
export type GroupMessage = { id: string; senderId: string; text: string; imageUrl: string | null; videoUrl: string | null; fileUrl: string | null; fileName: string | null; fileSize: number | null; fileMimeType: string | null; createdAt: Timestamp | null };

function mapGroup(id: string, data: Record<string, unknown>): Group {
  return { id, name: data.name as string, createdBy: data.createdBy as string, createdAt: data.createdAt as Timestamp ?? null, updatedAt: data.updatedAt as Timestamp ?? null, memberIds: data.memberIds as string[], adminIds: data.adminIds as string[], lastMessage: data.lastMessage as string ?? null, lastMessageAt: data.lastMessageAt as Timestamp ?? null, lastMessageSenderId: data.lastMessageSenderId as string ?? null };
}
function cleanName(name: string) { return name.trim().replace(/\s+/g, ' '); }
function assertName(name: string) { if (!name || name.length > MAX_GROUP_NAME_LENGTH) throw new Error(`Group names must be 1 to ${MAX_GROUP_NAME_LENGTH} characters.`); }
function assertAttachment(text: string, imageUrl?: string | null, videoUrl?: string | null, file?: ChatFile | null) {
  if (!text && !imageUrl && !videoUrl && !file) throw new Error('Write a message or add an attachment.');
  if ([imageUrl, videoUrl, file].filter(Boolean).length > 1) throw new Error('A message can contain only one attachment.');
  if ((imageUrl && !/^https:\/\//.test(imageUrl)) || (videoUrl && !/^https:\/\//.test(videoUrl)) || (file && (!/^https:\/\//.test(file.fileUrl) || !file.fileName.trim()))) throw new Error('The selected attachment is invalid.');
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
export async function getGroup(groupId: string, uid: string): Promise<Group> {
  const snapshot = await getDoc(doc(db, 'groups', groupId));
  if (!snapshot.exists()) throw new Error('This group could not be found.');
  const group = mapGroup(snapshot.id, snapshot.data());
  if (!group.memberIds.includes(uid)) throw new Error('You are not a member of this group.');
  return group;
}
export function subscribeToGroupMessages(groupId: string, onChange: (messages: GroupMessage[]) => void, onError: (error: Error) => void) {
  return onSnapshot(query(collection(db, 'groups', groupId, 'messages'), orderBy('createdAt', 'desc'), limit(200)), (snapshot) => onChange(snapshot.docs.map((item) => { const data = item.data(); return { id: item.id, senderId: data.senderId, text: data.text, imageUrl: data.imageUrl ?? null, videoUrl: data.videoUrl ?? null, fileUrl: data.fileUrl ?? null, fileName: data.fileName ?? null, fileSize: data.fileSize ?? null, fileMimeType: data.fileMimeType ?? null, createdAt: data.createdAt ?? null }; }).reverse()), onError);
}
export async function sendGroupMessage(group: Group, senderId: string, text: string, imageUrl?: string | null, videoUrl?: string | null, file?: ChatFile | null) {
  const clean = text.trim(); assertAttachment(clean, imageUrl, videoUrl, file);
  if (!group.memberIds.includes(senderId)) throw new Error('You are no longer a member of this group.');
  const groupRef = doc(db, 'groups', group.id); const messageRef = doc(collection(db, 'groups', group.id, 'messages'));
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(groupRef);
    if (!current.exists() || !(current.data().memberIds as string[]).includes(senderId)) throw new Error('You are no longer a member of this group.');
    transaction.set(messageRef, { senderId, text: clean, ...(imageUrl ? { imageUrl } : {}), ...(videoUrl ? { videoUrl } : {}), ...(file ? { fileUrl: file.fileUrl, fileName: file.fileName, ...(file.fileSize != null ? { fileSize: file.fileSize } : {}), ...(file.fileMimeType ? { fileMimeType: file.fileMimeType } : {}) } : {}), createdAt: serverTimestamp() });
    transaction.update(groupRef, { lastMessage: imageUrl ? 'Photo' : videoUrl ? 'Video' : file ? `File: ${file.fileName}` : clean, lastMessageAt: serverTimestamp(), lastMessageSenderId: senderId, updatedAt: serverTimestamp() });
  });
}
export async function getGroupProfiles(memberIds: string[]): Promise<Record<string, UserProfile>> { const profiles = await Promise.all(memberIds.map((uid) => getUserProfile(uid))); return profiles.reduce<Record<string, UserProfile>>((result, profile) => { if (profile) result[profile.uid] = profile; return result; }, {}); }
export async function renameGroup(group: Group, uid: string, name: string) { const clean = cleanName(name); assertName(clean); if (!group.adminIds.includes(uid)) throw new Error('Only group admins can rename this group.'); await updateDoc(doc(db, 'groups', group.id), { name: clean, updatedAt: serverTimestamp() }); }
export async function addGroupMember(group: Group, uid: string, friendId: string) { if (!group.adminIds.includes(uid)) throw new Error('Only group admins can add members.'); if (group.memberIds.includes(friendId)) return; if (group.memberIds.length >= MAX_GROUP_MEMBERS) throw new Error(`Groups can have at most ${MAX_GROUP_MEMBERS} members.`); const friends = await getFriends(uid); if (!friends.some((friend) => friend.uid === friendId)) throw new Error('You can only add your accepted friends.'); await updateDoc(doc(db, 'groups', group.id), { memberIds: arrayUnion(friendId), updatedAt: serverTimestamp() }); }
export async function removeGroupMember(group: Group, uid: string, memberId: string) { if (!group.adminIds.includes(uid)) throw new Error('Only group admins can remove members.'); if (memberId === uid) throw new Error('Use Leave group to remove yourself.'); if (group.adminIds.includes(memberId)) throw new Error('Transfer admin access before removing an admin.'); await updateDoc(doc(db, 'groups', group.id), { memberIds: arrayRemove(memberId), updatedAt: serverTimestamp() }); }
export async function leaveGroup(group: Group, uid: string) { if (!group.memberIds.includes(uid)) return; if (group.adminIds.includes(uid)) throw new Error('Admins cannot leave until another admin is assigned (admin transfer is not available yet).'); await updateDoc(doc(db, 'groups', group.id), { memberIds: arrayRemove(uid), updatedAt: serverTimestamp() }); }
export async function getEligibleFriends(uid: string, memberIds: string[]) { return (await getFriends(uid)).filter((friend) => !memberIds.includes(friend.uid)); }
