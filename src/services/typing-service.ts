import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';

export type TypingIndicator = {
  uid: string;
  isTyping: boolean;
  updatedAt: Timestamp | null;
};

// Typing indicator considered expired if no update in 6 seconds
export const TYPING_TIMEOUT_MS = 6000;

export async function setTypingState(
  conversationId: string,
  uid: string,
  isTyping: boolean,
): Promise<void> {
  if (!conversationId || !uid) return;
  try {
    const typingRef = doc(db, 'conversations', conversationId, 'typing', uid);
    await setDoc(
      typingRef,
      {
        uid,
        isTyping,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (error) {
    console.warn('[Rocket typing] failed to set typing state', error);
  }
}

export function subscribeToTyping(
  conversationId: string,
  targetUid: string,
  onTypingChange: (isTyping: boolean) => void,
): () => void {
  if (!conversationId || !targetUid) {
    onTypingChange(false);
    return () => undefined;
  }

  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  const clearTimer = () => {
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
  };

  const typingRef = doc(db, 'conversations', conversationId, 'typing', targetUid);
  const unsubscribe = onSnapshot(
    typingRef,
    (snapshot) => {
      clearTimer();
      if (!snapshot.exists()) {
        onTypingChange(false);
        return;
      }

      const data = snapshot.data();
      const isTyping = data.isTyping === true;
      const updatedAt = (data.updatedAt as Timestamp | undefined) ?? null;

      if (!isTyping || !updatedAt) {
        onTypingChange(false);
        return;
      }

      const updatedMillis = updatedAt.toMillis();
      const elapsed = Date.now() - updatedMillis;

      if (elapsed >= TYPING_TIMEOUT_MS) {
        onTypingChange(false);
        return;
      }

      // Is typing and fresh
      onTypingChange(true);

      // Auto-expire when remaining time elapses
      const remaining = TYPING_TIMEOUT_MS - elapsed;
      expiryTimer = setTimeout(() => {
        onTypingChange(false);
      }, remaining);
    },
    (error) => {
      clearTimer();
      console.warn('[Rocket typing] subscription error', error);
      onTypingChange(false);
    },
  );

  return () => {
    clearTimer();
    unsubscribe();
  };
}
