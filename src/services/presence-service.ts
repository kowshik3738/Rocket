import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';

export type UserPresenceState = 'online' | 'offline';

export type UserPresence = {
  uid: string;
  state: UserPresenceState;
  lastSeen: Timestamp | null;
  updatedAt: Timestamp | null;
};

// If a client was marked online but hasn't refreshed presence in 6 minutes,
// treat as offline to prevent stale "Online" state when app was force killed.
export const STALE_PRESENCE_THRESHOLD_MS = 6 * 60 * 1000;

export async function setUserOnline(uid: string): Promise<void> {
  if (!uid) return;
  try {
    const presenceRef = doc(db, 'userPresence', uid);
    await setDoc(
      presenceRef,
      {
        uid,
        state: 'online',
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (error) {
    console.warn('[Rocket presence] failed to set online', error);
  }
}

export async function setUserOffline(uid: string): Promise<void> {
  if (!uid) return;
  try {
    const presenceRef = doc(db, 'userPresence', uid);
    await setDoc(
      presenceRef,
      {
        uid,
        state: 'offline',
        lastSeen: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (error) {
    console.warn('[Rocket presence] failed to set offline', error);
  }
}

export function subscribeToUserPresence(
  uid: string,
  onChange: (presence: UserPresence | null) => void,
): () => void {
  if (!uid) {
    onChange(null);
    return () => undefined;
  }

  const presenceRef = doc(db, 'userPresence', uid);
  return onSnapshot(
    presenceRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        onChange(null);
        return;
      }
      const data = snapshot.data();
      const state: UserPresenceState = data.state === 'online' ? 'online' : 'offline';
      onChange({
        uid: (data.uid as string) || uid,
        state,
        lastSeen: (data.lastSeen as Timestamp | undefined) ?? null,
        updatedAt: (data.updatedAt as Timestamp | undefined) ?? null,
      });
    },
    (error) => {
      console.warn('[Rocket presence] subscription error', error);
      onChange(null);
    },
  );
}

export function isUserOnline(presence: UserPresence | null): boolean {
  if (!presence || presence.state !== 'online') return false;
  if (!presence.updatedAt) return false;
  const updatedMillis = presence.updatedAt.toMillis();
  if (Date.now() - updatedMillis > STALE_PRESENCE_THRESHOLD_MS) {
    return false;
  }
  return true;
}

export function formatLastSeen(presence: UserPresence | null): string {
  if (!presence) return '';
  if (isUserOnline(presence)) return 'Online';
  if (!presence.lastSeen) return '';

  const lastSeenMillis = presence.lastSeen.toMillis();
  const diff = Date.now() - lastSeenMillis;

  if (diff < 60 * 1000) {
    return 'now';
  }
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    return `${minutes}m`;
  }
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return `${hours}h`;
  }
  if (diff < 48 * 60 * 60 * 1000) {
    return 'Yesterday';
  }

  const date = presence.lastSeen.toDate();
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
