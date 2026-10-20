import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as IntentLauncher from 'expo-intent-launcher';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { doc, onSnapshot } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RocketChatSearchBar } from '@/components/RocketChatSearchBar';
import { RocketForwardPickerModal } from '@/components/RocketForwardPickerModal';
import { RocketLocationCard } from '@/components/RocketLocationCard';
import { RocketLocationPickerSheet } from '@/components/RocketLocationPickerSheet';
import { RocketSearchHighlightText } from '@/components/RocketSearchHighlightText';
import { RocketSwipeToReply } from '@/components/RocketSwipeToReply';
import { RocketVoiceMessage } from '@/components/RocketVoiceMessage';
import { RocketVoiceRecorder, VoiceMessageMimeType } from '@/components/RocketVoiceRecorder';
import {
  Radius,
  RocketAvatar,
  RocketIconButton,
  RocketLoadingIndicator,
  RocketPressable,
  RocketSpark,
  RocketText,
  SpacingScale,
  useRocketTheme,
} from '@/design-system';
import { db } from '@/lib/firebase';
import { useAuth } from '@/providers/auth-provider';
import { getResumableCallForConversation, startOutgoingCall } from '@/services/call-service';
import { uploadChatFile, uploadChatVideo, uploadPostImage, uploadVoiceMessage } from '@/services/cloudinary-service';
import { Coordinates, LiveLocationDuration } from '@/services/location-service';
import {
  ALLOWED_REACTIONS,
  ChatFile,
  ChatMessage,
  Conversation,
  deleteMessage,
  editMessage,
  extractForwardablePayload,
  ForwardableMessagePayload,
  getConversation,
  getFirestoreTimestampMillis,
  getOlderMessages,
  inferAudioMimeType,
  markMessagesSeen,
  markViewOnceMessageViewed,
  ReplyMetadata,
  sendLocationMessage,
  sendMessage,
  setActiveChatConversationId,
  startLiveLocationMessage,
  stopLiveLocationShare,
  subscribeToMessages,
  toggleMessageReaction,
} from '@/services/messaging-service';
import {
  formatLastSeen,
  isUserOnline,
  subscribeToUserPresence,
  UserPresence,
} from '@/services/presence-service';
import { setTypingState, subscribeToTyping } from '@/services/typing-service';
import { getProfileColor, getProfileInitials } from '@/services/user-service';
import {
  getResumableVideoCallForConversation,
  startOutgoingVideoCall,
} from '@/services/video-call-service';

function formatTime(message: ChatMessage) {
  if (!message.createdAt) return '';
  return message.createdAt.toDate().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatCallDuration(message: ChatMessage) {
  const answeredAtMillis = getFirestoreTimestampMillis(message.callAnsweredAt);
  const endedAtMillis = getFirestoreTimestampMillis(message.callEndedAt);
  if (answeredAtMillis == null || endedAtMillis == null) return 'Completed';
  const totalSeconds = Math.max(0, Math.floor((endedAtMillis - answeredAtMillis) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function isCallHistoryMessage(message: ChatMessage) {
  return message.id.startsWith('call_') || (!!message.callId && !!message.callerId && !!message.calleeId && !!message.callOutcome);
}

function callHistoryLabel(message: ChatMessage, currentUid: string | undefined) {
  const outgoing = message.callerId === currentUid;
  if (message.callOutcome === 'cancelled') {
    return outgoing ? 'Outgoing voice call · Cancelled' : 'Missed voice call';
  }
  if (message.callOutcome === 'declined') {
    return outgoing ? 'Outgoing voice call · Declined' : 'Incoming voice call · Declined';
  }
  return `${outgoing ? 'Outgoing' : 'Incoming'} voice call · ${formatCallDuration(message)}`;
}

function formatFileSize(size: number | null) {
  if (size == null) return null;
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function fileCacheKey(url: string) {
  let hash = 2166136261;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function safeFileName(name: string | null | undefined) {
  const normalized = name
    ?.normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_')
    .trim()
    .replace(/[. ]+$/g, '');
  if (!normalized || normalized === '.' || normalized === '..') return 'attachment';

  if (normalized.length <= 120) return normalized;
  const extension = normalized.match(/(\.[^.]+)$/)?.[1] ?? '';
  return `${normalized.slice(0, Math.max(1, 120 - extension.length))}${extension}`;
}

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rtf: 'application/rtf',
  txt: 'text/plain',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
};

function resolveFileMimeType(name: string, storedMimeType: string | null | undefined) {
  const mimeType = storedMimeType?.trim().toLowerCase();
  const isSpecificMimeType =
    !!mimeType &&
    mimeType !== '*/*' &&
    mimeType !== 'application/octet-stream' &&
    mimeType !== 'application/unknown' &&
    /^[-\w.+]+\/[-\w.+]+$/.test(mimeType);
  if (isSpecificMimeType) return mimeType;

  const extension = name.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  return extension
    ? MIME_TYPES_BY_EXTENSION[extension] ?? 'application/octet-stream'
    : 'application/octet-stream';
}

function redactFileOpenError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/\S+/g, '[remote URL]');
}

function ChatVideo({ url, onPress }: { url: string; onPress?: () => void }) {
  const player = useVideoPlayer(url, (videoPlayer) => {
    videoPlayer.loop = false;
  });

  return (
    <Pressable onPress={onPress} style={videoStyles.playerPressable}>
      <VideoView
        contentFit="contain"
        nativeControls
        player={player}
        style={videoStyles.player}
        surfaceType="textureView"
      />
    </Pressable>
  );
}

function ViewOnceVideo({ url, onAvailable }: { url: string; onAvailable: () => void }) {
  const player = useVideoPlayer(url, (videoPlayer) => {
    videoPlayer.loop = false;
  });

  return (
    <VideoView
      contentFit="contain"
      nativeControls
      onFirstFrameRender={onAvailable}
      player={player}
      style={viewOnceStyles.media}
      surfaceType="textureView"
    />
  );
}

function FullscreenVideoViewer({ url, onClose }: { url: string; onClose: () => void }) {
  const player = useVideoPlayer(url, (videoPlayer) => {
    videoPlayer.loop = false;
  });

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent={false}
      visible>
      <View style={viewerModalStyles.container}>
        <RocketIconButton
          accessibilityLabel="Close video viewer"
          glyph="✕"
          glyphStyle={viewerModalStyles.closeText}
          onPress={onClose}
          size="md"
          style={viewerModalStyles.closeButton}
          variant="filled"
        />
        <VideoView
          contentFit="contain"
          nativeControls
          player={player}
          style={viewerModalStyles.video}
          surfaceType="textureView"
        />
      </View>
    </Modal>
  );
}

function ViewOnceViewer({
  message,
  onClose,
  onAvailable,
}: {
  message: ChatMessage;
  onClose: () => void;
  onAvailable: () => void;
}) {
  usePreventScreenCapture(`rocket-view-once-${message.id}`);
  const [loadFailed, setLoadFailed] = useState(false);
  const [mediaAvailable, setMediaAvailable] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setLoadFailed((failed) => (mediaAvailable ? failed : true));
    }, 15000);
    return () => clearTimeout(timeout);
  }, [mediaAvailable]);

  const handleAvailable = () => {
    setMediaAvailable(true);
    onAvailable();
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent={false}
      visible>
      <View style={viewOnceStyles.viewer}>
        <RocketIconButton
          accessibilityLabel="Close view once media"
          glyph="✕"
          glyphStyle={viewOnceStyles.closeText}
          onPress={onClose}
          size="md"
          style={viewOnceStyles.close}
          variant="filled"
        />
        {message.imageUrl ? (
          <Image
            contentFit="contain"
            onError={() => setLoadFailed(true)}
            onLoad={handleAvailable}
            source={message.imageUrl}
            style={viewOnceStyles.media}
          />
        ) : null}
        {message.videoUrl ? (
          <ViewOnceVideo onAvailable={handleAvailable} url={message.videoUrl} />
        ) : null}
        {loadFailed ? (
          <Text style={viewOnceStyles.error}>This media could not be loaded.</Text>
        ) : !mediaAvailable ? (
          <View pointerEvents="none" style={viewOnceStyles.loading}>
            <RocketLoadingIndicator size="normal" />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function getMessageReactionChips(
  reactions: Record<string, string> | null | undefined,
  currentUserId: string | undefined
): Array<{ emoji: string; count: number; reactedByMe: boolean }> {
  if (!reactions) return [];
  const counts = new Map<string, { count: number; reactedByMe: boolean }>();
  for (const [uid, emoji] of Object.entries(reactions)) {
    if (!emoji) continue;
    const existing = counts.get(emoji) ?? { count: 0, reactedByMe: false };
    existing.count += 1;
    if (uid === currentUserId) existing.reactedByMe = true;
    counts.set(emoji, existing);
  }
  return Array.from(counts.entries()).map(([emoji, data]) => ({
    emoji,
    count: data.count,
    reactedByMe: data.reactedByMe,
  }));
}

type PendingMedia = {
  kind: 'image' | 'video';
  asset: ImagePicker.ImagePickerAsset;
};

function isAudioDocument(asset: DocumentPicker.DocumentPickerAsset): boolean {
  if (asset.mimeType?.toLowerCase().startsWith('audio/')) return true;
  return /\.(aac|aif|aiff|flac|m4a|mp3|oga|ogg|opus|wav|wma)$/i.test(asset.name);
}

export default function ChatScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { colors } = useRocketTheme();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [selectedMedia, setSelectedMedia] = useState<PendingMedia[]>([]);
  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [isVoiceRecordingActive, setIsVoiceRecordingActive] = useState(false);
  const [sendMediaViewOnce, setSendMediaViewOnce] = useState(false);
  const [photoViewerUrl, setPhotoViewerUrl] = useState<string | null>(null);
  const [videoViewerUrl, setVideoViewerUrl] = useState<string | null>(null);
  const [viewOnceMessage, setViewOnceMessage] = useState<ChatMessage | null>(null);
  const [replyingToMessage, setReplyingToMessage] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [actionTargetMessage, setActionTargetMessage] = useState<ChatMessage | null>(null);
  const [forwardingPayload, setForwardingPayload] = useState<ForwardableMessagePayload | null>(null);
  const [isForwardModalVisible, setIsForwardModalVisible] = useState(false);
  const [forwardSuccessMessage, setForwardSuccessMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendingProgress, setSendingProgress] = useState<{ current: number; total: number } | null>(
    null
  );
  const [startingCall, setStartingCall] = useState(false);
  const [startingVideoCall, setStartingVideoCall] = useState(false);
  const [isFriend, setIsFriend] = useState<boolean | null>(null);
  const [isBlockedByUser, setIsBlockedByUser] = useState(false);
  const [error, setError] = useState('');
  const [presence, setPresence] = useState<UserPresence | null>(null);
  const [isOtherUserTyping, setIsOtherUserTyping] = useState(false);

  const lastTypingWrittenAt = useRef<number>(0);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markingSeenIds = useRef<Set<string>>(new Set());
  const openingFileUrls = useRef(new Set<string>());
  const [openingFileUrl, setOpeningFileUrl] = useState<string | null>(null);
  const openingViewOnceIds = useRef(new Set<string>());
  const activeViewOnceMessageId = useRef<string | null>(null);
  const viewOnceAvailable = useRef(false);
  const messagesScrollRef = useRef<ScrollView>(null);
  const initialScrollPending = useRef(true);
    useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      setTimeout(() => {
        messagesScrollRef.current?.scrollToEnd({ animated: true });
      }, 100);
    });

    return () => subscription.remove();
  }, []);

  const isSelfChat = !!user && conversationId === `${user.uid}_${user.uid}`;

  const [isLocationSheetOpen, setIsLocationSheetOpen] = useState(false);

  async function handleSendVoiceMessage(uri: string, durationMs: number, mimeType: VoiceMessageMimeType) {
    if (!conversation || !user) throw new Error('The conversation is not ready to send a voice message.');
    if (sending) throw new Error('Another message is still being sent. Please retry in a moment.');
    if ((!isSelfChat && isFriend === false) || isBlockedByUser) {
      throw new Error('You cannot send a voice message in this conversation.');
    }
    setSending(true);
    setError('');
    try {
      const secureUrl = await uploadVoiceMessage(uri);
      await sendMessage(
        conversation,
        user.uid,
        '', // No text
        null, // No image
        null, // No video
        null, // No file
        false, // Not viewOnce
        replyingToMessage
          ? {
              replyToMessageId: replyingToMessage.id,
              replyToSenderId: replyingToMessage.senderId,
              replyToText: replyingToMessage.text
                ? replyingToMessage.text.slice(0, 100)
                : replyingToMessage.locationType === 'current'
                  ? '📍 Current location'
                  : replyingToMessage.locationType === 'live'
                    ? '📡 Live location'
                    : replyingToMessage.audioUrl
                      ? 'Voice message'
                      : replyingToMessage.imageUrl
                        ? 'Photo'
                        : replyingToMessage.videoUrl
                          ? 'Video'
                          : replyingToMessage.fileUrl
                            ? replyingToMessage.fileName || 'File'
                            : 'Attachment',
              replyToType: replyingToMessage.viewOnce
                ? 'viewOnce'
                : replyingToMessage.imageUrl
                  ? 'image'
                  : replyingToMessage.videoUrl
                    ? 'video'
                    : replyingToMessage.fileUrl || replyingToMessage.audioUrl
                      ? 'file'
                      : 'text',
            }
          : null,
        false, // Not forwarded
        secureUrl,
        durationMs,
        mimeType
      );
      setReplyingToMessage(null);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Could not send voice message.');
      throw err;
    } finally {
      setSending(false);
    }
  }

  async function handleSendCurrentLocation(coords: Coordinates) {
    if (!conversation || !user) return;
    await sendLocationMessage(conversation, user.uid, coords.latitude, coords.longitude);
  }

  async function handleStartLiveLocation(coords: Coordinates, duration: LiveLocationDuration) {
    if (!conversation || !user) return;
    await startLiveLocationMessage(conversation, user.uid, coords.latitude, coords.longitude, duration);
  }

  async function handleStopLiveSharing(shareId: string) {
    if (!user) return;
    await stopLiveLocationShare(conversationId, shareId, user.uid);
  }

  // In-Chat Message Search State
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [isSearchingOlder, setIsSearchingOlder] = useState(false);
  const [hasReachedBeginning, setHasReachedBeginning] = useState(false);
  const [olderMessages, setOlderMessages] = useState<ChatMessage[]>([]);
  const messageYPositions = useRef<Record<string, number>>({});

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const allMessages = useMemo(() => {
    if (olderMessages.length === 0) return messages;
    const seen = new Set<string>();
    const list: ChatMessage[] = [];
    for (const m of olderMessages) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        list.push(m);
      }
    }
    for (const m of messages) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        list.push(m);
      }
    }
    return list;
  }, [olderMessages, messages]);

  useEffect(() => {
    if (messages.length > 0 && messages.length < 200) {
      setHasReachedBeginning(true);
    }
  }, [messages.length]);

  const matchingMessages = useMemo(() => {
    const trimmed = debouncedQuery.trim().toLowerCase();
    if (!isSearchOpen || !trimmed) return [];
    return allMessages.filter((msg) => {
      if (msg.deletedAt || msg.callId || msg.viewOnce) return false;
      const text = (msg.text || '').toLowerCase();
      const fileName = (msg.fileName || '').toLowerCase();
      return text.includes(trimmed) || fileName.includes(trimmed);
    });
  }, [allMessages, debouncedQuery, isSearchOpen]);

  const activeHighlightMessageId = useMemo(() => {
    if (matchingMessages.length === 0) return null;
    const safeIndex = Math.min(Math.max(0, currentMatchIndex), matchingMessages.length - 1);
    return matchingMessages[safeIndex]?.id ?? null;
  }, [matchingMessages, currentMatchIndex]);

  useEffect(() => {
    if (!activeHighlightMessageId) return;
    const y = messageYPositions.current[activeHighlightMessageId];
    if (y !== undefined) {
      messagesScrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
    }
  }, [activeHighlightMessageId]);

  const lastActiveMatchIdRef = useRef<string | null>(null);
  const prevDebouncedQueryRef = useRef<string>(debouncedQuery);

  useEffect(() => {
    const queryChanged = prevDebouncedQueryRef.current !== debouncedQuery;
    prevDebouncedQueryRef.current = debouncedQuery;

    if (matchingMessages.length === 0) {
      setCurrentMatchIndex(0);
      lastActiveMatchIdRef.current = null;
      return;
    }

    if (queryChanged) {
      const nextIndex = matchingMessages.length - 1;
      setCurrentMatchIndex(nextIndex);
      lastActiveMatchIdRef.current = matchingMessages[nextIndex]?.id ?? null;
      return;
    }

    setCurrentMatchIndex((prevIndex) => {
      const targetId = lastActiveMatchIdRef.current;
      if (targetId) {
        const foundIndex = matchingMessages.findIndex((m) => m.id === targetId);
        if (foundIndex !== -1) {
          return foundIndex;
        }
      }

      const clampedIndex = Math.min(Math.max(0, prevIndex), matchingMessages.length - 1);
      lastActiveMatchIdRef.current = matchingMessages[clampedIndex]?.id ?? null;
      return clampedIndex;
    });
  }, [matchingMessages, debouncedQuery]);

  const handleNextMatch = useCallback(() => {
    if (matchingMessages.length <= 1) return;
    setCurrentMatchIndex((prev) => {
      const next = prev < matchingMessages.length - 1 ? prev + 1 : 0;
      lastActiveMatchIdRef.current = matchingMessages[next]?.id ?? null;
      return next;
    });
  }, [matchingMessages]);

  const handlePrevMatch = useCallback(() => {
    if (matchingMessages.length <= 1) return;
    setCurrentMatchIndex((prev) => {
      const prevIdx = prev > 0 ? prev - 1 : matchingMessages.length - 1;
      lastActiveMatchIdRef.current = matchingMessages[prevIdx]?.id ?? null;
      return prevIdx;
    });
  }, [matchingMessages]);

  const handleOpenSearch = useCallback(() => {
    setIsSearchOpen(true);
    setSearchQuery('');
    setDebouncedQuery('');
    setCurrentMatchIndex(0);
    lastActiveMatchIdRef.current = null;
  }, []);

  const handleCloseSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery('');
    setDebouncedQuery('');
    setCurrentMatchIndex(0);
    lastActiveMatchIdRef.current = null;
  }, []);

  const handleSearchOlder = useCallback(async () => {
    if (isSearchingOlder || hasReachedBeginning || allMessages.length === 0) return;
    const oldest = allMessages[0];
    if (!oldest.createdAt) {
      setHasReachedBeginning(true);
      return;
    }
    setIsSearchingOlder(true);
    try {
      const older = await getOlderMessages(conversationId, oldest.createdAt, oldest.id, 50);
      if (older.length < 50) {
        setHasReachedBeginning(true);
      }
      if (older.length > 0) {
        setOlderMessages((prev) => [...older, ...prev]);
      }
    } catch (err) {
      console.warn('Failed to load older messages for search', err);
    } finally {
      setIsSearchingOlder(false);
    }
  }, [isSearchingOlder, hasReachedBeginning, allMessages, conversationId]);

  useEffect(() => {
    if (!user || !conversationId) return;
    setActiveChatConversationId(conversationId);
    let active = true;
    initialScrollPending.current = true;
    setLoading(true);
    setError('');

    void getConversation(conversationId, user.uid)
      .then((nextConversation) => {
        if (!active) return;
        setConversation(nextConversation);
        setLoading(false);
      })
      .catch((loadError) => {
        if (!active) return;
        const firestoreError = loadError as Error & { code?: string };
        console.error('[Rocket chat Firestore] operation failed', {
          operation: 'get',
          path: `conversations/${conversationId}`,
          uid: user.uid,
          code: firestoreError.code ?? 'unknown',
          message: firestoreError.message,
        });
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'This conversation could not be loaded.'
        );
        setLoading(false);
      });

    let unsubscribeFriendship: () => void = () => undefined;
    let unsubscribeBlock: () => void = () => undefined;
    let unsubscribePresence: () => void = () => undefined;
    let unsubscribeTyping: () => void = () => undefined;

    if (isSelfChat) {
      setIsFriend(true);
      setIsBlockedByUser(false);
    } else {
      const friendshipRef = doc(db, 'friendships', conversationId);
      unsubscribeFriendship = onSnapshot(
        friendshipRef,
        (snapshot) => {
          if (!active) return;
          setIsFriend(snapshot.exists());
        },
        () => {
          if (!active) return;
          setIsFriend(false);
        }
      );

      const otherUid = conversationId.split('_').find((id) => id !== user.uid) || '';
      if (otherUid) {
        const blockRef = doc(db, 'userBlocks', `${user.uid}_${otherUid}`);
        unsubscribeBlock = onSnapshot(
          blockRef,
          (snapshot) => {
            if (!active) return;
            setIsBlockedByUser(snapshot.exists());
          },
          () => {
            if (!active) return;
            setIsBlockedByUser(false);
          }
        );

        unsubscribePresence = subscribeToUserPresence(otherUid, (nextPresence) => {
          if (!active) return;
          setPresence(nextPresence);
        });

        unsubscribeTyping = subscribeToTyping(conversationId, otherUid, (typing) => {
          if (!active) return;
          setIsOtherUserTyping(typing);
        });
      }
    }

    const unsubscribe = subscribeToMessages(
      conversationId,
      (nextMessages) => {
        setMessages(nextMessages);
        if (nextMessages.length === 0) initialScrollPending.current = false;

        // Automatically mark incoming messages as seen (1:1 direct chat only)
        if (user && !isSelfChat) {
          const unseenMessages: Array<{ id: string; deliveredAt?: any }> = [];
          for (const msg of nextMessages) {
            if (
              msg.recipientId === user.uid &&
              !msg.seenAt &&
              !isCallHistoryMessage(msg) &&
              !markingSeenIds.current.has(msg.id)
            ) {
              unseenMessages.push({ id: msg.id, deliveredAt: msg.deliveredAt });
              markingSeenIds.current.add(msg.id);
            }
          }
          if (unseenMessages.length > 0) {
            void markMessagesSeen(conversationId, unseenMessages, user.uid).catch((err) => {
              console.warn('[Rocket chat] failed to mark messages seen', err);
              unseenMessages.forEach((item) => markingSeenIds.current.delete(item.id));
            });
          }
        }
      },
      (messageError) => {
        if (!active) return;
        const firestoreError = messageError as Error & { code?: string };
        console.error('[Rocket chat Firestore] operation failed', {
          operation: 'list',
          path: `conversations/${conversationId}/messages`,
          uid: user.uid,
          code: firestoreError.code ?? 'unknown',
          message: messageError.message,
        });
        setError(messageError.message || 'Messages could not be loaded.');
      }
    );

    return () => {
      active = false;
      setActiveChatConversationId(null);
      unsubscribe();
      unsubscribeFriendship();
      unsubscribeBlock();
      unsubscribePresence();
      unsubscribeTyping();
      if (typingTimeout.current) {
        clearTimeout(typingTimeout.current);
        typingTimeout.current = null;
      }
      lastTypingWrittenAt.current = 0;
      if (user) {
        void setTypingState(conversationId, user.uid, false);
      }
    };
  }, [conversationId, user]);

  async function handlePickMedia() {
    if (isFriend === false || isBlockedByUser) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Media library access is required to send photos or videos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      base64: true,
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      selectionLimit: 0,
      quality: 0.85,
    });
    if (!result.canceled) {
      if (result.assets.some((asset) => asset.type !== 'image' && asset.type !== 'video')) {
        setError('One of the selected items could not be identified as a photo or video.');
        return;
      }
      setSelectedMedia(
        result.assets.map((asset) => ({ kind: asset.type as PendingMedia['kind'], asset }))
      );
      setSelectedFile(null);
      setSendMediaViewOnce(false);
      setError('');
    }
  }

  async function handleCaptureCamera() {
    if (isFriend === false || isBlockedByUser) return;
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError('Camera access is required to capture a photo or video.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        base64: true,
        mediaTypes: ['images'],
        quality: 0.85,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset || asset.type !== 'image') {
        throw new Error('The camera did not return a supported photo.');
      }
      setSelectedMedia([{ kind: 'image', asset }]);
      setSelectedFile(null);
      setSendMediaViewOnce(false);
      setError('');
    } catch (cameraError) {
      setError(
        cameraError instanceof Error
          ? cameraError.message
          : 'The camera could not capture media.',
      );
    }
  }

  async function handleStartVoiceCall() {
    if (
      !user ||
      !conversation?.otherUser ||
      startingCall ||
      isVoiceRecordingActive ||
      isFriend === false ||
      isBlockedByUser
    ) {
      return;
    }
    setStartingCall(true);
    setError('');
    try {
      const resumableCall = getResumableCallForConversation(conversation.id, user.uid);
      if (resumableCall) {
        router.push(`/call/${resumableCall.id}`);
        return;
      }
      const callId = await startOutgoingCall(
        conversation.id,
        user.uid,
        conversation.otherUser.uid
      );
      router.push(`/call/${callId}`);
    } catch (callError) {
      setError(
        callError instanceof Error ? callError.message : 'The voice call could not be started.'
      );
    } finally {
      setStartingCall(false);
    }
  }

  async function handleStartVideoCall() {
    if (
      !user ||
      !conversation?.otherUser ||
      startingVideoCall ||
      isVoiceRecordingActive ||
      isFriend === false ||
      isBlockedByUser
    ) {
      return;
    }
    setStartingVideoCall(true);
    setError('');
    try {
      const resumableCall = getResumableVideoCallForConversation(conversation.id, user.uid);
      if (resumableCall) {
        router.push(`/video-call/${resumableCall.id}` as any);
        return;
      }
      const callId = await startOutgoingVideoCall(
        conversation.id,
        user.uid,
        conversation.otherUser.uid
      );
      router.push(`/video-call/${callId}` as any);
    } catch (callError) {
      setError(
        callError instanceof Error ? callError.message : 'The video call could not be started.'
      );
    } finally {
      setStartingVideoCall(false);
    }
  }

  async function handlePickFile() {
    if (isFriend === false || isBlockedByUser) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: '*/*',
      });
      if (!result.canceled) {
        const asset = result.assets[0];
        const uriScheme = asset.uri.split(':', 1)[0];
        if (uriScheme !== 'file') {
          throw new Error(
            `The document picker did not return a local cache file (${uriScheme || 'unknown'} URI).`
          );
        }
        setSelectedFile(asset);
        setSelectedMedia([]);
        setSendMediaViewOnce(false);
        setError('');
      }
    } catch (pickError) {
      setError(
        pickError instanceof Error
          ? pickError.message
          : 'The selected file could not be prepared for upload.'
      );
    }
  }

  async function handlePickAudio() {
    if (isFriend === false || isBlockedByUser) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: 'audio/*',
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!isAudioDocument(asset)) {
        throw new Error('Choose a supported audio file.');
      }
      if (asset.uri.split(':', 1)[0] !== 'file') {
        throw new Error('The audio file could not be prepared for upload.');
      }
      setSelectedFile(asset);
      setSelectedMedia([]);
      setSendMediaViewOnce(false);
      setError('');
    } catch (audioError) {
      setError(
        audioError instanceof Error
          ? audioError.message
          : 'The audio file could not be selected.',
      );
    }
  }

  function handleOpenViewOnce(message: ChatMessage) {
    if (
      !user ||
      message.senderId === user.uid ||
      message.viewedAt ||
      openingViewOnceIds.current.has(message.id)
    ) {
      return;
    }
    openingViewOnceIds.current.add(message.id);
    activeViewOnceMessageId.current = message.id;
    viewOnceAvailable.current = false;
    setError('');
    setViewOnceMessage(message);
  }

  function closeViewOnceViewer() {
    const messageId = activeViewOnceMessageId.current;
    activeViewOnceMessageId.current = null;
    if (messageId && !viewOnceAvailable.current) openingViewOnceIds.current.delete(messageId);
    setViewOnceMessage(null);
  }

  async function handleViewOnceAvailable() {
    if (
      !viewOnceMessage ||
      viewOnceAvailable.current ||
      !user ||
      activeViewOnceMessageId.current !== viewOnceMessage.id
    ) {
      return;
    }
    viewOnceAvailable.current = true;
    try {
      await markViewOnceMessageViewed(conversationId, viewOnceMessage.id, user.uid);
    } catch {
      openingViewOnceIds.current.delete(viewOnceMessage.id);
      if (activeViewOnceMessageId.current === viewOnceMessage.id) {
        activeViewOnceMessageId.current = null;
        setViewOnceMessage(null);
      }
      setError('This view-once media could not be opened.');
    }
  }

  function handlePickAttachment() {
    if (isFriend === false || isBlockedByUser) return;
    const options: Array<{ text: string; onPress?: () => void; style?: 'cancel' }> = [
      { text: 'Photos & videos', onPress: () => void handlePickMedia() },
      { text: 'Camera', onPress: () => void handleCaptureCamera() },
      { text: 'File', onPress: () => void handlePickFile() },
      { text: 'Audio', onPress: () => void handlePickAudio() },
    ];
    if (!isSelfChat) {
      options.push({ text: 'Location', onPress: () => setIsLocationSheetOpen(true) });
    }
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(
      'Add attachment',
      'Choose photos, videos, a file, or location to send.',
      options,
      { cancelable: true },
    );
  }

  async function handleOpenFile(url: string, name?: string | null, mimeType?: string | null) {
    if (Platform.OS !== 'android' || openingFileUrls.current.has(url)) return;

    openingFileUrls.current.add(url);
    setOpeningFileUrl(url);
    setError('');
    const fileName = safeFileName(name);
    const resolvedMimeType = resolveFileMimeType(fileName, mimeType);
    let stage = 'cache setup';
    let usedCachedFile = false;
    try {
      const directory = new Directory(Paths.cache, 'chat-files', fileCacheKey(url));
      directory.create({ idempotent: true, intermediates: true });
      const localFile = new File(directory, fileName);
      usedCachedFile = localFile.exists;

      if (!usedCachedFile) {
        stage = 'download';
        try {
          await File.downloadFileAsync(url, localFile);
        } catch (downloadError) {
          if (localFile.exists) {
            try {
              localFile.delete();
            } catch {
              // Stale cache entry deletion error is ignored
            }
          }
          throw downloadError;
        }
      }

      stage = 'content URI creation';
      const contentUri = await FileSystemLegacy.getContentUriAsync(localFile.uri);
      stage = 'Android viewer launch';
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1,
        type: resolvedMimeType,
      });
    } catch (openError) {
      console.error('[Rocket file open] failed', {
        stage,
        error: redactFileOpenError(openError),
        mimeType: resolvedMimeType,
        extension: fileName.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? 'none',
        usedCachedFile,
      });
      setError(
        'This file could not be opened. Check your connection and install a compatible app.'
      );
    } finally {
      openingFileUrls.current.delete(url);
      setOpeningFileUrl((current) => (current === url ? null : current));
    }
  }

  function handleTextChange(newText: string) {
    setText(newText);
    if (!user || isSelfChat || isFriend === false || isBlockedByUser) return;

    if (newText.trim().length > 0) {
      const now = Date.now();
      if (now - lastTypingWrittenAt.current > 2500) {
        lastTypingWrittenAt.current = now;
        void setTypingState(conversationId, user.uid, true);
      }
      if (typingTimeout.current) {
        clearTimeout(typingTimeout.current);
      }
      typingTimeout.current = setTimeout(() => {
        lastTypingWrittenAt.current = 0;
        if (user && !isSelfChat) {
          void setTypingState(conversationId, user.uid, false);
        }
      }, 2500);
    } else {
      if (typingTimeout.current) {
        clearTimeout(typingTimeout.current);
        typingTimeout.current = null;
      }
      lastTypingWrittenAt.current = 0;
      void setTypingState(conversationId, user.uid, false);
    }
  }

  async function handleToggleReaction(message: ChatMessage, emoji: string) {
    if (!user || (!isSelfChat && isFriend === false) || isBlockedByUser || message.deletedAt) return;
    const currentReaction = message.reactions?.[user.uid] ?? null;
    setActionTargetMessage(null);
    try {
      await toggleMessageReaction(conversationId, message.id, user.uid, emoji, currentReaction);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update reaction.');
    }
  }

  async function handleDeleteMessage(message: ChatMessage) {
    if (!user || message.senderId !== user.uid || message.deletedAt) return;
    setActionTargetMessage(null);
    try {
      const isLast = messages.length > 0 && messages[messages.length - 1].id === message.id;
      await deleteMessage(conversationId, message.id, user.uid, isLast);
    } catch (delErr) {
      setError(delErr instanceof Error ? delErr.message : 'Could not delete message.');
    }
  }

  function handleStartReply(message: ChatMessage) {
    if (message.deletedAt || message.callId) return;
    setEditingMessage(null);
    setReplyingToMessage(message);
    setActionTargetMessage(null);
  }

  function handleStartEdit(message: ChatMessage) {
    setReplyingToMessage(null);
    setEditingMessage(message);
    setText(message.text);
    setActionTargetMessage(null);
  }

  async function handleSend() {
    if (!conversation || !user || sending || (!isSelfChat && isFriend === false) || isBlockedByUser) return;
    if (!isSelfChat) {
      if (typingTimeout.current) {
        clearTimeout(typingTimeout.current);
        typingTimeout.current = null;
      }
      lastTypingWrittenAt.current = 0;
      void setTypingState(conversationId, user.uid, false);
    }

    if (editingMessage) {
      if (!text.trim()) return;
      setSending(true);
      setError('');
      try {
        const isLast = messages.length > 0 && messages[messages.length - 1].id === editingMessage.id;
        await editMessage(conversationId, editingMessage.id, user.uid, text.trim(), isLast);
        setEditingMessage(null);
        setText('');
      } catch (editErr) {
        setError(editErr instanceof Error ? editErr.message : 'Could not edit message.');
      } finally {
        setSending(false);
      }
      return;
    }

    const canSendText = !!text.trim();
    if (!canSendText && selectedMedia.length === 0 && !selectedFile) return;
    setSending(true);
    setError('');

    let replyMetadata: ReplyMetadata | null = null;
    if (replyingToMessage) {
      const isReplyViewOnce = replyingToMessage.viewOnce;
      let replyType: ReplyMetadata['replyToType'] = 'text';
      let replyPreviewText = replyingToMessage.text ? replyingToMessage.text.slice(0, 100) : '';

      if (replyingToMessage.locationType === 'current') {
        replyType = 'text';
        replyPreviewText = '📍 Current location';
      } else if (replyingToMessage.locationType === 'live') {
        replyType = 'text';
        replyPreviewText = '📡 Live location';
      } else if (isReplyViewOnce) {
        replyType = 'viewOnce';
        replyPreviewText = 'View Once media';
      } else if (replyingToMessage.imageUrl) {
        replyType = 'image';
        replyPreviewText = replyingToMessage.text ? replyingToMessage.text.slice(0, 100) : 'Photo';
      } else if (replyingToMessage.videoUrl) {
        replyType = 'video';
        replyPreviewText = replyingToMessage.text ? replyingToMessage.text.slice(0, 100) : 'Video';
      } else if (replyingToMessage.fileUrl) {
        replyType = 'file';
        replyPreviewText = replyingToMessage.fileName || 'File';
      }

      replyMetadata = {
        replyToMessageId: replyingToMessage.id,
        replyToSenderId: replyingToMessage.senderId,
        replyToText: replyPreviewText,
        replyToType: replyType,
      };
    }

    try {
      if (selectedMedia.length === 0 && !selectedFile) {
        await sendMessage(conversation, user.uid, text, null, null, null, false, replyMetadata);
      } else if (selectedFile) {
        setSendingProgress({ current: 1, total: 1 });
        const fileUrl = await uploadChatFile(selectedFile.uri, selectedFile.name);
        const file: ChatFile = {
          fileUrl,
          fileName: selectedFile.name,
          fileSize: selectedFile.size ?? null,
          fileMimeType:
            inferAudioMimeType(selectedFile.name, selectedFile.mimeType) ??
            selectedFile.mimeType ??
            null,
        };
        await sendMessage(conversation, user.uid, text, null, null, file, false, replyMetadata);
      } else {
        const caption = text.trim();
        for (let index = 0; index < selectedMedia.length; index += 1) {
          const media = selectedMedia[index];
          setSendingProgress({ current: index + 1, total: selectedMedia.length });
          try {
            const imageUrl =
              media.kind === 'image'
                ? await uploadPostImage(media.asset.base64, media.asset.mimeType)
                : null;
            const videoUrl =
              media.kind === 'video'
                ? await uploadChatVideo(
                    media.asset.uri,
                    media.asset.mimeType,
                    media.asset.fileName
                  )
                : null;
            await sendMessage(
              conversation,
              user.uid,
              index === 0 ? caption : '',
              imageUrl,
              videoUrl,
              null,
              isSelfChat ? false : sendMediaViewOnce,
              index === 0 ? replyMetadata : null
            );
          } catch (batchError) {
            setSelectedMedia(selectedMedia.slice(index));
            if (index > 0) setText('');
            const message =
              batchError instanceof Error ? batchError.message : 'Message could not be sent.';
            throw new Error(
              `Could not send item ${index + 1} of ${selectedMedia.length}: ${message}`
            );
          }
        }
      }
      setText('');
      setSelectedMedia([]);
      setSelectedFile(null);
      setSendMediaViewOnce(false);
      setReplyingToMessage(null);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Message could not be sent.');
    } finally {
      setSendingProgress(null);
      setSending(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.stateContainer, { backgroundColor: colors.background }]}>
        <StatusBar style="light" />
        <RocketLoadingIndicator size="normal" />
        <RocketText color="secondary" style={styles.stateText} variant="caption">
          Entering orbit...
        </RocketText>
      </View>
    );
  }

  if (!conversation || !conversation.otherUser) {
    return (
      <View style={[styles.stateContainer, { backgroundColor: colors.background }]}>
        <StatusBar style="light" />
        <RocketText color="error" style={styles.errorText} variant="bodySecondary">
          {error || 'This conversation is unavailable.'}
        </RocketText>
        <RocketPressable
          accessibilityLabel="Go back to conversations"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.backButton}>
          <RocketText color="accent" variant="buttonSmall">
            Go back
          </RocketText>
        </RocketPressable>
      </View>
    );
  }

  const otherUser = conversation.otherUser;
  const avatar = {
    initials: getProfileInitials(otherUser.displayName),
    color: getProfileColor(otherUser.uid),
  };

  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: colors.background,
          paddingTop: Math.max(insets.top, 10),
        },
      ]}>
      <StatusBar style="light" />

      {/* Header Bar */}
      {isSearchOpen ? (
        <RocketChatSearchBar
          currentMatchIndex={currentMatchIndex}
          hasReachedBeginning={hasReachedBeginning}
          isSearchingOlder={isSearchingOlder}
          matchCount={matchingMessages.length}
          onChangeQuery={setSearchQuery}
          onClose={handleCloseSearch}
          onNextMatch={handleNextMatch}
          onPrevMatch={handlePrevMatch}
          onSearchOlder={() => void handleSearchOlder()}
          placeholder="Search in chat…"
          query={searchQuery}
          totalLoadedCount={allMessages.length}
        />
      ) : (
        <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
          <RocketIconButton
            accessibilityHint="Go back to messages"
            accessibilityLabel="Go back"
            glyph="‹"
            glyphStyle={styles.backGlyph}
            onPress={() => router.back()}
            size="sm"
            variant="ghost"
          />

          <View style={styles.headerInfo}>
            <RocketAvatar
              hasOrbit={false}
              size={38}
              source={otherUser.photoUrl}
              user={avatar}
            />
            <View style={styles.headerTextWrap}>
              <RocketText
                numberOfLines={1}
                style={styles.headerName}
                variant="bodyMedium">
                {isSelfChat ? `${otherUser.displayName} (You)` : otherUser.displayName}
              </RocketText>
              {isSelfChat ? (
                <RocketText
                  color="muted"
                  numberOfLines={1}
                  style={styles.headerSubtitle}
                  variant="caption">
                  Message yourself
                </RocketText>
              ) : isOtherUserTyping ? (
                <View style={styles.subtitleRow}>
                  <Text style={[styles.typingDotSpark, { color: colors.highlight }]}>✦</Text>
                  <RocketText
                    color="highlight"
                    numberOfLines={1}
                    style={styles.headerSubtitle}
                    variant="caption">
                    Typing…
                  </RocketText>
                </View>
              ) : isUserOnline(presence) ? (
                <View style={styles.subtitleRow}>
                  <View style={[styles.onlineDot, { backgroundColor: colors.online }]} />
                  <RocketText
                    color="online"
                    numberOfLines={1}
                    style={styles.headerSubtitle}
                    variant="caption">
                    Online
                  </RocketText>
                </View>
              ) : formatLastSeen(presence) ? (
                <View style={styles.subtitleRow}>
                  <RocketText
                    color="muted"
                    numberOfLines={1}
                    style={styles.headerSubtitle}
                    variant="caption">
                    {formatLastSeen(presence)}
                  </RocketText>
                </View>
              ) : (
                <RocketText
                  color="muted"
                  numberOfLines={1}
                  style={styles.headerHandle}
                  variant="caption">
                  @{otherUser.username}
                </RocketText>
              )}
            </View>
          </View>

          {/* Header Actions Slot: Search + Voice Call + Video Call */}
          <View style={styles.headerActions}>
            <RocketIconButton
              accessibilityHint="Search messages in this conversation"
              accessibilityLabel="Search messages"
              glyph="🔍"
              glyphStyle={styles.searchGlyph}
              onPress={handleOpenSearch}
              size="md"
              variant="filled"
            />
            {!isSelfChat ? (
              <>
                <RocketIconButton
                  accessibilityHint="Start a voice call with this friend"
                  accessibilityLabel="Start voice call"
                  disabled={startingCall || isVoiceRecordingActive || isFriend === false || isBlockedByUser}
                  glyph={startingCall ? '…' : '☎'}
                  glyphStyle={styles.callGlyph}
                  onPress={() => void handleStartVoiceCall()}
                  size="md"
                  variant="filled"
                />
                <RocketIconButton
                  accessibilityHint="Start a video call with this friend"
                  accessibilityLabel="Start video call"
                  disabled={startingVideoCall || isVoiceRecordingActive || isFriend === false || isBlockedByUser}
                  glyph={startingVideoCall ? '…' : '📹'}
                  glyphStyle={styles.callGlyph}
                  onPress={() => void handleStartVideoCall()}
                  size="md"
                  variant="filled"
                />
              </>
            ) : null}
          </View>
        </View>
      )}

      <KeyboardAvoidingView
        behavior="padding"
        style={styles.flex}>
        {/* Messages List */}
        <ScrollView
        style={styles.flex}
          contentContainerStyle={[
            styles.messagesContainer,
            { paddingBottom: SpacingScale.md },
          ]}
          onContentSizeChange={() => {
           if (messages.length === 0) return;

           messagesScrollRef.current?.scrollToEnd({
            animated: !initialScrollPending.current,
          });

          initialScrollPending.current = false;
         }}
          ref={messagesScrollRef}
          showsVerticalScrollIndicator={false}>
          {messages.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View
                style={[
                  styles.emptySparkCircle,
                  {
                    backgroundColor: colors.surfaceSecondary,
                    borderColor: colors.borderSubtle,
                  },
                ]}>
                <RocketSpark color="accent" size="lg" />
              </View>
              <RocketText style={styles.emptyTitle} variant="sectionTitle">
                {isSelfChat ? 'Your personal space' : 'Start your conversation'}
              </RocketText>
              <RocketText
                color="secondary"
                style={styles.emptySubtitle}
                variant="bodySecondary">
                {isSelfChat
                  ? 'Jot down notes, save links, or keep files handy for yourself.'
                  : `Send a private message to ${otherUser.displayName}.`}
              </RocketText>
            </View>
          ) : (
            allMessages.map((message) => {
              const mine = message.senderId === user?.uid;

              if (isCallHistoryMessage(message)) {
                return (
                  <View key={message.id} style={styles.callHistoryRow}>
                    <View
                      style={[
                        styles.callHistoryCard,
                        {
                          backgroundColor: colors.surfaceSecondary,
                          borderColor: colors.borderSubtle,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.callHistoryIcon,
                          {
                            color:
                              message.callOutcome === 'completed'
                                ? colors.success
                                : colors.emergency,
                          },
                        ]}>
                        ☎
                      </Text>
                      <RocketText
                        color="secondary"
                        style={styles.callHistoryText}
                        variant="caption">
                        {callHistoryLabel(message, user?.uid)}
                      </RocketText>
                      <RocketText
                        color="muted"
                        style={styles.callHistoryTime}
                        variant="caption">
                        {formatTime(message)}
                      </RocketText>
                    </View>
                  </View>
                );
              }

              const fileUrl = message.fileUrl;
              const viewOnceState = message.viewedAt
                ? 'Opened'
                : mine
                  ? 'View once'
                  : `View ${message.imageUrl ? 'photo' : 'video'}`;

              const isHighlighted = activeHighlightMessageId === message.id;

              return (
                <RocketSwipeToReply
                  enabled={!message.deletedAt && !isCallHistoryMessage(message)}
                  key={message.id}
                  onReply={() => handleStartReply(message)}>
                  <View
                  onLayout={(e) => {
                    messageYPositions.current[message.id] = e.nativeEvent.layout.y;
                  }}
                  style={[
                    styles.messageRow,
                    mine ? styles.mineMessageRow : styles.theirMessageRow,
                  ]}>
                  <Pressable
                    delayLongPress={300}
                    disabled={isCallHistoryMessage(message) || !!message.deletedAt}
                    onLongPress={() => setActionTargetMessage(message)}
                    style={[
                      styles.bubble,
                      isHighlighted && {
                        borderColor: colors.primaryAccent,
                        borderWidth: 2,
                      },
                      message.deletedAt
                        ? [
                            styles.deletedBubble,
                            {
                              backgroundColor: colors.surfaceSecondary,
                              borderColor: colors.borderSubtle,
                            },
                          ]
                        : mine
                          ? [styles.mineBubble, { backgroundColor: colors.primaryAccent }]
                          : [
                              styles.theirBubble,
                              {
                                backgroundColor: colors.surfaceSecondary,
                                borderColor: colors.borderSubtle,
                              },
                            ],
                    ]}>
                    {message.deletedAt ? (
                      <View style={styles.deletedContentRow}>
                        <Text
                          style={[
                            styles.deletedIcon,
                            { color: mine ? 'rgba(255, 255, 255, 0.75)' : colors.mutedText },
                          ]}>
                          ⊘
                        </Text>
                        <Text
                          style={[
                            styles.deletedText,
                            { color: mine ? 'rgba(255, 255, 255, 0.75)' : colors.mutedText },
                          ]}>
                          This message was deleted
                        </Text>
                      </View>
                    ) : (
                      <>
                        {/* Forwarded Indicator */}
                        {message.forwarded ? (
                          <View style={styles.forwardedIndicatorRow}>
                            <Text
                              style={[
                                styles.forwardedGlyph,
                                {
                                  color: mine
                                    ? 'rgba(255, 255, 255, 0.75)'
                                    : colors.mutedText,
                                },
                              ]}>
                              ↗
                            </Text>
                            <Text
                              style={[
                                styles.forwardedLabel,
                                {
                                  color: mine
                                    ? 'rgba(255, 255, 255, 0.75)'
                                    : colors.mutedText,
                                },
                              ]}>
                              Forwarded
                            </Text>
                          </View>
                        ) : null}

                        {/* Quoted Reply Preview */}
                        {message.replyToMessageId ? (() => {
                          const referencedMsg = messages.find((m) => m.id === message.replyToMessageId);
                          const isRefDeleted = referencedMsg?.deletedAt != null;
                          return (
                            <View
                              style={[
                                styles.quotedReplyWrap,
                                {
                                  backgroundColor: mine
                                    ? 'rgba(0, 0, 0, 0.18)'
                                    : 'rgba(255, 255, 255, 0.07)',
                                  borderLeftColor: mine ? '#FFFFFF' : colors.primaryAccent,
                                },
                              ]}>
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.quotedSenderName,
                                  { color: mine ? '#FFFFFF' : colors.primaryAccent },
                                ]}>
                                {message.replyToSenderId === user?.uid
                                  ? 'You'
                                  : otherUser.displayName}
                              </Text>
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.quotedText,
                                  {
                                    color: mine
                                      ? 'rgba(255, 255, 255, 0.85)'
                                      : colors.secondaryText,
                                    fontStyle: isRefDeleted ? 'italic' : 'normal',
                                  },
                                ]}>
                                {isRefDeleted ? 'Original message was deleted' : message.replyToText || 'Original message'}
                              </Text>
                            </View>
                          );
                        })() : null}

                        {/* View Once Media Bubble */}
                        {message.viewOnce ? (
                          <Pressable
                            accessibilityHint={
                              mine
                                ? 'Sent as view once'
                                : message.viewedAt
                                  ? 'This media has already been viewed'
                                  : 'Tap to open view once media'
                            }
                            accessibilityLabel={viewOnceState}
                            accessibilityRole="button"
                            disabled={
                              mine || !!message.viewedAt || openingViewOnceIds.current.has(message.id)
                            }
                            onPress={() => handleOpenViewOnce(message)}
                            style={[
                              styles.viewOnceCard,
                              {
                                backgroundColor: mine
                                  ? 'rgba(255, 255, 255, 0.12)'
                                  : 'rgba(112, 82, 255, 0.14)',
                                borderColor: mine
                                  ? 'rgba(255, 255, 255, 0.22)'
                                  : colors.primaryAccentSubtle,
                              },
                            ]}>
                            <View
                              style={[
                                styles.viewOnceIconRing,
                                {
                                  backgroundColor: mine
                                    ? 'rgba(255, 255, 255, 0.2)'
                                    : colors.surfaceTertiary,
                                },
                              ]}>
                              <Text
                                style={[
                                  styles.viewOnceIcon,
                                  {
                                    color: mine
                                      ? '#FFFFFF'
                                      : message.viewedAt
                                        ? colors.mutedText
                                        : colors.primaryAccent,
                                  },
                                ]}>
                                {message.viewedAt ? '✓' : '◉'}
                              </Text>
                            </View>
                            <View style={styles.viewOnceTextGroup}>
                              <Text
                                style={[
                                  styles.viewOnceTitle,
                                  { color: mine ? '#FFFFFF' : colors.primaryText },
                                ]}>
                                {viewOnceState}
                              </Text>
                              <Text
                                style={[
                                  styles.viewOnceDetail,
                                  {
                                    color: mine
                                      ? 'rgba(255, 255, 255, 0.75)'
                                      : colors.secondaryText,
                                  },
                                ]}>
                                {message.viewedAt
                                  ? 'No longer available'
                                  : mine
                                    ? 'Waiting to be opened'
                                    : 'Tap to open'}
                              </Text>
                            </View>
                          </Pressable>
                        ) : message.imageUrl ? (
                          <Pressable
                            accessibilityHint="View full screen image"
                            accessibilityLabel="Attached photo"
                            accessibilityRole="imagebutton"
                            onPress={() => setPhotoViewerUrl(message.imageUrl)}>
                            <Image
                              contentFit="cover"
                              source={message.imageUrl}
                              style={styles.messageImage}
                            />
                          </Pressable>
                        ) : null}

                        {/* Video Player */}
                        {!message.viewOnce && message.videoUrl ? (
                          <ChatVideo onPress={() => setVideoViewerUrl(message.videoUrl)} url={message.videoUrl} />
                        ) : null}

                        {/* Document / File Attachment */}
                        {fileUrl ? (
                          <Pressable
                            accessibilityHint="Tap to open or download this file"
                            accessibilityLabel={`File ${message.fileName || 'Attachment'}`}
                            accessibilityRole="button"
                            disabled={openingFileUrl === fileUrl}
                            onPress={() =>
                              void handleOpenFile(fileUrl, message.fileName, message.fileMimeType)
                            }
                            style={[
                              styles.fileMessage,
                              {
                                backgroundColor: mine
                                  ? 'rgba(255, 255, 255, 0.15)'
                                  : colors.surfaceTertiary,
                              },
                            ]}>
                            <View
                              style={[
                                styles.fileIconBadge,
                                {
                                  backgroundColor: mine
                                    ? 'rgba(255, 255, 255, 0.22)'
                                    : colors.surfaceSecondary,
                                },
                              ]}>
                              <Text
                                style={[
                                  styles.fileIcon,
                                  { color: mine ? '#FFFFFF' : colors.primaryAccent },
                                ]}>
                                ▣
                              </Text>
                            </View>
                            <View style={styles.fileInfo}>
                              <RocketSearchHighlightText
                                numberOfLines={1}
                                query={isSearchOpen ? debouncedQuery : ''}
                                style={[
                                  styles.fileName,
                                  { color: mine ? '#FFFFFF' : colors.primaryText },
                                ]}
                                text={message.fileName || 'File'}
                              />
                              <Text
                                style={[
                                  styles.fileMeta,
                                  {
                                    color: mine
                                      ? 'rgba(255, 255, 255, 0.75)'
                                      : colors.secondaryText,
                                  },
                                ]}>
                                {openingFileUrl === fileUrl
                                  ? 'Opening...'
                                  : formatFileSize(message.fileSize) || 'Document'}
                              </Text>
                            </View>
                          </Pressable>
                        ) : null}

                        {/* Location Card */}
                        {message.locationType ? (
                          <RocketLocationCard
                            conversationId={conversationId}
                            isMine={mine}
                            latitude={message.location?.latitude}
                            liveLocationShareId={message.liveLocationShareId}
                            locationType={message.locationType}
                            longitude={message.location?.longitude}
                            onStopSharing={handleStopLiveSharing}
                          />
                        ) : null}

                        {/* Voice Message */}
                        {message.audioUrl && message.audioDurationMs ? (
                          <View style={{ marginVertical: 4 }}>
                            <RocketVoiceMessage
                              messageId={message.id}
                              audioUrl={message.audioUrl}
                              durationMs={message.audioDurationMs}
                            />
                          </View>
                        ) : null}
                        {message.fileUrl && inferAudioMimeType(message.fileName || '', message.fileMimeType) ? (
                          <View style={{ marginVertical: 4 }}>
                            <RocketVoiceMessage
                              messageId={`${message.id}-audio-file`}
                              audioUrl={message.fileUrl}
                            />
                          </View>
                        ) : null}

                        {/* Text Message Body */}
                        {message.text && message.text !== '📍 Location' && message.text !== '📡 Live location' ? (
                          <RocketSearchHighlightText
                            numberOfLines={undefined}
                            query={isSearchOpen ? debouncedQuery : ''}
                            style={[
                              styles.messageText,
                              { color: mine ? '#FFFFFF' : colors.primaryText },
                            ]}
                            text={message.text}
                          />
                        ) : null}
                      </>
                    )}

                    {/* Bubble Footer: Timestamp & Delivery/Seen Status & Edited */}
                    <View style={styles.bubbleFooter}>
                      {message.editedAt && !message.deletedAt ? (
                        <Text
                          style={[
                            styles.editedLabel,
                            mine
                              ? { color: 'rgba(255, 255, 255, 0.65)' }
                              : { color: colors.mutedText },
                          ]}>
                          edited •{' '}
                        </Text>
                      ) : null}
                      <Text
                        style={[
                          styles.timestamp,
                          mine
                            ? { color: 'rgba(255, 255, 255, 0.7)' }
                            : { color: colors.mutedText },
                        ]}>
                        {formatTime(message)}
                      </Text>
                      {mine && !message.deletedAt && !isSelfChat ? (
                        <View style={styles.statusTickWrap}>
                          {message.seenAt ? (
                            <View style={styles.seenStatusGroup}>
                              <Text style={[styles.statusTick, styles.statusTickSeen]}>✓✓</Text>
                              <Text style={styles.statusTickSpark}>✦</Text>
                            </View>
                          ) : message.deliveredAt ? (
                            <Text style={[styles.statusTick, styles.statusTickDelivered]}>✓✓</Text>
                          ) : (
                            <Text style={[styles.statusTick, styles.statusTickSent]}>✓</Text>
                          )}
                        </View>
                      ) : null}
                    </View>
                  </Pressable>

                  {/* Reaction chips below message */}
                  {!message.deletedAt && message.reactions ? (
                    <View
                      style={[
                        styles.reactionsRow,
                        mine ? styles.mineReactionsRow : styles.theirReactionsRow,
                      ]}>
                      {getMessageReactionChips(message.reactions, user?.uid).map((chip) => (
                        <Pressable
                          key={chip.emoji}
                          onPress={() => void handleToggleReaction(message, chip.emoji)}
                          style={[
                            styles.reactionChip,
                            {
                              backgroundColor: chip.reactedByMe
                                ? 'rgba(112, 82, 255, 0.22)'
                                : colors.surfaceSecondary,
                              borderColor: chip.reactedByMe
                                ? colors.primaryAccent
                                : colors.borderSubtle,
                            },
                          ]}>
                          <Text style={styles.reactionChipEmoji}>{chip.emoji}</Text>
                          {chip.count > 1 ? (
                            <Text
                              style={[
                                styles.reactionChipCount,
                                {
                                  color: chip.reactedByMe
                                    ? colors.primaryAccent
                                    : colors.secondaryText,
                                },
                              ]}>
                              {chip.count}
                            </Text>
                          ) : null}
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  </View>
                </RocketSwipeToReply>
              );
            })
          )}
          {isOtherUserTyping ? (
            <View style={styles.typingRow}>
              <View
                style={[
                  styles.typingBubble,
                  {
                    backgroundColor: colors.surfaceSecondary,
                    borderColor: colors.borderSubtle,
                  },
                ]}>
                <Text style={[styles.typingBubbleSpark, { color: colors.highlight }]}>✦</Text>
                <RocketText color="secondary" style={styles.typingBubbleText} variant="caption">
                  {otherUser.displayName} is typing…
                </RocketText>
              </View>
            </View>
          ) : null}
        </ScrollView>

        {/* Global Error Banner */}
        {error ? (
          <View
            style={[
              styles.errorBanner,
              { backgroundColor: colors.surfaceSecondary, borderColor: colors.error },
            ]}>
            <Text style={[styles.errorBannerText, { color: colors.error }]}>{error}</Text>
          </View>
        ) : null}

        {/* Forward Success Banner */}
        {forwardSuccessMessage ? (
          <View
            style={[
              styles.successBanner,
              { backgroundColor: colors.surfaceSecondary, borderColor: colors.primaryAccent },
            ]}>
            <Text style={[styles.successBannerText, { color: colors.primaryAccent }]}>
              {forwardSuccessMessage}
            </Text>
          </View>
        ) : null}

        {/* Real Sending Progress Banner */}
        {sendingProgress ? (
          <View style={styles.sendingProgressBar}>
            <RocketText color="accent" style={styles.sendingStatus} variant="caption">
              Sending item {sendingProgress.current} of {sendingProgress.total}…
            </RocketText>
          </View>
        ) : null}

        {/* Selected Media Preview Strip */}
        {selectedMedia.length > 0 ? (
          <View
            style={[
              styles.previewWrap,
              {
                backgroundColor: colors.surfaceSecondary,
                borderTopColor: colors.borderSubtle,
              },
            ]}>
            <View style={styles.previewList}>
              <View style={styles.previewTopRow}>
                <RocketText color="secondary" style={styles.selectionCount} variant="caption">
                  {selectedMedia.length} item{selectedMedia.length === 1 ? '' : 's'} selected
                </RocketText>
                <Pressable
                  accessibilityHint="Remove all selected photos and videos"
                  accessibilityLabel="Remove all"
                  accessibilityRole="button"
                  disabled={sending}
                  onPress={() => {
                    setSelectedMedia([]);
                    setSendMediaViewOnce(false);
                  }}
                  style={styles.removeButton}>
                  <Text style={[styles.removeButtonText, { color: colors.highlight }]}>
                    Remove all
                  </Text>
                </Pressable>
              </View>

              <ScrollView
                contentContainerStyle={styles.previewListContent}
                horizontal
                showsHorizontalScrollIndicator={false}>
                {selectedMedia.map((media, index) =>
                  media.kind === 'image' ? (
                    <Image
                      contentFit="cover"
                      key={`${media.asset.uri}_${index}`}
                      source={media.asset.uri}
                      style={styles.previewImage}
                    />
                  ) : (
                    <View key={`${media.asset.uri}_${index}`} style={styles.videoPreview}>
                      <Text style={styles.videoPreviewText}>▶ Video</Text>
                    </View>
                  )
                )}
              </ScrollView>

              {/* View Once Toggle (1:1 chat only) */}
              {!isSelfChat ? (
                <Pressable
                  accessibilityHint="Toggle View Once protection for this media"
                  accessibilityLabel={sendMediaViewOnce ? 'View once enabled' : 'Send as view once'}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: sendMediaViewOnce }}
                  disabled={sending}
                  onPress={() => setSendMediaViewOnce((current) => !current)}
                  style={[
                    styles.viewOnceToggle,
                    {
                      backgroundColor: sendMediaViewOnce
                        ? colors.primaryAccent
                        : colors.surfaceTertiary,
                      borderColor: sendMediaViewOnce
                        ? colors.primaryAccent
                        : colors.borderSubtle,
                    },
                  ]}>
                  <Text
                    style={[
                      styles.viewOnceToggleText,
                      {
                        color: sendMediaViewOnce ? '#FFFFFF' : colors.secondaryText,
                      },
                    ]}>
                    ◉ {sendMediaViewOnce ? 'View once on' : 'Send as view once'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Selected File Preview Strip */}
        {selectedFile ? (
          <View
            style={[
              styles.previewWrap,
              {
                backgroundColor: colors.surfaceSecondary,
                borderTopColor: colors.borderSubtle,
              },
            ]}>
            <View style={styles.filePreviewRow}>
              <View
                style={[
                  styles.fileIconBadge,
                  { backgroundColor: colors.surfaceTertiary },
                ]}>
                <Text style={[styles.fileIcon, { color: colors.primaryAccent }]}>▣</Text>
              </View>
              <View style={styles.filePreviewInfo}>
                <Text
                  numberOfLines={1}
                  style={[styles.fileName, { color: colors.primaryText }]}>
                  {selectedFile.name}
                </Text>
                {formatFileSize(selectedFile.size ?? null) ? (
                  <Text style={[styles.fileMeta, { color: colors.secondaryText }]}>
                    {formatFileSize(selectedFile.size ?? null)}
                  </Text>
                ) : null}
              </View>
              <Pressable
                accessibilityHint="Remove selected document"
                accessibilityLabel="Remove file"
                accessibilityRole="button"
                disabled={sending}
                onPress={() => setSelectedFile(null)}
                style={styles.removeButton}>
                <Text style={[styles.removeButtonText, { color: colors.highlight }]}>
                  Remove
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Composer / Locked State */}
        {isBlockedByUser ? (
          <View
            style={[
              styles.lockedNotice,
              {
                backgroundColor: colors.surfaceSecondary,
                borderTopColor: colors.borderSubtle,
                paddingBottom: Math.max(insets.bottom, 14),
              },
            ]}>
            <Text style={styles.lockedIcon}>🔒</Text>
            <RocketText color="muted" style={styles.lockedNoticeText} variant="bodySecondary">
              You have blocked this user.
            </RocketText>
          </View>
        ) : isFriend === false ? (
          <View
            style={[
              styles.lockedNotice,
              {
                backgroundColor: colors.surfaceSecondary,
                borderTopColor: colors.borderSubtle,
                paddingBottom: Math.max(insets.bottom, 14),
              },
            ]}>
            <Text style={styles.lockedIcon}>🔒</Text>
            <RocketText color="muted" style={styles.lockedNoticeText} variant="bodySecondary">
              You can only message accepted friends.
            </RocketText>
          </View>
        ) : (
          <View>
            {/* Reply Preview Banner */}
            {replyingToMessage ? (
              <View
                style={[
                  styles.composerContextBar,
                  {
                    backgroundColor: colors.surfaceSecondary,
                    borderTopColor: colors.borderSubtle,
                    borderLeftColor: colors.primaryAccent,
                  },
                ]}>
                <View style={styles.composerContextTextWrap}>
                  <Text style={[styles.composerContextTitle, { color: colors.primaryAccent }]}>
                    Replying to {replyingToMessage.senderId === user?.uid ? 'yourself' : otherUser.displayName}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.composerContextSubtitle, { color: colors.secondaryText }]}>
                    {replyingToMessage.viewOnce
                      ? 'View Once media'
                      : replyingToMessage.locationType === 'current'
                        ? '📍 Current location'
                        : replyingToMessage.locationType === 'live'
                          ? '📡 Live location'
                          : replyingToMessage.text ||
                            (replyingToMessage.imageUrl
                              ? 'Photo'
                              : replyingToMessage.videoUrl
                                ? 'Video'
                                : replyingToMessage.fileName || 'Attachment')}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Cancel reply"
                  hitSlop={8}
                  onPress={() => setReplyingToMessage(null)}
                  style={styles.composerContextClose}>
                  <Text style={[styles.composerContextCloseText, { color: colors.mutedText }]}>✕</Text>
                </Pressable>
              </View>
            ) : null}

            {/* Edit Message Banner */}
            {editingMessage ? (
              <View
                style={[
                  styles.composerContextBar,
                  {
                    backgroundColor: colors.surfaceSecondary,
                    borderTopColor: colors.borderSubtle,
                    borderLeftColor: colors.highlight,
                  },
                ]}>
                <View style={styles.composerContextTextWrap}>
                  <Text style={[styles.composerContextTitle, { color: colors.highlight }]}>
                    Editing message
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.composerContextSubtitle, { color: colors.secondaryText }]}>
                    {editingMessage.text}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Cancel editing"
                  hitSlop={8}
                  onPress={() => {
                    setEditingMessage(null);
                    setText('');
                  }}
                  style={styles.composerContextClose}>
                  <Text style={[styles.composerContextCloseText, { color: colors.mutedText }]}>✕</Text>
                </Pressable>
              </View>
            ) : null}

            <View
              style={[
                styles.composer,
                {
                  backgroundColor: colors.surface,
                  borderTopColor: colors.borderSubtle,
                  paddingBottom: Math.max(insets.bottom, 10),
                },
              ]}>
              {!isVoiceRecordingActive ? (
                <RocketIconButton
                  accessibilityHint="Add photo, video, or document"
                  accessibilityLabel="Add attachment"
                  disabled={sending || !!editingMessage}
                  glyph="＋"
                  glyphStyle={styles.attachmentGlyph}
                  onPress={handlePickAttachment}
                  size="md"
                  variant="filled"
                />
              ) : null}

              <TextInput
                accessibilityLabel="Message text input"
                editable={!isVoiceRecordingActive}
                multiline
                onChangeText={handleTextChange}
                placeholder={editingMessage ? 'Edit your message...' : 'Write a message...'}
                placeholderTextColor={colors.secondaryText}
                style={[
                  styles.composerInput,
                  isVoiceRecordingActive && styles.hiddenComposerInput,
                  {
                    backgroundColor: colors.surfaceSecondary,
                    borderColor: colors.borderSubtle,
                    color: colors.primaryText,
                  },
                ]}
                value={text}
              />

              {(!text.trim() && selectedMedia.length === 0 && !selectedFile && !editingMessage)
                || isVoiceRecordingActive ? (
                <RocketVoiceRecorder
                  disabled={sending}
                  onSend={handleSendVoiceMessage}
                  onActiveChange={setIsVoiceRecordingActive}
                />
              ) : (
                <RocketIconButton
                  accessibilityHint={editingMessage ? 'Save edited message' : 'Send your message'}
                  accessibilityLabel={editingMessage ? 'Save edit' : 'Send message'}
                  disabled={
                    (!text.trim() && selectedMedia.length === 0 && !selectedFile) || sending
                  }
                  glyph={sending ? '…' : editingMessage ? '✓' : '↑'}
                  glyphStyle={styles.sendGlyph}
                  onPress={() => void handleSend()}
                  size="md"
                  variant="accent"
                />
              )}
            </View>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Message Action Menu Modal */}
      <Modal
        animationType="fade"
        onRequestClose={() => setActionTargetMessage(null)}
        transparent
        visible={!!actionTargetMessage}>
        <Pressable
          onPress={() => setActionTargetMessage(null)}
          style={styles.actionModalBackdrop}>
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              styles.actionModalCard,
              {
                backgroundColor: colors.surfaceSecondary,
                borderColor: colors.borderSubtle,
              },
            ]}>
            {/* Quick Emoji Reaction Bar */}
            <View
              style={[
                styles.actionReactionsBar,
                { borderBottomColor: colors.borderSubtle },
              ]}>
              {ALLOWED_REACTIONS.map((emoji) => {
                const isSelected =
                  actionTargetMessage?.reactions?.[user?.uid ?? ''] === emoji;
                return (
                  <Pressable
                    key={emoji}
                    onPress={() => {
                      if (actionTargetMessage) {
                        void handleToggleReaction(actionTargetMessage, emoji);
                      }
                    }}
                    style={[
                      styles.actionEmojiButton,
                      isSelected && {
                        backgroundColor: 'rgba(112, 82, 255, 0.28)',
                        borderColor: colors.primaryAccent,
                      },
                    ]}>
                    <Text style={styles.actionEmojiText}>{emoji}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Actions List */}
            <View style={styles.actionItemsList}>
              {/* Reply */}
              <Pressable
                accessibilityLabel="Reply to message"
                onPress={() => {
                  if (actionTargetMessage) {
                    handleStartReply(actionTargetMessage);
                  }
                }}
                style={styles.actionRow}>
                <Text style={[styles.actionRowIcon, { color: colors.primaryAccent }]}>↩</Text>
                <Text style={[styles.actionRowText, { color: colors.primaryText }]}>Reply</Text>
              </Pressable>

              {/* Edit (Own normal text messages only) */}
              {actionTargetMessage &&
              actionTargetMessage.senderId === user?.uid &&
              !actionTargetMessage.imageUrl &&
              !actionTargetMessage.videoUrl &&
              !actionTargetMessage.fileUrl &&
              !actionTargetMessage.viewOnce &&
              !actionTargetMessage.deletedAt &&
              !actionTargetMessage.locationType &&
              !actionTargetMessage.location &&
              !actionTargetMessage.liveLocationShareId &&
              !actionTargetMessage.callId ? (
                <Pressable
                  accessibilityLabel="Edit message"
                  onPress={() => {
                    if (actionTargetMessage) {
                      handleStartEdit(actionTargetMessage);
                    }
                  }}
                  style={styles.actionRow}>
                  <Text style={[styles.actionRowIcon, { color: colors.highlight }]}>✎</Text>
                  <Text style={[styles.actionRowText, { color: colors.primaryText }]}>Edit</Text>
                </Pressable>
              ) : null}

              {/* Delete (Own messages only) */}
              {actionTargetMessage &&
              actionTargetMessage.senderId === user?.uid &&
              !actionTargetMessage.deletedAt &&
              !actionTargetMessage.callId ? (
                <Pressable
                  accessibilityLabel="Delete message for everyone"
                  onPress={() => {
                    if (actionTargetMessage) {
                      void handleDeleteMessage(actionTargetMessage);
                    }
                  }}
                  style={styles.actionRow}>
                  <Text style={[styles.actionRowIcon, { color: colors.error }]}>🗑</Text>
                  <Text style={[styles.actionRowText, { color: colors.error }]}>
                    Delete for everyone
                  </Text>
                </Pressable>
              ) : null}

              {/* Forward */}
              {actionTargetMessage && extractForwardablePayload(actionTargetMessage) ? (
                <Pressable
                  accessibilityLabel="Forward message"
                  onPress={() => {
                    if (actionTargetMessage) {
                      const payload = extractForwardablePayload(actionTargetMessage);
                      if (payload) {
                        setActionTargetMessage(null);
                        setForwardingPayload(payload);
                        setIsForwardModalVisible(true);
                      }
                    }
                  }}
                  style={styles.actionRow}>
                  <Text style={[styles.actionRowIcon, { color: colors.primaryAccent }]}>↗</Text>
                  <Text style={[styles.actionRowText, { color: colors.primaryText }]}>Forward</Text>
                </Pressable>
              ) : null}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Rocket Location Picker Sheet Modal */}
      <RocketLocationPickerSheet
        onClose={() => setIsLocationSheetOpen(false)}
        onSendCurrentLocation={handleSendCurrentLocation}
        onStartLiveLocation={handleStartLiveLocation}
        visible={isLocationSheetOpen}
      />

      {/* Full-screen Photo Viewer Modal */}
      <Modal
        animationType="fade"
        onRequestClose={() => setPhotoViewerUrl(null)}
        transparent={false}
        visible={!!photoViewerUrl}>
        <View style={viewerModalStyles.container}>
          <RocketIconButton
            accessibilityLabel="Close photo viewer"
            glyph="✕"
            glyphStyle={viewerModalStyles.closeText}
            onPress={() => setPhotoViewerUrl(null)}
            size="md"
            style={viewerModalStyles.closeButton}
            variant="filled"
          />
          {photoViewerUrl ? (
            <Image
              contentFit="contain"
              source={photoViewerUrl}
              style={viewerModalStyles.image}
            />
          ) : null}
        </View>
      </Modal>

      {/* Full-screen Video Viewer Modal */}
      {videoViewerUrl ? (
        <FullscreenVideoViewer
          onClose={() => setVideoViewerUrl(null)}
          url={videoViewerUrl}
        />
      ) : null}

      {/* Full-screen View Once Viewer Modal */}
      {viewOnceMessage ? (
        <ViewOnceViewer
          message={viewOnceMessage}
          onAvailable={() => void handleViewOnceAvailable()}
          onClose={closeViewOnceViewer}
        />
      ) : null}

      {/* Forward Destination Picker Modal */}
      <RocketForwardPickerModal
        currentUid={user?.uid ?? ''}
        onClose={() => {
          setIsForwardModalVisible(false);
          setForwardingPayload(null);
        }}
        onSuccess={(msg) => {
          setForwardSuccessMessage(msg);
          setTimeout(() => {
            setForwardSuccessMessage('');
          }, 3500);
        }}
        payload={forwardingPayload}
        visible={isForwardModalVisible}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  stateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SpacingScale.xxl,
    gap: SpacingScale.md,
  },
  stateText: {
    marginTop: 4,
  },
  backButton: {
    marginTop: SpacingScale.lg,
    paddingVertical: SpacingScale.sm,
    paddingHorizontal: SpacingScale.lg,
  },
  errorText: {
    textAlign: 'center',
    lineHeight: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SpacingScale.md,
    paddingVertical: SpacingScale.sm,
    borderBottomWidth: 1,
  },
  backGlyph: {
    fontSize: 28,
    marginTop: -2,
  },
  headerInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 4,
    marginRight: SpacingScale.sm,
    gap: SpacingScale.sm + 2,
  },
  headerTextWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  headerName: {
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  headerHandle: {
    marginTop: 1,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: '500',
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  typingDotSpark: {
    fontSize: 9,
    lineHeight: 11,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.xs,
  },
  callGlyph: {
    fontSize: 18,
  },
  searchGlyph: {
    fontSize: 15,
  },
  messagesContainer: {
    flexGrow: 1,
    paddingHorizontal: SpacingScale.lg,
    paddingTop: SpacingScale.md,
    justifyContent: 'flex-end',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SpacingScale.epic,
    paddingHorizontal: SpacingScale.xl,
  },
  emptySparkCircle: {
    width: 64,
    height: 64,
    borderRadius: Radius.xl,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SpacingScale.lg,
  },
  emptyTitle: {
    textAlign: 'center',
    marginBottom: 6,
  },
  emptySubtitle: {
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 18,
  },
  callHistoryRow: {
    alignItems: 'center',
    marginVertical: SpacingScale.sm,
  },
  callHistoryCard: {
    maxWidth: '90%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SpacingScale.lg,
    paddingVertical: 7,
    borderRadius: Radius.full,
    borderWidth: 1,
    gap: SpacingScale.sm,
  },
  callHistoryIcon: {
    fontSize: 13,
  },
  callHistoryText: {
    fontWeight: '600',
  },
  callHistoryTime: {
    marginLeft: 2,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  mineMessageRow: {
    justifyContent: 'flex-end',
  },
  theirMessageRow: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Radius.lg,
  },
  mineBubble: {
    borderBottomRightRadius: Radius.xs,
  },
  theirBubble: {
    borderBottomLeftRadius: Radius.xs,
    borderWidth: 1,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.1,
  },
  timestamp: {
    fontSize: 10,
    lineHeight: 13,
  },
  bubbleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 4,
  },
  statusTickWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 1,
  },
  statusTick: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: -1.5,
  },
  statusTickSent: {
    color: 'rgba(255, 255, 255, 0.65)',
  },
  statusTickDelivered: {
    color: 'rgba(255, 255, 255, 0.85)',
  },
  statusTickSeen: {
    color: '#38BDF8',
  },
  seenStatusGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  statusTickSpark: {
    fontSize: 8,
    color: '#FF3E83',
    marginTop: -1,
  },
  typingRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginTop: SpacingScale.xs,
    marginBottom: SpacingScale.sm,
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  typingBubbleSpark: {
    fontSize: 11,
    lineHeight: 13,
  },
  typingBubbleText: {
    fontSize: 12,
    fontWeight: '500',
  },
  messageImage: {
    width: 220,
    maxWidth: '100%',
    height: 200,
    borderRadius: Radius.md,
    marginBottom: 6,
  },
  fileMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.sm + 2,
    padding: 10,
    borderRadius: Radius.md,
    marginBottom: 6,
  },
  fileIconBadge: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileIcon: {
    fontSize: 20,
    fontWeight: '800',
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: 13,
    fontWeight: '700',
  },
  fileMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  viewOnceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 175,
    padding: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: SpacingScale.sm + 2,
    marginBottom: 6,
  },
  viewOnceIconRing: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewOnceIcon: {
    fontSize: 18,
    fontWeight: '800',
  },
  viewOnceTextGroup: {
    flex: 1,
  },
  viewOnceTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  viewOnceDetail: {
    fontSize: 11,
    marginTop: 2,
  },
  errorBanner: {
    marginHorizontal: SpacingScale.lg,
    marginBottom: SpacingScale.sm,
    paddingHorizontal: SpacingScale.md,
    paddingVertical: SpacingScale.sm,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  errorBannerText: {
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    fontWeight: '600',
  },
  sendingProgressBar: {
    paddingHorizontal: SpacingScale.lg,
    paddingBottom: SpacingScale.xs,
  },
  sendingStatus: {
    fontWeight: '600',
  },
  previewWrap: {
    paddingHorizontal: SpacingScale.md,
    paddingVertical: SpacingScale.sm,
    borderTopWidth: 1,
  },
  previewList: {
    width: '100%',
  },
  previewTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SpacingScale.xs,
  },
  selectionCount: {
    fontWeight: '600',
  },
  removeButton: {
    paddingHorizontal: SpacingScale.sm,
    paddingVertical: 2,
  },
  removeButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  previewListContent: {
    gap: SpacingScale.sm,
    paddingVertical: SpacingScale.xs,
  },
  previewImage: {
    width: 68,
    height: 68,
    borderRadius: Radius.sm,
  },
  videoPreview: {
    width: 68,
    height: 68,
    borderRadius: Radius.sm,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPreviewText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  viewOnceToggle: {
    alignSelf: 'flex-start',
    marginTop: SpacingScale.sm,
    paddingHorizontal: SpacingScale.md,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  viewOnceToggleText: {
    fontSize: 12,
    fontWeight: '700',
  },
  filePreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.sm + 2,
  },
  filePreviewInfo: {
    flex: 1,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SpacingScale.sm,
    paddingHorizontal: SpacingScale.md,
    paddingTop: SpacingScale.sm,
    borderTopWidth: 1,
  },
  attachmentGlyph: {
    fontSize: 22,
    lineHeight: 22,
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    borderRadius: Radius.lg,
    borderWidth: 1,
    paddingHorizontal: SpacingScale.md + 2,
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 20,
  },
  hiddenComposerInput: {
    display: 'none',
  },
  sendGlyph: {
    fontSize: 20,
    lineHeight: 20,
    fontWeight: '800',
  },
  lockedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SpacingScale.sm,
    paddingVertical: SpacingScale.md,
    paddingHorizontal: SpacingScale.lg,
    borderTopWidth: 1,
  },
  lockedIcon: {
    fontSize: 14,
  },
  lockedNoticeText: {
    textAlign: 'center',
    fontWeight: '600',
  },
  quotedReplyWrap: {
    borderLeftWidth: 3,
    borderRadius: Radius.xs,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 6,
  },
  quotedSenderName: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  quotedText: {
    fontSize: 12,
  },
  reactionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
    marginBottom: 2,
  },
  mineReactionsRow: {
    justifyContent: 'flex-end',
  },
  theirReactionsRow: {
    justifyContent: 'flex-start',
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  reactionChipEmoji: {
    fontSize: 13,
  },
  reactionChipCount: {
    fontSize: 11,
    fontWeight: '700',
  },
  deletedBubble: {
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  deletedContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  deletedIcon: {
    fontSize: 13,
  },
  deletedText: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  editedLabel: {
    fontSize: 10,
    fontStyle: 'italic',
  },
  composerContextBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SpacingScale.md,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderLeftWidth: 4,
  },
  composerContextTextWrap: {
    flex: 1,
    marginRight: 8,
  },
  composerContextTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  composerContextSubtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  composerContextClose: {
    padding: 4,
  },
  composerContextCloseText: {
    fontSize: 14,
    fontWeight: '800',
  },
  actionModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
    padding: SpacingScale.md,
    paddingBottom: 34,
  },
  actionModalCard: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  actionReactionsBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
  },
  actionEmojiButton: {
    padding: 8,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  actionEmojiText: {
    fontSize: 24,
  },
  actionItemsList: {
    paddingVertical: 6,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: SpacingScale.lg,
  },
  actionRowIcon: {
    fontSize: 18,
    width: 24,
    textAlign: 'center',
  },
  actionRowText: {
    fontSize: 15,
    fontWeight: '600',
  },
  forwardedIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  forwardedGlyph: {
    fontSize: 12,
    fontWeight: '700',
  },
  forwardedLabel: {
    fontSize: 11,
    fontStyle: 'italic',
    fontWeight: '500',
  },
  successBanner: {
    marginHorizontal: SpacingScale.lg,
    marginBottom: SpacingScale.sm,
    paddingHorizontal: SpacingScale.md,
    paddingVertical: SpacingScale.sm,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  successBannerText: {
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    fontWeight: '600',
  },
});

const videoStyles = StyleSheet.create({
  playerPressable: {
    borderRadius: Radius.md,
    overflow: 'hidden',
    marginBottom: 6,
  },
  player: {
    width: 220,
    maxWidth: '100%',
    height: 160,
    borderRadius: Radius.md,
    backgroundColor: '#000000',
  },
});

const viewOnceStyles = StyleSheet.create({
  viewer: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  media: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
  },
  close: {
    position: 'absolute',
    top: 52,
    right: 20,
    zIndex: 10,
  },
  closeText: {
    fontSize: 16,
    fontWeight: '800',
  },
  loading: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    position: 'absolute',
    bottom: 70,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});

const viewerModalStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  video: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
  },
  closeButton: {
    position: 'absolute',
    top: 52,
    right: 20,
    zIndex: 10,
  },
  closeText: {
    fontSize: 16,
    fontWeight: '800',
  },
});
