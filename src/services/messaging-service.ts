import {
  collection,
  deleteField,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { isValidCoordinates, LiveLocation, LiveLocationDuration, liveLocationManager } from '@/services/location-service';
import { dispatchPushNotification } from '@/services/notification-service';
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

export type ReplyMetadata = {
  replyToMessageId: string;
  replyToSenderId: string;
  replyToText: string;
  replyToType: 'text' | 'image' | 'video' | 'file' | 'viewOnce';
};

const AUDIO_MIME_TYPES: Record<string, string> = {
  aac: 'audio/aac',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  wma: 'audio/x-ms-wma',
};

export function inferAudioMimeType(
  fileName: string,
  mimeType?: string | null,
): string | null {
  const normalized = mimeType?.trim().toLowerCase();
  if (normalized?.startsWith('audio/')) return normalized;
  const extension = fileName.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  return extension ? AUDIO_MIME_TYPES[extension] ?? null : null;
}

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
  audioUrl?: string | null;
  audioDurationMs?: number | null;
  audioMimeType?: string | null;
  viewOnce: boolean;
  viewedAt: Timestamp | null;
  deliveredAt?: Timestamp | null;
  seenAt?: Timestamp | null;
  callId: string | null;
  callerId: string | null;
  calleeId: string | null;
  callOutcome: 'cancelled' | 'declined' | 'completed' | null;
  callAnsweredAt: Timestamp | null;
  callEndedAt: Timestamp | null;
  createdAt: Timestamp | null;
  replyToMessageId?: string | null;
  replyToSenderId?: string | null;
  replyToText?: string | null;
  replyToType?: 'text' | 'image' | 'video' | 'file' | 'viewOnce' | null;
  reactions?: Record<string, string> | null;
  editedAt?: Timestamp | null;
  deletedAt?: Timestamp | null;
  deletedBy?: string | null;
  forwarded?: boolean | null;
  location?: { latitude: number; longitude: number } | null;
  locationType?: 'current' | 'live' | null;
  liveLocationShareId?: string | null;
};

export type ForwardableMessagePayload = {
  text: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  file?: ChatFile | null;
  audioUrl?: string | null;
  audioDurationMs?: number | null;
  audioMimeType?: string | null;
};

export function extractForwardablePayload(message: {
  text?: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  fileMimeType?: string | null;
  audioUrl?: string | null;
  audioDurationMs?: number | null;
  audioMimeType?: string | null;
  viewOnce?: boolean;
  viewedAt?: Timestamp | null;
  callId?: string | null;
  deletedAt?: Timestamp | null;
  location?: { latitude: number; longitude: number } | null;
  locationType?: 'current' | 'live' | null;
  liveLocationShareId?: string | null;
} | null | undefined): ForwardableMessagePayload | null {
  if (!message) return null;
  if (
    message.deletedAt ||
    message.viewOnce ||
    message.viewedAt ||
    message.callId ||
    message.locationType ||
    message.location ||
    message.liveLocationShareId
  ) {
    return null;
  }

  const hasText = !!message.text && message.text.trim().length > 0;
  const hasImage = !!message.imageUrl;
  const hasVideo = !!message.videoUrl;
  const hasFile = !!message.fileUrl && !!message.fileName;
  const hasAudio = !!message.audioUrl && !!message.audioDurationMs;

  if (!hasText && !hasImage && !hasVideo && !hasFile && !hasAudio) {
    return null;
  }

  let file: ChatFile | null = null;
  if (hasFile && message.fileUrl && message.fileName) {
    file = {
      fileUrl: message.fileUrl,
      fileName: message.fileName,
      fileSize: message.fileSize ?? null,
      fileMimeType: message.fileMimeType ?? null,
    };
  }

  return {
    text: message.text || '',
    imageUrl: message.imageUrl ?? null,
    videoUrl: message.videoUrl ?? null,
    file,
    audioUrl: message.audioUrl ?? null,
    audioDurationMs: message.audioDurationMs ?? null,
    audioMimeType: message.audioMimeType ?? null,
  };
}

export type ChatFile = {
  fileUrl: string;
  fileName: string;
  fileSize?: number | null;
  fileMimeType?: string | null;
};

export type FirestoreTimestampValue = {
  seconds?: unknown;
  nanoseconds?: unknown;
  toMillis?: unknown;
};

export function getFirestoreTimestampMillis(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const timestamp = value as FirestoreTimestampValue;
  if (typeof timestamp.toMillis === 'function') {
    try {
      const milliseconds = timestamp.toMillis();
      if (typeof milliseconds === 'number' && Number.isFinite(milliseconds)) return milliseconds;
    } catch {
      // Fall through to the seconds/nanoseconds representation below.
    }
  }
  if (typeof timestamp.seconds !== 'number' || typeof timestamp.nanoseconds !== 'number') return null;
  const milliseconds = timestamp.seconds * 1000 + timestamp.nanoseconds / 1_000_000;
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

export type CallHistoryRecord = {
  callId: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  outcome: 'cancelled' | 'declined' | 'completed';
  answeredAt: FirestoreTimestampValue | null;
  endedAt: FirestoreTimestampValue;
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
  const isSelf = currentUid === friendUid;
  const conversationId = isSelf ? `${currentUid}_${currentUid}` : getConversationId(currentUid, friendUid);
  const conversationRef = doc(db, 'conversations', conversationId);
  const friendshipRef = isSelf ? null : doc(db, 'friendships', conversationId);
  const blockRef = isSelf ? null : doc(db, 'userBlocks', `${currentUid}_${friendUid}`);

  await runTransaction(db, async (transaction) => {
    const [friendshipSnapshot, conversationSnapshot, blockSnapshot] = await Promise.all([
      friendshipRef ? transaction.get(friendshipRef) : Promise.resolve(null),
      transaction.get(conversationRef),
      blockRef ? transaction.get(blockRef) : Promise.resolve(null),
    ]);
    if (!isSelf) {
      if (blockSnapshot?.exists()) {
        throw new Error('You have blocked this user.');
      }
      if (!friendshipSnapshot?.exists()) {
        throw new Error('You can only message accepted friends.');
      }
    }
    if (conversationSnapshot.exists()) {
      return;
    }

    const { participantA, participantB } = isSelf
      ? { participantA: currentUid, participantB: currentUid }
      : conversationParticipants(conversationId);
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

export async function createOrGetSelfConversation(currentUid: string): Promise<string> {
  return createOrGetConversation(currentUid, currentUid);
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
    orderBy('createdAt', 'desc'),
    limit(200),
  );
  return onSnapshot(messagesQuery, (snapshot) => {
    onChange(snapshot.docs.map((messageSnapshot) => {
      const data = messageSnapshot.data();
      return {
        id: messageSnapshot.id,
        senderId: (data.senderId as string | undefined) ?? '',
        recipientId: (data.recipientId as string | undefined) ?? '',
        text: (data.text as string | undefined) ?? '',
        imageUrl: (data.imageUrl as string | undefined) ?? null,
        videoUrl: (data.videoUrl as string | undefined) ?? null,
        fileUrl: (data.fileUrl as string | undefined) ?? null,
        fileName: (data.fileName as string | undefined) ?? null,
        fileSize: (data.fileSize as number | undefined) ?? null,
        fileMimeType: (data.fileMimeType as string | undefined) ?? null,
        viewOnce: data.viewOnce === true,
        viewedAt: (data.viewedAt as Timestamp | undefined) ?? null,
        deliveredAt: (data.deliveredAt as Timestamp | undefined) ?? null,
        seenAt: (data.seenAt as Timestamp | undefined) ?? null,
        callId: (data.callId as string | undefined) ?? null,
        callerId: (data.callerId as string | undefined) ?? null,
        calleeId: (data.calleeId as string | undefined) ?? null,
        callOutcome: data.callOutcome === 'cancelled' || data.callOutcome === 'declined' || data.callOutcome === 'completed'
          ? data.callOutcome
          : null,
        callAnsweredAt: (data.callAnsweredAt as Timestamp | undefined) ?? null,
        callEndedAt: (data.callEndedAt as Timestamp | undefined) ?? null,
        createdAt: (data.createdAt as Timestamp | undefined) ?? null,
        replyToMessageId: (data.replyToMessageId as string | undefined) ?? null,
        replyToSenderId: (data.replyToSenderId as string | undefined) ?? null,
        replyToText: (data.replyToText as string | undefined) ?? null,
        replyToType: (data.replyToType as 'text' | 'image' | 'video' | 'file' | 'viewOnce' | undefined) ?? null,
        reactions: (data.reactions as Record<string, string> | undefined) ?? null,
        editedAt: (data.editedAt as Timestamp | undefined) ?? null,
        deletedAt: (data.deletedAt as Timestamp | undefined) ?? null,
        deletedBy: (data.deletedBy as string | undefined) ?? null,
        forwarded: data.forwarded === true,
        location: (data.location as { latitude: number; longitude: number } | undefined) ?? null,
        locationType: (data.locationType as 'current' | 'live' | undefined) ?? null,
        liveLocationShareId: (data.liveLocationShareId as string | undefined) ?? null,
      };
    }).reverse());
  }, onError);
}

export async function getOlderMessages(
  conversationId: string,
  oldestCreatedAt: Timestamp,
  oldestMessageId?: string | null,
  pageSize = 50
): Promise<ChatMessage[]> {
  const olderQuery = oldestMessageId
    ? query(
        collection(db, 'conversations', conversationId, 'messages'),
        orderBy('createdAt', 'desc'),
        orderBy(documentId(), 'desc'),
        startAfter(oldestCreatedAt, oldestMessageId),
        limit(pageSize)
      )
    : query(
        collection(db, 'conversations', conversationId, 'messages'),
        orderBy('createdAt', 'desc'),
        startAfter(oldestCreatedAt),
        limit(pageSize)
      );
  const snapshot = await getDocs(olderQuery);
  return snapshot.docs.map((messageSnapshot) => {
    const data = messageSnapshot.data();
    return {
      id: messageSnapshot.id,
      senderId: (data.senderId as string | undefined) ?? '',
      recipientId: (data.recipientId as string | undefined) ?? '',
      text: (data.text as string | undefined) ?? '',
      imageUrl: (data.imageUrl as string | undefined) ?? null,
      videoUrl: (data.videoUrl as string | undefined) ?? null,
      fileUrl: (data.fileUrl as string | undefined) ?? null,
      fileName: (data.fileName as string | undefined) ?? null,
      fileSize: (data.fileSize as number | undefined) ?? null,
      fileMimeType: (data.fileMimeType as string | undefined) ?? null,
      viewOnce: data.viewOnce === true,
      viewedAt: (data.viewedAt as Timestamp | undefined) ?? null,
      deliveredAt: (data.deliveredAt as Timestamp | undefined) ?? null,
      seenAt: (data.seenAt as Timestamp | undefined) ?? null,
      callId: (data.callId as string | undefined) ?? null,
      callerId: (data.callerId as string | undefined) ?? null,
      calleeId: (data.calleeId as string | undefined) ?? null,
      callOutcome: data.callOutcome === 'cancelled' || data.callOutcome === 'declined' || data.callOutcome === 'completed'
        ? data.callOutcome
        : null,
      callAnsweredAt: (data.callAnsweredAt as Timestamp | undefined) ?? null,
      callEndedAt: (data.callEndedAt as Timestamp | undefined) ?? null,
      createdAt: (data.createdAt as Timestamp | undefined) ?? null,
      replyToMessageId: (data.replyToMessageId as string | undefined) ?? null,
      replyToSenderId: (data.replyToSenderId as string | undefined) ?? null,
      replyToText: (data.replyToText as string | undefined) ?? null,
      replyToType: (data.replyToType as 'text' | 'image' | 'video' | 'file' | 'viewOnce' | undefined) ?? null,
      reactions: (data.reactions as Record<string, string> | undefined) ?? null,
      editedAt: (data.editedAt as Timestamp | undefined) ?? null,
      deletedAt: (data.deletedAt as Timestamp | undefined) ?? null,
      deletedBy: (data.deletedBy as string | undefined) ?? null,
      forwarded: data.forwarded === true,
      location: (data.location as { latitude: number; longitude: number } | undefined) ?? null,
      locationType: (data.locationType as 'current' | 'live' | undefined) ?? null,
      liveLocationShareId: (data.liveLocationShareId as string | undefined) ?? null,
    };
  }).reverse();
}

export async function recordCallHistory(call: CallHistoryRecord): Promise<void> {
  if (call.outcome === 'completed' && !call.answeredAt) {
    throw new Error('A completed call is missing its accepted timestamp.');
  }

  const messageRef = doc(db, 'conversations', call.conversationId, 'messages', `call_${call.callId}`);
  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(messageRef);
    if (existing.exists()) return;

    transaction.set(messageRef, {
      callId: call.callId,
      callerId: call.callerId,
      calleeId: call.calleeId,
      callOutcome: call.outcome,
      ...(call.outcome === 'completed' ? { callAnsweredAt: call.answeredAt } : {}),
      callEndedAt: call.endedAt,
      createdAt: call.endedAt,
    });
  });
}

export async function sendMessage(
  conversation: Conversation,
  senderId: string,
  text: string,
  imageUrl?: string | null,
  videoUrl?: string | null,
  file?: ChatFile | null,
  viewOnce = false,
  reply?: ReplyMetadata | null,
  forwarded = false,
  audioUrl?: string | null,
  audioDurationMs?: number | null,
  audioMimeType?: string | null,
): Promise<void> {
  const cleanText = text.trim();
  if (!cleanText && !imageUrl && !videoUrl && !file && !audioUrl) return;
  if ([imageUrl, videoUrl, file, audioUrl].filter(Boolean).length > 1) {
    throw new Error('A message can contain only one attachment.');
  }
  if (viewOnce && (!imageUrl && !videoUrl || !!file || !!audioUrl)) {
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
  if (audioUrl) {
    if (!/^https:\/\//.test(audioUrl)) {
      throw new Error('The voice message URL is invalid.');
    }
    if (audioDurationMs == null || !Number.isInteger(audioDurationMs) || audioDurationMs <= 0 || audioDurationMs > 600000) {
      throw new Error('The voice message duration is invalid.');
    }
  }
  if (conversation.participantA !== senderId && conversation.participantB !== senderId) {
    throw new Error('You are not allowed to send messages in this conversation.');
  }

  const isSelfChat = conversation.participantA === conversation.participantB;
  if (isSelfChat && viewOnce) {
    throw new Error('View Once is not available in self-chat.');
  }

  const recipientId = conversation.participantA === senderId ? conversation.participantB : conversation.participantA;
  const conversationRef = doc(db, 'conversations', conversation.id);
  const friendshipRef = isSelfChat ? null : doc(db, 'friendships', conversation.id);
  const blockRef = isSelfChat ? null : doc(db, 'userBlocks', `${senderId}_${recipientId}`);
  const messageRef = doc(collection(db, 'conversations', conversation.id, 'messages'));
  await runTransaction(db, async (transaction) => {
    const replyMsgRef = reply
      ? doc(db, 'conversations', conversation.id, 'messages', reply.replyToMessageId)
      : null;

    const [conversationSnapshot, friendshipSnapshot, blockSnapshot, replySnapshot] = await Promise.all([
      transaction.get(conversationRef),
      friendshipRef ? transaction.get(friendshipRef) : Promise.resolve(null),
      blockRef ? transaction.get(blockRef) : Promise.resolve(null),
      replyMsgRef ? transaction.get(replyMsgRef) : Promise.resolve(null),
    ]);
    if (!conversationSnapshot.exists()) {
      throw new Error('This conversation is no longer available.');
    }
    if (!isSelfChat) {
      if (blockSnapshot?.exists()) {
        throw new Error('You have blocked this user.');
      }
      if (!friendshipSnapshot?.exists()) {
        throw new Error('You can only message accepted friends.');
      }
    }
    if (reply) {
      if (!replySnapshot || !replySnapshot.exists()) {
        throw new Error('The referenced reply message could not be found.');
      }
      const replyData = replySnapshot.data();
      if (replyData.deletedAt) {
        throw new Error('Cannot reply to a deleted message.');
      }
      if (replyData.callId) {
        throw new Error('Cannot reply to a call record.');
      }
      if (replyData.senderId !== reply.replyToSenderId) {
        throw new Error('Reply sender does not match original message.');
      }
      if (replyData.viewOnce) {
        if (reply.replyToType !== 'viewOnce' || reply.replyToText !== 'View Once media') {
          throw new Error('View Once reply preview must be generic.');
        }
      }
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
      ...(reply ? {
        replyToMessageId: reply.replyToMessageId,
        replyToSenderId: reply.replyToSenderId,
        replyToText: reply.replyToText.slice(0, 500),
        replyToType: reply.replyToType,
      } : {}),
      ...(audioUrl ? {
        audioUrl,
        audioDurationMs,
        ...(audioMimeType ? { audioMimeType } : {}),
      } : {}),
      createdAt: serverTimestamp(),
      deliveredAt: null,
      seenAt: null,
      ...(forwarded ? { forwarded: true } : {}),
    });
    transaction.update(conversationRef, {
      lastMessage: viewOnce ? 'View once media' : audioUrl ? 'Voice message' : imageUrl ? 'Photo' : videoUrl ? 'Video' : file ? `File: ${file.fileName}` : cleanText,
      lastMessageAt: serverTimestamp(),
      lastMessageSenderId: senderId,
    });
  });

  if (!isSelfChat) {
    void dispatchPushNotification({
      recipientUid: recipientId,
      kind: 'message',
      data: {
        conversationId: conversation.id,
        messageId: messageRef.id,
      },
    }).catch((pushErr) => {
      console.warn('[Rocket notifications] message push dispatch failed', pushErr);
    });
  }
}

export const ALLOWED_REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🔥'] as const;
export type AllowedReaction = (typeof ALLOWED_REACTIONS)[number];

export async function toggleMessageReaction(
  conversationId: string,
  messageId: string,
  userId: string,
  emoji: string,
  currentReaction?: string | null,
): Promise<void> {
  if (!conversationId || !messageId || !userId) return;
  const msgRef = doc(db, 'conversations', conversationId, 'messages', messageId);

  if (currentReaction === emoji) {
    await updateDoc(msgRef, {
      [`reactions.${userId}`]: deleteField(),
    });
  } else {
    if (!ALLOWED_REACTIONS.includes(emoji as AllowedReaction)) {
      throw new Error('This reaction is not supported.');
    }
    await updateDoc(msgRef, {
      [`reactions.${userId}`]: emoji,
    });
  }
}

export async function editMessage(
  conversationId: string,
  messageId: string,
  senderId: string,
  newText: string,
  isLastMessage = false,
): Promise<void> {
  const cleanText = newText.trim();
  if (!cleanText) {
    throw new Error('Message cannot be empty.');
  }
  if (cleanText.length > 5000) {
    throw new Error('Message is too long.');
  }

  const msgRef = doc(db, 'conversations', conversationId, 'messages', messageId);
  const convRef = doc(db, 'conversations', conversationId);

  await runTransaction(db, async (transaction) => {
    const [msgSnapshot, convSnapshot] = await Promise.all([
      transaction.get(msgRef),
      transaction.get(convRef),
    ]);
    if (!msgSnapshot.exists()) {
      throw new Error('This message could not be found.');
    }
    const data = msgSnapshot.data();
    if (data.senderId !== senderId) {
      throw new Error('You can only edit your own messages.');
    }
    if (data.deletedAt) {
      throw new Error('Deleted messages cannot be edited.');
    }
    if (data.callId || data.viewOnce || data.imageUrl || data.videoUrl || data.fileUrl) {
      throw new Error('Only text messages can be edited.');
    }

    transaction.update(msgRef, {
      text: cleanText,
      editedAt: serverTimestamp(),
    });

    if (convSnapshot.exists()) {
      const convData = convSnapshot.data();
      const isActuallyLastMessage =
        convData.lastMessageSenderId === senderId &&
        convData.lastMessageAt &&
        data.createdAt &&
        convData.lastMessageAt.toMillis() === data.createdAt.toMillis();

      if (isActuallyLastMessage) {
        transaction.update(convRef, {
          lastMessage: cleanText,
        });
      }
    }
  });
}

export async function deleteMessage(
  conversationId: string,
  messageId: string,
  userId: string,
  isLastMessage = false,
): Promise<void> {
  const msgRef = doc(db, 'conversations', conversationId, 'messages', messageId);
  const convRef = doc(db, 'conversations', conversationId);

  let liveShareIdToStop: string | null = null;
  try {
    const preSnap = await getDoc(msgRef);
    if (preSnap.exists()) {
      const data = preSnap.data();
      if (data.locationType === 'live' && data.liveLocationShareId) {
        liveShareIdToStop = data.liveLocationShareId;
      }
    }
  } catch (e) {
    // Ignore error fetching pre-transaction state
  }

  try {
    await runTransaction(db, async (transaction) => {
      const [msgSnapshot, convSnapshot] = await Promise.all([
        transaction.get(msgRef),
        transaction.get(convRef),
      ]);
      if (!msgSnapshot.exists()) {
        throw new Error('This message could not be found.');
      }
      const data = msgSnapshot.data();
      if (data.senderId !== userId) {
        throw new Error('You can only delete your own messages.');
      }
      if (data.deletedAt) {
        return;
      }
      if (data.callId) {
        throw new Error('Call records cannot be deleted.');
      }

      // Stop active live location share if deleting a live location message
      if (data.locationType === 'live' && data.liveLocationShareId) {
        liveShareIdToStop = data.liveLocationShareId; // ensure it's captured
        const liveLocRef = doc(db, 'conversations', conversationId, 'liveLocations', data.liveLocationShareId);
        const liveLocSnap = await transaction.get(liveLocRef);
        if (liveLocSnap.exists()) {
          const liveLocData = liveLocSnap.data();
          if (!liveLocData.stoppedAt) {
            transaction.update(liveLocRef, {
              stoppedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        }
      }

      transaction.update(msgRef, {
        deletedAt: serverTimestamp(),
        deletedBy: userId,
      });

      if (convSnapshot.exists()) {
        const convData = convSnapshot.data();
        const isActuallyLastMessage =
          convData.lastMessageSenderId === userId &&
          convData.lastMessageAt &&
          data.createdAt &&
          convData.lastMessageAt.toMillis() === data.createdAt.toMillis();

        if (isActuallyLastMessage) {
          transaction.update(convRef, {
            lastMessage: 'This message was deleted',
          });
        }
      }
    });
  } finally {
    if (liveShareIdToStop) {
      await liveLocationManager.stopTracking(liveShareIdToStop);
    }
  }
}

let currentActiveChatConversationId: string | null = null;

export function setActiveChatConversationId(conversationId: string | null): void {
  currentActiveChatConversationId = conversationId;
}

export function getActiveChatConversationId(): string | null {
  return currentActiveChatConversationId;
}

export async function markMessagesDelivered(
  conversationId: string,
  messageIds: string[],
  recipientId: string,
): Promise<void> {
  if (!conversationId || messageIds.length === 0) return;
  const batch = writeBatch(db);
  const now = serverTimestamp();
  const targetIds = messageIds.slice(0, 100);
  for (const messageId of targetIds) {
    const msgRef = doc(db, 'conversations', conversationId, 'messages', messageId);
    batch.update(msgRef, {
      deliveredAt: now,
    });
  }
  await batch.commit();
}

export type MessageToMarkSeen = {
  id: string;
  deliveredAt?: Timestamp | null;
};

export async function markMessagesSeen(
  conversationId: string,
  messages: Array<string | MessageToMarkSeen>,
  recipientId: string,
): Promise<void> {
  if (!conversationId || messages.length === 0) return;
  const batch = writeBatch(db);
  const now = serverTimestamp();
  const targetItems = messages.slice(0, 100);
  for (const item of targetItems) {
    const messageId = typeof item === 'string' ? item : item.id;
    const isAlreadyDelivered = typeof item === 'object' && !!item.deliveredAt;
    const msgRef = doc(db, 'conversations', conversationId, 'messages', messageId);
    if (isAlreadyDelivered) {
      batch.update(msgRef, {
        seenAt: now,
      });
    } else {
      batch.update(msgRef, {
        deliveredAt: now,
        seenAt: now,
      });
    }
  }
  await batch.commit();
}

export function startDeliveryObserver(currentUid: string): () => void {
  if (!currentUid) return () => undefined;

  const processedTimes = new Map<string, number>();

  return subscribeToConversations(
    currentUid,
    (conversations) => {
      for (const conversation of conversations) {
        if (
          !conversation.lastMessageSenderId ||
          conversation.lastMessageSenderId === currentUid ||
          !conversation.lastMessageAt
        ) {
          continue;
        }

        const msgTime = conversation.lastMessageAt.toMillis();
        const prevTime = processedTimes.get(conversation.id) ?? 0;
        if (msgTime <= prevTime) {
          continue;
        }
        processedTimes.set(conversation.id, msgTime);

        // If user is currently actively viewing this conversation, the chat screen handles seen/delivered
        if (currentActiveChatConversationId === conversation.id) {
          continue;
        }

        // Query the latest incoming messages for this conversation to mark them delivered
        const recentMessagesQuery = query(
          collection(db, 'conversations', conversation.id, 'messages'),
          orderBy('createdAt', 'desc'),
          limit(10),
        );

        void getDocs(recentMessagesQuery)
          .then((snapshot) => {
            const undeliveredIds: string[] = [];
            for (const docSnapshot of snapshot.docs) {
              const data = docSnapshot.data();
              if (
                data.recipientId === currentUid &&
                !data.deliveredAt &&
                !data.callId &&
                !docSnapshot.id.startsWith('call_')
              ) {
                undeliveredIds.push(docSnapshot.id);
              }
            }
            if (undeliveredIds.length > 0) {
              void markMessagesDelivered(conversation.id, undeliveredIds, currentUid);
            }
          })
          .catch((err) => {
            console.warn('[Rocket delivery observer] failed to check messages', err);
          });
      }
    },
    (error) => {
      console.warn('[Rocket delivery observer] conversation subscription error', error);
    },
  );
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

export async function sendLocationMessage(
  conversation: Conversation,
  senderId: string,
  latitude: number,
  longitude: number
): Promise<void> {
  if (!isValidCoordinates(latitude, longitude)) {
    throw new Error('Invalid coordinates.');
  }

  const isSelfChat = conversation.participantA === conversation.participantB;
  if (isSelfChat) {
    throw new Error('Location sharing is not supported in Message Yourself.');
  }

  if (conversation.participantA !== senderId && conversation.participantB !== senderId) {
    throw new Error('You are not allowed to send messages in this conversation.');
  }

  const recipientId = conversation.participantA === senderId ? conversation.participantB : conversation.participantA;
  const conversationRef = doc(db, 'conversations', conversation.id);
  const friendshipRef = doc(db, 'friendships', conversation.id);
  const blockRef = doc(db, 'userBlocks', `${senderId}_${recipientId}`);
  const messageRef = doc(collection(db, 'conversations', conversation.id, 'messages'));

  await runTransaction(db, async (transaction) => {
    const [conversationSnapshot, friendshipSnapshot, blockSnapshot] = await Promise.all([
      transaction.get(conversationRef),
      transaction.get(friendshipRef),
      transaction.get(blockRef),
    ]);

    if (!conversationSnapshot.exists()) {
      throw new Error('This conversation is no longer available.');
    }
    if (blockSnapshot?.exists()) {
      throw new Error('You have blocked this user.');
    }
    if (!friendshipSnapshot?.exists()) {
      throw new Error('You can only message accepted friends.');
    }

    transaction.set(messageRef, {
      senderId,
      recipientId,
      text: '📍 Location',
      location: { latitude, longitude },
      locationType: 'current',
      createdAt: serverTimestamp(),
      deliveredAt: null,
      seenAt: null,
    });

    transaction.update(conversationRef, {
      lastMessage: 'Location',
      lastMessageAt: serverTimestamp(),
      lastMessageSenderId: senderId,
    });
  });

  void dispatchPushNotification({
    recipientUid: recipientId,
    kind: 'message',
    data: {
      conversationId: conversation.id,
      messageId: messageRef.id,
    },
  }).catch((pushErr) => {
    console.warn('[Rocket notifications] location push dispatch failed', pushErr);
  });
}

export async function startLiveLocationMessage(
  conversation: Conversation,
  senderId: string,
  latitude: number,
  longitude: number,
  durationMinutes: LiveLocationDuration
): Promise<string> {
  if (!isValidCoordinates(latitude, longitude)) {
    throw new Error('Invalid coordinates.');
  }

  const isSelfChat = conversation.participantA === conversation.participantB;
  if (isSelfChat) {
    throw new Error('Live location is not supported in Message Yourself.');
  }

  if (conversation.participantA !== senderId && conversation.participantB !== senderId) {
    throw new Error('You are not allowed to send messages in this conversation.');
  }

  const recipientId = conversation.participantA === senderId ? conversation.participantB : conversation.participantA;
  const conversationRef = doc(db, 'conversations', conversation.id);
  const friendshipRef = doc(db, 'friendships', conversation.id);
  const blockRef = doc(db, 'userBlocks', `${senderId}_${recipientId}`);
  const messageRef = doc(collection(db, 'conversations', conversation.id, 'messages'));
  const liveLocationRef = doc(collection(db, 'conversations', conversation.id, 'liveLocations'));
  const shareId = liveLocationRef.id;

  const expiresAtMillis = Date.now() + durationMinutes * 60 * 1000;

  await runTransaction(db, async (transaction) => {
    const [conversationSnapshot, friendshipSnapshot, blockSnapshot] = await Promise.all([
      transaction.get(conversationRef),
      transaction.get(friendshipRef),
      transaction.get(blockRef),
    ]);

    if (!conversationSnapshot.exists()) {
      throw new Error('This conversation is no longer available.');
    }
    if (blockSnapshot?.exists()) {
      throw new Error('You have blocked this user.');
    }
    if (!friendshipSnapshot?.exists()) {
      throw new Error('You can only message accepted friends.');
    }

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
      recipientId,
      text: '📡 Live location',
      locationType: 'live',
      liveLocationShareId: shareId,
      createdAt: serverTimestamp(),
      deliveredAt: null,
      seenAt: null,
    });

    transaction.update(conversationRef, {
      lastMessage: 'Live location',
      lastMessageAt: serverTimestamp(),
      lastMessageSenderId: senderId,
    });
  });

  void dispatchPushNotification({
    recipientUid: recipientId,
    kind: 'message',
    data: {
      conversationId: conversation.id,
      messageId: messageRef.id,
    },
  }).catch((pushErr) => {
    console.warn('[Rocket notifications] live location push dispatch failed', pushErr);
  });

  await liveLocationManager.startTracking(
    shareId,
    { latitude, longitude },
    expiresAtMillis,
    async (coords) => {
      await updateLiveLocationCoordinates(conversation.id, shareId, senderId, coords.latitude, coords.longitude);
    },
    () => {
      // Stopped
    }
  );

  return shareId;
}

export async function updateLiveLocationCoordinates(
  conversationId: string,
  shareId: string,
  senderId: string,
  latitude: number,
  longitude: number
): Promise<void> {
  if (!isValidCoordinates(latitude, longitude)) return;
  const liveLocationRef = doc(db, 'conversations', conversationId, 'liveLocations', shareId);
  await updateDoc(liveLocationRef, {
    latitude,
    longitude,
    updatedAt: serverTimestamp(),
  });
}

export async function stopLiveLocationShare(
  conversationId: string,
  shareId: string,
  senderId: string
): Promise<void> {
  const liveLocationRef = doc(db, 'conversations', conversationId, 'liveLocations', shareId);
  try {
    await updateDoc(liveLocationRef, {
      stoppedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } finally {
    await liveLocationManager.stopTracking(shareId);
  }
}

export function subscribeToLiveLocationDoc(
  conversationId: string,
  shareId: string,
  onUpdate: (data: LiveLocation | null) => void,
  onError: (err: Error) => void
): () => void {
  const liveLocationRef = doc(db, 'conversations', conversationId, 'liveLocations', shareId);
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
