import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
  Timestamp,
  runTransaction,
  writeBatch
} from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { getFriends, getBlockedUids } from '@/services/social-service';

export type StoryTier = 'friends' | 'closeFriends' | 'selected';
export type StoryType = 'image' | 'video' | 'text';
export type StoryTheme = 'classic' | 'modern' | 'neon' | 'mono';

export type Story = {
  id: string;
  authorUid: string;
  type: StoryType;
  tier: StoryTier;
  selectedIds: string[] | null;
  allowedViewers: string[];
  mediaUrl: string | null;
  text: string | null;
  backgroundColor: StoryTheme | null;
  createdAt: Timestamp | null;
  expiresAt: Timestamp | null;
};

export type PrivacyList = {
  ownerUid: string;
  closeFriends: string[];
  hiddenFrom: string[];
  updatedAt: Timestamp | null;
};

export type StoryViewer = {
  viewerUid: string;
  viewedAt: Timestamp | null;
};

export async function getPrivacyList(uid: string): Promise<PrivacyList> {
  const docRef = doc(db, 'privacyLists', uid);
  const snap = await getDoc(docRef);
  if (snap.exists()) {
    return snap.data() as PrivacyList;
  }
  return {
    ownerUid: uid,
    closeFriends: [],
    hiddenFrom: [],
    updatedAt: null,
  };
}

// Internal helper to compute eligible audience
async function computeAllowedViewers(
  uid: string,
  tier: StoryTier,
  selectedIds: string[] | null
): Promise<string[]> {
  const [friends, privacy, blocked] = await Promise.all([
    getFriends(uid),
    getPrivacyList(uid),
    getBlockedUids(uid)
  ]);
  
  const friendUids = friends.map(f => f.uid);
  const hidden = new Set(privacy.hiddenFrom || []);
  const blockedSet = new Set(blocked);
  const closeFriendsSet = new Set(privacy.closeFriends || []);
  const selectedSet = new Set(selectedIds || []);
  
  let audience: string[] = [];
  
  for (const fUid of friendUids) {
    if (blockedSet.has(fUid)) continue;
    if (fUid === uid) continue;
    if (hidden.has(fUid)) continue;
    
    if (tier === 'friends') {
      audience.push(fUid);
    } else if (tier === 'closeFriends') {
      if (closeFriendsSet.has(fUid)) audience.push(fUid);
    } else if (tier === 'selected') {
      if (selectedSet.has(fUid)) audience.push(fUid);
    }
  }
  
  audience = [...new Set(audience)]; // Deduplicate
  
  if (audience.length > 500) {
    throw new Error('Story audience exceeds the maximum limit of 500 viewers.');
  }
  
  return audience;
}

export async function addCloseFriend(uid: string, friendId: string): Promise<void> {
  const friends = await getFriends(uid);
  if (!friends.find(f => f.uid === friendId)) {
    throw new Error('Can only add accepted friends to Close Friends.');
  }
  const docRef = doc(db, 'privacyLists', uid);
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(docRef);
    let closeFriends: string[] = [];
    let hiddenFrom: string[] = [];
    if (snap.exists()) {
      const data = snap.data() as PrivacyList;
      closeFriends = data.closeFriends || [];
      hiddenFrom = data.hiddenFrom || [];
    }
    if (!closeFriends.includes(friendId)) {
      closeFriends.push(friendId);
      if (closeFriends.length > 200) throw new Error('Close friends list is full (max 200).');
    }
    transaction.set(docRef, {
      ownerUid: uid,
      closeFriends,
      hiddenFrom,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
  await syncActiveStoriesPrivacy(uid);
}

export async function removeCloseFriend(uid: string, friendId: string): Promise<void> {
  const docRef = doc(db, 'privacyLists', uid);
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(docRef);
    if (!snap.exists()) return;
    const data = snap.data() as PrivacyList;
    const closeFriends = (data.closeFriends || []).filter((id) => id !== friendId);
    transaction.set(docRef, {
      ...data,
      closeFriends,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
  await syncActiveStoriesPrivacy(uid);
}

export async function setHiddenFrom(uid: string, hiddenFromIds: string[]): Promise<void> {
  if (hiddenFromIds.length > 200) throw new Error('Hidden list is full (max 200).');
  const docRef = doc(db, 'privacyLists', uid);
  await setDoc(docRef, {
    ownerUid: uid,
    hiddenFrom: hiddenFromIds,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  await syncActiveStoriesPrivacy(uid);
}

async function syncActiveStoriesPrivacy(uid: string): Promise<void> {
  // Fetch active stories
  const activeStories = await fetchOwnActiveStories(uid);
  if (activeStories.length === 0) return;
  
  const [friends, privacy, blocked] = await Promise.all([
    getFriends(uid),
    getPrivacyList(uid),
    getBlockedUids(uid)
  ]);
  
  const friendUids = friends.map(f => f.uid);
  const hidden = new Set(privacy.hiddenFrom || []);
  const blockedSet = new Set(blocked);
  const closeFriendsSet = new Set(privacy.closeFriends || []);
  
  const batch = writeBatch(db);
  let opCount = 0;

  for (const story of activeStories) {
    const selectedSet = new Set(story.selectedIds || []);
    let newAudience: string[] = [];
    
    for (const fUid of friendUids) {
      if (blockedSet.has(fUid)) continue;
      if (fUid === uid) continue;
      if (hidden.has(fUid)) continue;
      
      if (story.tier === 'friends') {
        newAudience.push(fUid);
      } else if (story.tier === 'closeFriends') {
        if (closeFriendsSet.has(fUid)) newAudience.push(fUid);
      } else if (story.tier === 'selected') {
        if (selectedSet.has(fUid)) newAudience.push(fUid);
      }
    }
    
    newAudience = [...new Set(newAudience)];
    if (newAudience.length > 500) {
      throw new Error('Story audience exceeds maximum limit of 500 during synchronization. Sync aborted safely.');
    }
    
    const discoveryRef = doc(db, 'storyDiscovery', story.id);
    batch.set(discoveryRef, { allowedViewers: newAudience }, { merge: true });
    opCount++;
    
    if (opCount >= 490) {
      // Bounded safety limit. In a realistic V1 scenario, a user will not have 490 active stories in 24 hours.
      throw new Error('Too many active stories to sync atomically. Sync aborted.');
    }
  }

  if (opCount > 0) {
    await batch.commit();
  }
}

async function createStoryDoc(
  uid: string,
  payload: Partial<Story>
): Promise<void> {
  if (payload.tier === 'selected' && (!payload.selectedIds || payload.selectedIds.length === 0 || payload.selectedIds.length > 50)) {
    throw new Error('Selected stories require between 1 and 50 selected friends.');
  }
  
  const audience = await computeAllowedViewers(uid, payload.tier!, payload.selectedIds || null);
  
  const storiesRef = collection(db, 'stories');
  const storyDoc = doc(storiesRef);
  const now = Date.now();
  const expiresAt = Timestamp.fromMillis(now + 24 * 60 * 60 * 1000); // 24h client-side
  
  const batch = writeBatch(db);

  // 1. Create sensitive payload document
  batch.set(storyDoc, {
    authorUid: uid,
    type: payload.type,
    tier: payload.tier,
    selectedIds: payload.tier === 'selected' ? payload.selectedIds : null,
    mediaUrl: payload.mediaUrl || null,
    text: payload.text || null,
    backgroundColor: payload.backgroundColor || null,
    createdAt: serverTimestamp(),
    expiresAt,
  });

  // 2. Create public discovery projection
  const discoveryDoc = doc(db, 'storyDiscovery', storyDoc.id);
  batch.set(discoveryDoc, {
    authorUid: uid,
    tier: payload.tier,
    type: payload.type,
    expiresAt,
    allowedViewers: audience,
  });

  await batch.commit();
}

export async function createImageStory(
  uid: string,
  tier: StoryTier,
  mediaUrl: string,
  selectedIds?: string[]
): Promise<void> {
  await createStoryDoc(uid, {
    type: 'image',
    tier,
    mediaUrl,
    selectedIds,
  });
}

export async function createVideoStory(
  uid: string,
  tier: StoryTier,
  mediaUrl: string,
  selectedIds?: string[]
): Promise<void> {
  await createStoryDoc(uid, {
    type: 'video',
    tier,
    mediaUrl,
    selectedIds,
  });
}

export async function createTextStory(
  uid: string,
  tier: StoryTier,
  text: string,
  theme: StoryTheme,
  selectedIds?: string[]
): Promise<void> {
  if (text.trim().length === 0 || text.trim().length > 1000) {
    throw new Error('Text must be between 1 and 1000 characters.');
  }
  await createStoryDoc(uid, {
    type: 'text',
    tier,
    text: text.trim(),
    backgroundColor: theme,
    selectedIds,
  });
}

export async function deleteStory(storyId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'stories', storyId));
  batch.delete(doc(db, 'storyDiscovery', storyId));
  await batch.commit();
}

export async function fetchOwnActiveStories(uid: string): Promise<Story[]> {
  const q = query(
    collection(db, 'stories'),
    where('authorUid', '==', uid),
    where('expiresAt', '>', Timestamp.now())
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Story));
}

export async function fetchFriendStories(uid: string): Promise<Story[]> {
  const friends = await getFriends(uid);
  if (friends.length === 0) return [];
  
  const friendUids = friends.map((f) => f.uid);
  
  // Single discovery query leveraging allowedViewers projection
  // Discovery layer: query story metadata only
  const q = query(
    collection(db, 'storyDiscovery'),
    where('allowedViewers', 'array-contains', uid),
    where('expiresAt', '>', Timestamp.now())
  );
  
  const snap = await getDocs(q);
  const discoveryDocs = snap.docs.map(d => ({ id: d.id, ...d.data() } as { id: string; authorUid: string }));
  
  // Client-side drop of unfriended/blocked authors before fetching payloads
  const validFriendSet = new Set(friendUids);
  const validDiscovery = discoveryDocs.filter(doc => validFriendSet.has(doc.authorUid));
  
  // Payload layer: fetch actual stories. 'get' rules dynamically verify auth.
  const fetchPromises = validDiscovery.map(d => getDoc(doc(db, 'stories', d.id)));
  const results = await Promise.allSettled(fetchPromises);
  
  let allStories: Story[] = [];
  for (const res of results) {
    if (res.status === 'fulfilled' && res.value.exists()) {
      allStories.push({ id: res.value.id, ...res.value.data() } as Story);
    }
    // Rejected promises (PERMISSION_DENIED) gracefully dropped.
  }
  
  return allStories;
}

export async function recordStoryView(storyId: string, viewerUid: string): Promise<void> {
  const viewerDoc = doc(db, 'stories', storyId, 'viewers', viewerUid);
  await setDoc(viewerDoc, {
    viewerUid,
    viewedAt: serverTimestamp(),
  });
}

export async function fetchStoryViewers(storyId: string): Promise<StoryViewer[]> {
  const snap = await getDocs(collection(db, 'stories', storyId, 'viewers'));
  return snap.docs.map((d) => d.data() as StoryViewer);
}

export type StoryDiscovery = {
  id: string;
  authorUid: string;
  tier: StoryTier;
  type: StoryType;
  expiresAt: Timestamp;
};

export async function fetchStoryDiscoveryRail(uid: string): Promise<StoryDiscovery[]> {
  const friends = await getFriends(uid);
  if (friends.length === 0) return [];
  
  const friendUids = new Set(friends.map(f => f.uid));
  
  const q = query(
    collection(db, 'storyDiscovery'),
    where('allowedViewers', 'array-contains', uid),
    where('expiresAt', '>', Timestamp.now())
  );
  
  const snap = await getDocs(q);
  const validDiscovery: StoryDiscovery[] = [];
  
  snap.forEach(doc => {
    const data = doc.data();
    if (friendUids.has(data.authorUid)) {
      validDiscovery.push({
        id: doc.id,
        authorUid: data.authorUid,
        tier: data.tier,
        type: data.type,
        expiresAt: data.expiresAt,
      });
    }
  });
  
  return validDiscovery;
}

export async function fetchStoriesForAuthor(uid: string, authorUid: string): Promise<Story[]> {
  const q = query(
    collection(db, 'storyDiscovery'),
    where('allowedViewers', 'array-contains', uid),
    where('expiresAt', '>', Timestamp.now())
  );
  const snap = await getDocs(q);
  
  const fetchPromises = snap.docs
    .filter(d => d.data().authorUid === authorUid)
    .map(d => getDoc(doc(db, 'stories', d.id)));
    
  const results = await Promise.allSettled(fetchPromises);
  
  const stories: Story[] = [];
  for (const res of results) {
    if (res.status === 'fulfilled' && res.value.exists()) {
      stories.push({ id: res.value.id, ...res.value.data() } as Story);
    }
  }
  
  return stories.sort((a, b) => {
    const aTime = a.createdAt?.toMillis() || 0;
    const bTime = b.createdAt?.toMillis() || 0;
    return aTime - bTime;
  });
}

export async function getStoryViewerReceipt(storyId: string, viewerUid: string): Promise<boolean> {
  const docRef = doc(db, 'stories', storyId, 'viewers', viewerUid);
  const snap = await getDoc(docRef);
  return snap.exists();
}
