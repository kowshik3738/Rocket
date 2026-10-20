import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';

export type ChatType = 'direct' | 'group';

export interface ChatPreference {
  chatId: string;
  chatType: ChatType;
  ownerUid: string;
  pinned: boolean;
  pinnedAt: Timestamp | null;
  archived: boolean;
  archivedAt: Timestamp | null;
  muted: boolean;
  mutedAt: Timestamp | null;
  deleted: boolean;
  deletedAt: Timestamp | null;
  mutedStories?: boolean;
  mutedStoriesAt?: Timestamp | null;
  createdAt?: Timestamp | null;
  updatedAt: Timestamp | null;
}

export type ChatPreferencesMap = Record<string, ChatPreference>;

export const MAX_PINNED_CHATS = 5;

/**
 * Returns the effective chat preference state with safe defaults for
 * unconfigured or legacy chats.
 */
export function getChatPreference(
  preferences: ChatPreferencesMap,
  chatId: string
): { pinned: boolean; archived: boolean; muted: boolean; deleted: boolean } {
  const pref = preferences[chatId];
  return {
    pinned: pref?.pinned ?? false,
    archived: pref?.archived ?? false,
    muted: pref?.muted ?? false,
    deleted: pref?.deleted ?? false,
  };
}

/**
 * Subscribes to the authenticated user's private chat preferences collection.
 * Uses a single listener for the entire user preference collection (zero N+1 listeners).
 */
export function subscribeToChatPreferences(
  uid: string,
  onChange: (preferences: ChatPreferencesMap) => void,
  onError?: (error: Error) => void
): () => void {
  if (!uid) {
    onChange({});
    return () => undefined;
  }

  const colRef = collection(db, 'users', uid, 'chatPreferences');

  return onSnapshot(
    colRef,
    (snapshot) => {
      const prefs: ChatPreferencesMap = {};
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        prefs[docSnap.id] = {
          chatId: docSnap.id,
          chatType: (data.chatType as ChatType) || 'direct',
          ownerUid: (data.ownerUid as string) || uid,
          pinned: Boolean(data.pinned),
          pinnedAt: (data.pinnedAt as Timestamp) || null,
          archived: Boolean(data.archived),
          archivedAt: (data.archivedAt as Timestamp) || null,
          muted: Boolean(data.muted),
          mutedAt: (data.mutedAt as Timestamp) || null,
          deleted: Boolean(data.deleted),
          deletedAt: (data.deletedAt as Timestamp) || null,
          createdAt: (data.createdAt as Timestamp) || null,
          updatedAt: (data.updatedAt as Timestamp) || null,
        };
      });
      onChange(prefs);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

/**
 * Updates a chat preference document atomically.
 * Ensures schema completeness for both create and update operations.
 */
export async function updateChatPreference(
  uid: string,
  chatId: string,
  chatType: ChatType,
  updates: { pinned?: boolean; archived?: boolean; muted?: boolean; deleted?: boolean; mutedStories?: boolean }
): Promise<void> {
  if (!uid || !chatId) {
    throw new Error('User ID and Chat ID are required to update chat preferences.');
  }

  const docRef = doc(db, 'users', uid, 'chatPreferences', chatId);

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(docRef);
    const existing = snap.exists() ? (snap.data() as Partial<ChatPreference>) : null;

    const pinned = updates.pinned !== undefined ? updates.pinned : Boolean(existing?.pinned);
    const archived = updates.archived !== undefined ? updates.archived : Boolean(existing?.archived);
    const muted = updates.muted !== undefined ? updates.muted : Boolean(existing?.muted);
    const deleted = updates.deleted !== undefined ? updates.deleted : Boolean(existing?.deleted);
    const mutedStories = updates.mutedStories !== undefined ? updates.mutedStories : Boolean(existing?.mutedStories);

    const data: Record<string, unknown> = {
      chatId,
      chatType,
      ownerUid: uid,
      pinned,
      pinnedAt:
        updates.pinned !== undefined
          ? updates.pinned
            ? serverTimestamp()
            : null
          : existing?.pinnedAt ?? null,
      archived,
      archivedAt:
        updates.archived !== undefined
          ? updates.archived
            ? serverTimestamp()
            : null
          : existing?.archivedAt ?? null,
      muted,
      mutedAt:
        updates.muted !== undefined
          ? updates.muted
            ? serverTimestamp()
            : null
          : existing?.mutedAt ?? null,
      deleted,
      deletedAt:
        updates.deleted !== undefined
          ? updates.deleted
            ? serverTimestamp()
            : null
          : existing?.deletedAt ?? null,
      mutedStories,
      mutedStoriesAt:
        updates.mutedStories !== undefined
          ? updates.mutedStories
            ? serverTimestamp()
            : null
          : existing?.mutedStoriesAt ?? null,
      updatedAt: serverTimestamp(),
    };

    if (!existing) {
      data.createdAt = serverTimestamp();
    }

    transaction.set(docRef, data, { merge: true });
  });
}

export async function setChatPinned(
  uid: string,
  chatId: string,
  chatType: ChatType,
  pinned: boolean,
  currentPinnedCount = 0
): Promise<void> {
  if (pinned && currentPinnedCount >= MAX_PINNED_CHATS) {
    throw new Error(`You can pin up to ${MAX_PINNED_CHATS} chats.`);
  }
  return updateChatPreference(uid, chatId, chatType, { pinned });
}

export async function setChatArchived(
  uid: string,
  chatId: string,
  chatType: ChatType,
  archived: boolean
): Promise<void> {
  return updateChatPreference(uid, chatId, chatType, { archived });
}

export async function setChatMuted(
  uid: string,
  chatId: string,
  chatType: ChatType,
  muted: boolean
): Promise<void> {
  return updateChatPreference(uid, chatId, chatType, { muted });
}

export async function deleteChatForUser(
  uid: string,
  chatId: string,
  chatType: ChatType,
): Promise<void> {
  if (!uid || !chatId) {
    throw new Error('User ID and Chat ID are required to delete a chat.');
  }

  return updateChatPreference(uid, chatId, chatType, {
    pinned: false,
    archived: true,
    muted: false,
    deleted: true,
  });
}

export async function setStoriesMuted(
  uid: string,
  authorUid: string,
  mutedStories: boolean
): Promise<void> {
  return updateChatPreference(uid, authorUid, 'direct', { mutedStories });
}
