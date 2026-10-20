import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where
} from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { dispatchPushNotification } from '@/services/notification-service';
import { getUserProfile, isValidProfilePhotoUrl, UserProfile } from '@/services/user-service';

export type Post = {
  postId: string;
  authorUid: string;
  text: string;
  imageUrl: string | null;
  createdAt: Timestamp | null;
  author: UserProfile;
  likeCount: number;
  commentCount: number;
  likedByViewer: boolean;
};

export type PostComment = {
  commentId: string;
  authorUid: string;
  text: string;
  createdAt: Timestamp | null;
  author: UserProfile;
};

const MAX_POST_LENGTH = 1000;
const MAX_COMMENT_LENGTH = 500;

function canPublishToFeed(authorUid: string, viewerUid: string, friendIds: Set<string>) {
  return authorUid === viewerUid || friendIds.has(authorUid);
}

export async function createPost(authorUid: string, text: string, imageUrl?: string | null): Promise<void> {
  const cleanText = text.trim();
  if (!cleanText && !imageUrl) throw new Error('Add a photo or write something before publishing.');
  if (cleanText.length > MAX_POST_LENGTH) throw new Error('Posts must be 1,000 characters or fewer.');
  if (imageUrl && !/^https:\/\//.test(imageUrl)) throw new Error('The selected photo URL is invalid.');
  await addDoc(collection(db, 'posts'), {
    authorUid,
    text: cleanText,
    ...(imageUrl ? { imageUrl } : {}),
    createdAt: serverTimestamp(),
  });
}

export async function deletePost(postId: string): Promise<void> {
  await deleteDoc(doc(db, 'posts', postId));
}

export function subscribeToFeed(
  viewerUid: string,
  authorUids: string[],
  onChange: (posts: Post[]) => void,
  onError: (error: Error) => void,
): () => void {
  const postsById = new Map<string, Omit<Post, 'author' | 'likeCount' | 'commentCount' | 'likedByViewer'>>();
  const authorProfiles = new Map<string, UserProfile>();
  const unsubscribers: Array<() => void> = [];
  let disposed = false;
  const publish = () => {
    void Promise.all(Array.from(postsById.values()).map(async (post) => {
      const author = authorProfiles.get(post.authorUid) ?? await getUserProfile(post.authorUid);
      if (author) authorProfiles.set(post.authorUid, author);
      return author ? { ...post, author, likeCount: 0, commentCount: 0, likedByViewer: false } : null;
    })).then((nextPosts) => {
      if (!disposed) onChange(nextPosts.filter((post): post is Post => post !== null).sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)));
    }).catch(onError);
  };

  for (const authorUid of authorUids) {
    unsubscribers.push(onSnapshot(doc(db, 'users', authorUid), (profileSnapshot) => {
      if (!profileSnapshot.exists()) return;
      const data = profileSnapshot.data();
      authorProfiles.set(authorUid, {
        uid: data.uid as string,
        displayName: data.displayName as string,
        username: data.username as string,
        usernameLower: data.usernameLower as string,
        bio: (data.bio as string | undefined) ?? '',
        photoUrl: typeof data.photoUrl === 'string' && isValidProfilePhotoUrl(data.photoUrl)
          ? data.photoUrl
          : undefined,
        createdAt: (data.createdAt as Timestamp | undefined) ?? null,
      });
      publish();
    }, onError));
    const postsQuery = query(collection(db, 'posts'), where('authorUid', '==', authorUid), limit(100));
    unsubscribers.push(onSnapshot(postsQuery, (snapshot) => {
      const idsForAuthor = new Set(snapshot.docs.map((item) => item.id));
      Array.from(postsById.keys()).forEach((id) => {
        if (postsById.get(id)?.authorUid === authorUid && !idsForAuthor.has(id)) postsById.delete(id);
      });
      snapshot.docs.forEach((item) => {
        const data = item.data();
        postsById.set(item.id, {
          postId: item.id,
          authorUid: data.authorUid as string,
          text: data.text as string,
          imageUrl: (data.imageUrl as string | undefined) ?? null,
          createdAt: (data.createdAt as Timestamp | undefined) ?? null,
        });
      });
      publish();
    }, onError));
  }

  return () => {
    disposed = true;
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}

export function subscribeToPostStats(
  post: Post,
  viewerUid: string,
  onChange: (stats: Pick<Post, 'likeCount' | 'commentCount' | 'likedByViewer'>) => void,
  onError: (error: Error) => void,
): () => void {
  const likesQuery = query(collection(db, 'posts', post.postId, 'likes'));
  const commentsQuery = query(collection(db, 'posts', post.postId, 'comments'));
  let likeCount = 0;
  let commentCount = 0;
  let likedByViewer = false;
  const publish = () => onChange({ likeCount, commentCount, likedByViewer });
  const unsubscribeLikes = onSnapshot(likesQuery, (snapshot) => {
    likeCount = snapshot.size;
    likedByViewer = snapshot.docs.some((item) => item.id === viewerUid);
    publish();
  }, onError);
  const unsubscribeComments = onSnapshot(commentsQuery, (snapshot) => {
    commentCount = snapshot.size;
    publish();
  }, onError);
  return () => {
    unsubscribeLikes();
    unsubscribeComments();
  };
}

async function notifyPostAuthorOfLike(postId: string, viewerUid: string): Promise<void> {
  try {
    const postDoc = await getDoc(doc(db, 'posts', postId));
    if (!postDoc.exists()) return;
    const postAuthorUid = postDoc.data()?.authorUid as string | undefined;
    if (!postAuthorUid || postAuthorUid === viewerUid) return;

    void dispatchPushNotification({
      recipientUid: postAuthorUid,
      kind: 'social',
      data: {
        subkind: 'like',
        postId,
      },
    }).catch((err) => {
      console.warn(`[Push] Failed to dispatch like notification to ${postAuthorUid}:`, err);
    });
  } catch (err) {
    console.warn('[Push] Failed to look up post author for like notification:', err);
  }
}

async function notifyPostAuthorOfComment(postId: string, commentId: string, commenterUid: string): Promise<void> {
  try {
    const postDoc = await getDoc(doc(db, 'posts', postId));
    if (!postDoc.exists()) return;
    const postAuthorUid = postDoc.data()?.authorUid as string | undefined;
    if (!postAuthorUid || postAuthorUid === commenterUid) return;

    void dispatchPushNotification({
      recipientUid: postAuthorUid,
      kind: 'social',
      data: {
        subkind: 'comment',
        postId,
        commentId,
      },
    }).catch((err) => {
      console.warn(`[Push] Failed to dispatch comment notification to ${postAuthorUid}:`, err);
    });
  } catch (err) {
    console.warn('[Push] Failed to look up post author for comment notification:', err);
  }
}

export async function toggleLike(postId: string, viewerUid: string): Promise<void> {
  const likeRef = doc(db, 'posts', postId, 'likes', viewerUid);
  let wasLiked = false;
  await runTransaction(db, async (transaction) => {
    const likeSnapshot = await transaction.get(likeRef);
    if (likeSnapshot.exists()) {
      transaction.delete(likeRef);
      wasLiked = false;
    } else {
      transaction.set(likeRef, { userUid: viewerUid, createdAt: serverTimestamp() });
      wasLiked = true;
    }
  });

  if (wasLiked) {
    void notifyPostAuthorOfLike(postId, viewerUid);
  }
}

export async function likePost(postId: string, viewerUid: string): Promise<void> {
  await setLikeState(postId, viewerUid, true);
}

export async function setLikeState(postId: string, viewerUid: string, liked: boolean): Promise<void> {
  const likeRef = doc(db, 'posts', postId, 'likes', viewerUid);
  let justLiked = false;
  await runTransaction(db, async (transaction) => {
    const likeSnapshot = await transaction.get(likeRef);
    if (liked && !likeSnapshot.exists()) {
      transaction.set(likeRef, { userUid: viewerUid, createdAt: serverTimestamp() });
      justLiked = true;
    } else if (!liked && likeSnapshot.exists()) {
      transaction.delete(likeRef);
    }
  });

  if (justLiked) {
    void notifyPostAuthorOfLike(postId, viewerUid);
  }
}

export async function getPostComments(postId: string): Promise<PostComment[]> {
  const commentsQuery = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'asc'), limit(200));
  const snapshot = await getDocs(commentsQuery);
  const comments = await Promise.all(snapshot.docs.map(async (item) => {
    const data = item.data();
    const author = await getUserProfile(data.authorUid as string);
    return author ? {
      commentId: item.id,
      authorUid: data.authorUid as string,
      text: data.text as string,
      createdAt: (data.createdAt as Timestamp | undefined) ?? null,
      author,
    } : null;
  }));
  return comments.filter((comment): comment is PostComment => comment !== null);
}

export function subscribeToComments(postId: string, onChange: (comments: PostComment[]) => void, onError: (error: Error) => void): () => void {
  const commentsQuery = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'asc'), limit(200));
  return onSnapshot(commentsQuery, (snapshot) => {
    void Promise.all(snapshot.docs.map(async (item) => {
      const data = item.data();
      const author = await getUserProfile(data.authorUid as string);
      return author ? { commentId: item.id, authorUid: data.authorUid as string, text: data.text as string, createdAt: (data.createdAt as Timestamp | undefined) ?? null, author } : null;
    })).then((comments) => onChange(comments.filter((comment): comment is PostComment => comment !== null))).catch(onError);
  }, onError);
}

export async function addComment(postId: string, authorUid: string, text: string): Promise<void> {
  const cleanText = text.trim();
  if (!cleanText) throw new Error('Write a comment before sending.');
  if (cleanText.length > MAX_COMMENT_LENGTH) throw new Error('Comments must be 500 characters or fewer.');
  const commentRef = await addDoc(collection(db, 'posts', postId, 'comments'), {
    authorUid,
    text: cleanText,
    createdAt: serverTimestamp(),
  });

  void notifyPostAuthorOfComment(postId, commentRef.id, authorUid);
}

export async function getPostCount(authorUid: string): Promise<number> {
  const snapshot = await getCountFromServer(query(collection(db, 'posts'), where('authorUid', '==', authorUid)));
  return snapshot.data().count;
}
