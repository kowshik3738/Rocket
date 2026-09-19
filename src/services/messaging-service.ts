import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { getUserProfile, UserProfile } from '@/services/user-service';

export type Conversation = {
  id: string;
  participantA: string;
  participantB: string;
  lastMessage: string | null;
  lastMessageAt: Timestamp | null;
  lastMessageSenderId: string | null;
  otherUser: UserProfile | null;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  text: string;
  imageUrl: string | null;
  videoUrl: string | null;
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  fileMimeType: string | null;
  viewOnce: boolean;
  viewedAt: Timestamp | null;
  createdAt: Timestamp | null;
};

export type ChatFile = {
  fileUrl: string;
  fileName: string;
  fileSize?: number | null;
  fileMimeType?: string | null;
};

export function getConversationId(firstUid: string, secondUid: string): string {
  return [firstUid, secondUid].sort().join('_');
}

function conversationParticipants(conversationId: string) {
  const [participantA, participantB] = conversationId.split('_');
  return { participantA, participantB };
}

function mapConversation(snapshot: { id: string; data: () => Record<string, unknown> }, currentUid: string): Conversation {
  const data = snapshot.data();
  const participantA = data.participantA as string;
  const participantB = data.participantB as string;
  return {
    id: snapshot.id,
    participantA,
    participantB,
    lastMessage: (data.lastMessage as string | undefined) ?? null,
    lastMessageAt: (data.lastMessageAt as Timestamp | undefined) ?? null,
    lastMessageSenderId: (data.lastMessageSenderId as string | undefined) ?? null,
    otherUser: null,
  };
}

async function addOtherUsers(conversations: Conversation[], currentUid: string): Promise<Conversation[]> {
  return Promise.all(conversations.map(async (conversation) => {
    const otherUid = conversation.participantA === currentUid ? conversation.participantB : conversation.participantA;
    return { ...conversation, otherUser: await getUserProfile(otherUid) };
  }));
}

export async function createOrGetConversation(currentUid: string, friendUid: string): Promise<string> {
  if (currentUid === friendUid) {
    throw new Error('You cannot start a conversation with yourself.');
  }

  const conversationId = getConversationId(currentUid, friendUid);
  const conversationRef = doc(db, 'conversations', conversationId);
  const friendshipRef = doc(db, 'friendships', conversationId);

  await runTransaction(db, async (transaction) => {
    const [friendshipSnapshot, conversationSnapshot] = await Promise.all([
      transaction.get(friendshipRef),
      transaction.get(conversationRef),
    ]);
    if (!friendshipSnapshot.exists()) {
      throw new Error('You can only message accepted friends.');
    }
    if (conversationSnapshot.exists()) {
      return;
    }

    const { participantA, participantB } = conversationParticipants(conversationId);
    transaction.set(conversationRef, {
      participantA,
      participantB,
      createdAt: serverTimestamp(),
      lastMessage: null,
      lastMessageAt: null,
      lastMessageSenderId: null,
    });
  });

  return conversationId;
}

export function subscribeToConversations(
  currentUid: string,
  onChange: (conversations: Conversation[]) => void,
  onError: (error: Error) => void,
): () => void {
  const participantASnapshots = new Map<string, Conversation>();
  const participantBSnapshots = new Map<string, Conversation>();
  let disposed = false;

  const publish = () => {
    const snapshots = new Map([...participantASnapshots, ...participantBSnapshots]);
    void addOtherUsers(Array.from(snapshots.values()), currentUid)
      .then((conversations) => {
        if (!disposed) {
          conversations.sort((first, second) => {
            const firstTime = first.lastMessageAt?.toMillis() ?? 0;
            const secondTime = second.lastMessageAt?.toMillis() ?? 0;
            return secondTime - firstTime;
          });
          onChange(conversations);
        }
      })
      .catch(onError);
  };

  const handleSnapshot = (target: Map<string, Conversation>, snapshot: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => {
    const currentIds = new Set(snapshot.docs.map((item) => item.id));
    snapshot.docs.forEach((item) => target.set(item.id, mapConversation(item, currentUid)));
    Array.from(target.keys()).forEach((id) => {
      if (!currentIds.has(id)) target.delete(id);
    });
    publish();
  };

  const handleError = (error: Error) => onError(error);
  const participantAQuery = query(collection(db, 'conversations'), where('participantA', '==', currentUid), limit(100));
  const participantBQuery = query(collection(db, 'conversations'), where('participantB', '==', currentUid), limit(100));
  const unsubscribeA = onSnapshot(participantAQuery, (snapshot) => handleSnapshot(participantASnapshots, snapshot), handleError);
  const unsubscribeB = onSnapshot(participantBQuery, (snapshot) => handleSnapshot(participantBSnapshots, snapshot), handleError);

  return () => {
    disposed = true;
    unsubscribeA();
    unsubscribeB();
  };
}

export async function getConversation(conversationId: string, currentUid: string): Promise<Conversation> {
  const snapshot = await getDoc(doc(db, 'conversations', conversationId));
  if (!snapshot.exists()) {
    throw new Error('This conversation could not be found.');
  }
  const conversation = mapConversation(snapshot, currentUid);
  if (conversation.participantA !== currentUid && conversation.participantB !== currentUid) {
    throw new Error('You are not allowed to view this conversation.');
  }
  const [withOtherUser] = await addOtherUsers([conversation], currentUid);
  return withOtherUser;
}

export function subscribeToMessages(
  conversationId: string,
  onChange: (messages: ChatMessage[]) => void,
  onError: (error: Error) => void,
): () => void {
  const messagesQuery = query(
    collection(db, 'conversations', conversationId, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(200),
  );
  return onSnapshot(messagesQuery, (snapshot) => {
    onChange(snapshot.docs.map((messageSnapshot) => {
      const data = messageSnapshot.data();
      return {
        id: messageSnapshot.id,
        senderId: data.senderId as string,
        recipientId: data.recipientId as string,
        text: data.text as string,
        imageUrl: (data.imageUrl as string | undefined) ?? null,
        videoUrl: (data.videoUrl as string | undefined) ?? null,
        fileUrl: (data.fileUrl as string | undefined) ?? null,
        fileName: (data.fileName as string | undefined) ?? null,
        fileSize: (data.fileSize as number | undefined) ?? null,
        fileMimeType: (data.fileMimeType as string | undefined) ?? null,
        viewOnce: data.viewOnce === true,
        viewedAt: (data.viewedAt as Timestamp | undefined) ?? null,
        createdAt: (data.createdAt as Timestamp | undefined) ?? null,
      };
    }));
  }, onError);
}

export async function sendMessage(
  conversation: Conversation,
  senderId: string,
  text: string,
  imageUrl?: string | null,
  videoUrl?: string | null,
  file?: ChatFile | null,
  viewOnce = false,
): Promise<void> {
  const cleanText = text.trim();
  if (!cleanText && !imageUrl && !videoUrl && !file) return;
  if ([imageUrl, videoUrl, file].filter(Boolean).length > 1) {
    throw new Error('A message can contain only one attachment.');
  }
  if (viewOnce && (!imageUrl && !videoUrl || !!file)) {
    throw new Error('View once is available only for photos and videos.');
  }
  if (imageUrl && !/^https:\/\//.test(imageUrl)) {
    throw new Error('The selected photo URL is invalid.');
  }
  if (videoUrl && !/^https:\/\//.test(videoUrl)) {
    throw new Error('The selected video URL is invalid.');
  }
  if (file) {
    if (!/^https:\/\//.test(file.fileUrl)) {
      throw new Error('The selected file URL is invalid.');
    }
    if (!file.fileName.trim()) {
      throw new Error('The selected file name is invalid.');
    }
    if (file.fileSize != null && (!Number.isInteger(file.fileSize) || file.fileSize < 0)) {
      throw new Error('The selected file size is invalid.');
    }
    if (file.fileMimeType != null && !file.fileMimeType.trim()) {
      throw new Error('The selected file type is invalid.');
    }
  }
  if (conversation.participantA !== senderId && conversation.participantB !== senderId) {
    throw new Error('You are not allowed to send messages in this conversation.');
  }

  const recipientId = conversation.participantA === senderId ? conversation.participantB : conversation.participantA;
  const conversationRef = doc(db, 'conversations', conversation.id);
  const messageRef = doc(collection(db, 'conversations', conversation.id, 'messages'));
  await runTransaction(db, async (transaction) => {
    const conversationSnapshot = await transaction.get(conversationRef);
    if (!conversationSnapshot.exists()) {
      throw new Error('This conversation is no longer available.');
    }
    transaction.set(messageRef, {
      senderId,
      recipientId,
      text: cleanText,
      ...(imageUrl ? { imageUrl } : {}),
      ...(videoUrl ? { videoUrl } : {}),
      ...(viewOnce ? { viewOnce: true } : {}),
      ...(file ? {
        fileUrl: file.fileUrl,
        fileName: file.fileName,
        ...(file.fileSize != null ? { fileSize: file.fileSize } : {}),
        ...(file.fileMimeType ? { fileMimeType: file.fileMimeType } : {}),
      } : {}),
      createdAt: serverTimestamp(),
    });
    transaction.update(conversationRef, {
      lastMessage: viewOnce ? 'View once media' : imageUrl ? 'Photo' : videoUrl ? 'Video' : file ? `File: ${file.fileName}` : cleanText,
      lastMessageAt: serverTimestamp(),
      lastMessageSenderId: senderId,
    });
  });
}

export async function markViewOnceMessageViewed(conversationId: string, messageId: string, recipientId: string): Promise<void> {
  const messageRef = doc(db, 'conversations', conversationId, 'messages', messageId);
  await runTransaction(db, async (transaction) => {
    const messageSnapshot = await transaction.get(messageRef);
    if (!messageSnapshot.exists()) throw new Error('This message is no longer available.');
    const message = messageSnapshot.data();
    if (message.recipientId !== recipientId || message.viewOnce !== true || message.viewedAt != null) {
      throw new Error('This view-once message is no longer available.');
    }
    transaction.update(messageRef, { viewedAt: serverTimestamp() });
  });
}
