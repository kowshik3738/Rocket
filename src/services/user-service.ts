import { deleteUser, User as FirebaseUser } from 'firebase/auth';
import {
    doc,
    getDoc,
    runTransaction,
    serverTimestamp,
    Timestamp,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';

export type UserProfile = {
  uid: string;
  displayName: string;
  username: string;
  usernameLower: string;
  bio: string;
  createdAt: Timestamp | null;
};

const USERNAME_PATTERN = /^[a-z0-9_.]+$/;
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 30;

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function validateUsername(username: string): string | null {
  const normalized = normalizeUsername(username);
  if (!normalized) {
    return 'Choose a username.';
  }
  if (normalized.length < USERNAME_MIN_LENGTH || normalized.length > USERNAME_MAX_LENGTH) {
    return 'Username must be 3 to 30 characters.';
  }
  if (!USERNAME_PATTERN.test(normalized)) {
    return 'Username can only use letters, numbers, underscores, and periods.';
  }
  return null;
}

export async function createUserProfile(
  firebaseUser: FirebaseUser,
  displayName: string,
  username: string,
): Promise<UserProfile> {
  const normalizedUsername = normalizeUsername(username);
  const profileRef = doc(db, 'users', firebaseUser.uid);
  const usernameRef = doc(db, 'usernames', normalizedUsername);

  try {
    const createdProfile = await runTransaction(db, async (transaction) => {
      const usernameSnapshot = await transaction.get(usernameRef);
      if (usernameSnapshot.exists()) {
        throw new Error('username-already-in-use');
      }

      const profile: UserProfile = {
        uid: firebaseUser.uid,
        displayName: displayName.trim(),
        username: username.trim(),
        usernameLower: normalizedUsername,
        bio: '',
        createdAt: null,
      };

      transaction.set(usernameRef, { uid: firebaseUser.uid });
      transaction.set(profileRef, {
        ...profile,
        createdAt: serverTimestamp(),
      });
      return profile;
    });
    return createdProfile;
  } catch (error) {
    await deleteUser(firebaseUser).catch(() => undefined);
    throw error;
  }
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snapshot = await getDoc(doc(db, 'users', uid));
  if (!snapshot.exists()) {
    return null;
  }

  const data = snapshot.data();
  return {
    uid: data.uid,
    displayName: data.displayName,
    username: data.username,
    usernameLower: data.usernameLower,
    bio: data.bio ?? '',
    createdAt: data.createdAt ?? null,
  };
}

export async function updateUserProfile(
  uid: string,
  displayName: string,
  username: string,
  bio: string,
): Promise<UserProfile> {
  const normalizedUsername = normalizeUsername(username);
  const profileRef = doc(db, 'users', uid);
  const newUsernameRef = doc(db, 'usernames', normalizedUsername);
  const profileSnapshot = await getDoc(profileRef);
  if (!profileSnapshot.exists()) {
    throw new Error('Profile not found.');
  }

  const previousUsernameLower = profileSnapshot.data().usernameLower as string;
  const oldUsernameRef = doc(db, 'usernames', previousUsernameLower);
  const cleanBio = bio.trim();
  if (cleanBio.length > 150) {
    throw new Error('Bio must be 150 characters or fewer.');
  }

  const usernameChanged = previousUsernameLower !== normalizedUsername;
  try {
    const updatedProfile = await runTransaction(db, async (transaction) => {
    const [currentProfile, newUsername] = await Promise.all([
      transaction.get(profileRef),
      transaction.get(newUsernameRef),
    ]);
    if (!currentProfile.exists()) {
      throw new Error('Profile not found.');
    }
    if (newUsername.exists() && newUsername.data().uid !== uid) {
      throw new Error('username-already-in-use');
    }

    const currentData = currentProfile.data();
    const updatedProfile: UserProfile = {
      uid,
      displayName: displayName.trim(),
      username: username.trim(),
      usernameLower: normalizedUsername,
      bio: cleanBio,
      createdAt: currentData.createdAt ?? null,
    };

    if (usernameChanged) {
      transaction.set(newUsernameRef, { uid });
      transaction.delete(oldUsernameRef);
    }
    transaction.update(profileRef, {
      displayName: updatedProfile.displayName,
      username: updatedProfile.username,
      usernameLower: updatedProfile.usernameLower,
      bio: updatedProfile.bio,
    });
    return updatedProfile;
    });
    return updatedProfile;
  } catch (error) {
    throw error;
  }
}

export function getProfileInitials(displayName: string): string {
  const names = displayName.trim().split(/\s+/).filter(Boolean);
  return names.slice(0, 2).map((name) => name[0].toUpperCase()).join('') || '?';
}

export function getProfileColor(uid: string): string {
  const colors = ['#967FFF', '#FF8D68', '#55C8B0', '#F0B35B', '#D978FF'];
  const hash = uid.split('').reduce((total, character) => total + character.charCodeAt(0), 0);
  return colors[hash % colors.length];
}
