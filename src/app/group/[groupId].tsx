import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as IntentLauncher from 'expo-intent-launcher';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { VideoView, useVideoPlayer } from 'expo-video';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
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
import { RocketSwipeToReply } from '@/components/RocketSwipeToReply';
import { RocketSearchHighlightText } from '@/components/RocketSearchHighlightText';
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
import { useAuth } from '@/providers/auth-provider';
import { uploadChatFile, uploadChatVideo, uploadPostImage, uploadVoiceMessage } from '@/services/cloudinary-service';
import { RocketLocationCard } from '@/components/RocketLocationCard';
import { RocketVoiceMessage } from '@/components/RocketVoiceMessage';
import { RocketVoiceRecorder, VoiceMessageMimeType } from '@/components/RocketVoiceRecorder';
import { RocketLocationPickerSheet } from '@/components/RocketLocationPickerSheet';
import { Coordinates, LiveLocationDuration } from '@/services/location-service';
import {
  getGroup,
  getGroupProfiles,
  getOlderGroupMessages,
  Group,
  GroupMessage,
  sendGroupLocationMessage,
  sendGroupMessage,
  startGroupLiveLocation,
  stopGroupLiveLocationShare,
  subscribeToGroupMessages,
} from '@/services/group-service';
import {
  ChatFile,
  extractForwardablePayload,
  ForwardableMessagePayload,
  inferAudioMimeType,
} from '@/services/messaging-service';
import { getProfileColor, getProfileInitials, UserProfile } from '@/services/user-service';

function Video({ url, onPress }: { url: string; onPress?: () => void }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
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

function VideoPlayerDialog({ url }: { url: string }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
  });

  return (
    <VideoView
      contentFit="contain"
      nativeControls
      player={player}
      style={viewerModalStyles.video}
      surfaceType="textureView"
    />
  );
}

function formatMessageTime(message: GroupMessage): string {
  return (
    message.createdAt?.toDate().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) ??
    ''
  );
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
  const extension = normalized.match(/(\.[^.]+)$/)?.[1] ?? '';
  return normalized.length <= 120
    ? normalized
    : `${normalized.slice(0, Math.max(1, 120 - extension.length))}${extension}`;
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

type PendingMedia = {
  kind: 'image' | 'video';
  asset: ImagePicker.ImagePickerAsset;
};

function isAudioDocument(asset: DocumentPicker.DocumentPickerAsset): boolean {
  if (asset.mimeType?.toLowerCase().startsWith('audio/')) return true;
  return /\.(aac|aif|aiff|flac|m4a|mp3|oga|ogg|opus|wav|wma)$/i.test(asset.name);
}

function groupReplyPreview(message: GroupMessage): string {
  const previousReply = parseGroupReplyText(message.text);
  const preview =
    message.locationType === 'current'
      ? 'Current location'
      : message.locationType === 'live'
        ? 'Live location'
        : message.audioUrl
          ? 'Voice message'
          : message.imageUrl
            ? 'Photo'
            : message.videoUrl
              ? 'Video'
              : message.fileName || previousReply?.body || message.text;
  return preview.trim().replace(/\s+/g, ' ').slice(0, 120) || 'Message';
}

function parseGroupReplyText(text: string): { sender: string; preview: string; body: string } | null {
  const match = /^↩ ([^\n]{1,80}): ([^\n]{1,120})(?:\n([\s\S]*))?$/.exec(text);
  if (!match) return null;
  return { sender: match[1], preview: match[2], body: match[3] ?? '' };
}

export default function GroupChatScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { colors } = useRocketTheme();

  const [group, setGroup] = useState<Group | null>(null);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [text, setText] = useState('');
  const [media, setMedia] = useState<PendingMedia[]>([]);
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [isVoiceRecordingActive, setIsVoiceRecordingActive] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [error, setError] = useState('');
  const [openingFileUrl, setOpeningFileUrl] = useState<string | null>(null);
  const [actionTargetMessage, setActionTargetMessage] = useState<GroupMessage | null>(null);
  const [replyingToMessage, setReplyingToMessage] = useState<GroupMessage | null>(null);
  const [forwardingPayload, setForwardingPayload] = useState<ForwardableMessagePayload | null>(null);
  const [isForwardModalVisible, setIsForwardModalVisible] = useState(false);
  const [forwardSuccessMessage, setForwardSuccessMessage] = useState('');
  const [isLocationSheetOpen, setIsLocationSheetOpen] = useState(false);

  async function handleSendCurrentLocation(coords: Coordinates) {
    if (!group || !user) return;
    await sendGroupLocationMessage(group, user.uid, coords.latitude, coords.longitude);
  }

  async function sendVoiceMessage(uri: string, durationMs: number, mimeType: VoiceMessageMimeType) {
    if (!group || !user) throw new Error('The group is not ready to send a voice message.');
    if (sending) throw new Error('Another message is still being sent. Please retry in a moment.');
    setSending(true);
    setError('');
    const outgoingText = quotedGroupReplyText(text);
    try {
      const secureUrl = await uploadVoiceMessage(uri);
      await sendGroupMessage(
        group,
        user.uid,
        quotedGroupReplyText(''), // quote text is stored in the existing text field
        null, // imageUrl
        null, // videoUrl
        null, // file
        false, // forwarded
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

  async function handleStartLiveLocation(coords: Coordinates, duration: LiveLocationDuration) {
    if (!group || !user) return;
    await startGroupLiveLocation(group, user.uid, coords.latitude, coords.longitude, duration);
  }

  async function handleStopLiveSharing(shareId: string) {
    if (!user) return;
    await stopGroupLiveLocationShare(groupId, shareId, user.uid);
  }

  function handleStartReply(message: GroupMessage) {
    setReplyingToMessage(message);
    setActionTargetMessage(null);
  }

  function quotedGroupReplyText(body: string): string {
    if (!replyingToMessage) return body;
    const senderName = (
      replyingToMessage.senderId === user?.uid
        ? 'You'
        : profiles[replyingToMessage.senderId]?.displayName ?? 'Group member'
    ).replace(/[\r\n:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Group member';
    const quote = `↩ ${senderName}: ${groupReplyPreview(replyingToMessage)}`;
    return body.trim() ? `${quote}\n${body.trim()}` : quote;
  }

  const openingFileUrls = useRef(new Set<string>());
  const messagesScrollRef = useRef<ScrollView>(null);
  const initialScrollPending = useRef(true);

  // In-Chat Message Search State
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [isSearchingOlder, setIsSearchingOlder] = useState(false);
  const [hasReachedBeginning, setHasReachedBeginning] = useState(false);
  const [olderMessages, setOlderMessages] = useState<GroupMessage[]>([]);
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
    const list: GroupMessage[] = [];
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
      const older = await getOlderGroupMessages(groupId, oldest.createdAt, oldest.id, 50);
      if (older.length < 50) {
        setHasReachedBeginning(true);
      }
      if (older.length > 0) {
        setOlderMessages((prev) => [...older, ...prev]);
      }
    } catch (err) {
      console.warn('Failed to load older group messages for search', err);
    } finally {
      setIsSearchingOlder(false);
    }
  }, [isSearchingOlder, hasReachedBeginning, allMessages, groupId]);

  useEffect(() => {
    if (!user || !groupId) return;
    let live = true;
    initialScrollPending.current = true;
    setLoading(true);
    setError('');

    void getGroup(groupId, user.uid)
      .then(async (next) => {
        if (!live) return;
        setGroup(next);
        const groupProfiles = await getGroupProfiles(next.memberIds);
        if (!live) return;
        setProfiles(groupProfiles);
        setLoading(false);
      })
      .catch((e) => {
        if (live) {
          setError(e.message || 'Group unavailable.');
          setLoading(false);
        }
      });

    const unsubscribe = subscribeToGroupMessages(
      groupId,
      (nextMessages) => {
        setMessages(nextMessages);
        if (nextMessages.length === 0) initialScrollPending.current = false;
      },
      (e) => {
        if (live) setError(e.message || 'Messages could not load.');
      }
    );

    return () => {
      live = false;
      unsubscribe();
    };
  }, [groupId, user]);

  async function pickMedia() {
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
    if (!result.canceled && result.assets.every((a) => a.type === 'image' || a.type === 'video')) {
      setMedia(result.assets.map((asset) => ({ kind: asset.type as PendingMedia['kind'], asset })));
      setFile(null);
      setError('');
    }
  }

  async function captureCamera() {
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
      setMedia([{ kind: 'image', asset }]);
      setFile(null);
      setError('');
    } catch (cameraError) {
      setError(
        cameraError instanceof Error
          ? cameraError.message
          : 'The camera could not capture media.',
      );
    }
  }

  async function pickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: '*/*',
      });
      if (!result.canceled) {
        const asset = result.assets[0];
        if (asset.uri.split(':', 1)[0] !== 'file') {
          throw new Error('The file could not be prepared for upload.');
        }
        setFile(asset);
        setMedia([]);
        setError('');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be selected.');
    }
  }

  async function pickAudio() {
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
      setFile(asset);
      setMedia([]);
      setError('');
    } catch (audioError) {
      setError(
        audioError instanceof Error
          ? audioError.message
          : 'The audio file could not be selected.',
      );
    }
  }

  function attachment() {
    Alert.alert(
      'Add attachment',
      'Choose photos, videos, a file, or location to send.',
      [
        { text: 'Photos & videos', onPress: () => void pickMedia() },
        { text: 'Camera', onPress: () => void captureCamera() },
        { text: 'File', onPress: () => void pickFile() },
        { text: 'Audio', onPress: () => void pickAudio() },
        { text: 'Location', onPress: () => setIsLocationSheetOpen(true) },
        { text: 'Cancel', style: 'cancel' },
      ],
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
              /* The original download error is more useful. */
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

  async function send() {
    if (!user || !group || sending || (!text.trim() && !media.length && !file)) return;
    setSending(true);
    setError('');
    const outgoingText = quotedGroupReplyText(text);
    try {
      if (file) {
        setProgress('Uploading file…');
        const chatFile: ChatFile = {
          fileUrl: await uploadChatFile(file.uri, file.name),
          fileName: file.name,
          fileSize: file.size ?? null,
          fileMimeType: inferAudioMimeType(file.name, file.mimeType) ?? file.mimeType ?? null,
        };
        await sendGroupMessage(group, user.uid, outgoingText, null, null, chatFile);
      } else if (media.length) {
        const caption = outgoingText;
        for (let i = 0; i < media.length; i += 1) {
          setProgress(`Sending item ${i + 1} of ${media.length}…`);
          const item = media[i];
          const imageUrl =
            item.kind === 'image'
              ? await uploadPostImage(item.asset.base64, item.asset.mimeType)
              : null;
          const videoUrl =
            item.kind === 'video'
              ? await uploadChatVideo(item.asset.uri, item.asset.mimeType, item.asset.fileName)
              : null;
          await sendGroupMessage(group, user.uid, i === 0 ? caption : '', imageUrl, videoUrl);
        }
      } else {
        await sendGroupMessage(group, user.uid, outgoingText);
      }
      setText('');
      setMedia([]);
      setFile(null);
      setReplyingToMessage(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Message could not be sent.');
    } finally {
      setSending(false);
      setProgress('');
    }
  }

  if (loading) {
    return (
      <View style={[styles.stateContainer, { backgroundColor: colors.background }]}>
        <StatusBar style="light" />
        <RocketLoadingIndicator size="normal" />
        <RocketText color="secondary" style={styles.stateText} variant="caption">
          Entering group orbit...
        </RocketText>
      </View>
    );
  }

  if (!group) {
    return (
      <View style={[styles.stateContainer, { backgroundColor: colors.background }]}>
        <StatusBar style="light" />
        <RocketText color="error" style={styles.errorText} variant="bodySecondary">
          {error || 'Group unavailable.'}
        </RocketText>
        <RocketPressable
          accessibilityLabel="Go back"
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

  const isMember = group.memberIds.includes(user?.uid ?? '');

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

      {/* Group Header Bar */}
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
          placeholder="Search in group…"
          query={searchQuery}
          totalLoadedCount={allMessages.length}
        />
      ) : (
        <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
          <RocketIconButton
            accessibilityHint="Go back to chats"
            accessibilityLabel="Go back"
            glyph="‹"
            glyphStyle={styles.backGlyph}
            onPress={() => router.back()}
            size="sm"
            variant="ghost"
          />

          <Pressable
            accessibilityHint="View group details, members, and settings"
            accessibilityLabel={`Group info for ${group.name}`}
            accessibilityRole="button"
            onPress={() => router.push(`/group/${group.id}/info`)}
            style={styles.headerInfo}>
            <RocketAvatar
              color={colors.secondaryAccent}
              hasOrbit={false}
              size={38}
              user={{
                initials: getProfileInitials(group.name),
                color: colors.secondaryAccent,
              }}
            />
            <View style={styles.headerTextWrap}>
              <RocketText
                numberOfLines={1}
                style={styles.headerTitle}
                variant="bodyMedium">
                {group.name}
              </RocketText>
              <RocketText
                color="muted"
                numberOfLines={1}
                style={styles.headerSubtitle}
                variant="caption">
                {group.memberIds.length} members · Group info
              </RocketText>
            </View>
          </Pressable>

          {/* Header Actions Slot: Search button + Group Info button */}
          <View style={styles.headerActions}>
            <RocketIconButton
              accessibilityHint="Search messages in this group"
              accessibilityLabel="Search messages"
              glyph="🔍"
              glyphStyle={styles.searchGlyph}
              onPress={handleOpenSearch}
              size="md"
              variant="filled"
            />
            <RocketIconButton
              accessibilityHint="View group details, members, and settings"
              accessibilityLabel="Group info"
              glyph="ⓘ"
              glyphStyle={styles.infoGlyph}
              onPress={() => router.push(`/group/${group.id}/info`)}
              size="md"
              variant="filled"
            />
          </View>
        </View>
      )}

      <KeyboardAvoidingView
        behavior="padding"
        style={styles.flex}>
        {/* Messages List */}
        <ScrollView
          contentContainerStyle={[
            styles.messagesContainer,
            { paddingBottom: SpacingScale.md },
          ]}
          onContentSizeChange={() => {
            if (!initialScrollPending.current || messages.length === 0) return;
            initialScrollPending.current = false;
            messagesScrollRef.current?.scrollToEnd({ animated: false });
          }}
          ref={messagesScrollRef}
          showsVerticalScrollIndicator={false}>
          {allMessages.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View
                style={[
                  styles.emptySparkCircle,
                  {
                    backgroundColor: colors.surfaceSecondary,
                    borderColor: colors.borderSubtle,
                  },
                ]}>
                <RocketSpark color="secondary" size="lg" />
              </View>
              <RocketText style={styles.emptyTitle} variant="sectionTitle">
                No messages yet
              </RocketText>
              <RocketText
                color="secondary"
                style={styles.emptySubtitle}
                variant="bodySecondary">
                Say hello to the group and get the orbit moving.
              </RocketText>
            </View>
          ) : (
            allMessages.map((message) => {
              const mine = message.senderId === user?.uid;
              const sender = profiles[message.senderId];
              const fileUrl = message.fileUrl;
              const isHighlighted = activeHighlightMessageId === message.id;
              const replyPreview = parseGroupReplyText(message.text);

              return (
                <RocketSwipeToReply
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
                  {/* Incoming Sender Avatar */}
                  {!mine ? (
                    <View style={styles.senderAvatarWrap}>
                      <RocketAvatar
                        color={getProfileColor(message.senderId)}
                        hasOrbit={false}
                        size={28}
                        source={sender?.photoUrl}
                        user={{
                          initials: getProfileInitials(sender?.displayName || '?'),
                          color: getProfileColor(message.senderId),
                        }}
                      />
                    </View>
                  ) : null}

                  <Pressable
                    delayLongPress={300}
                    onLongPress={() => setActionTargetMessage(message)}
                    style={[
                      styles.bubble,
                      isHighlighted && {
                        borderColor: colors.primaryAccent,
                        borderWidth: 2,
                      },
                      mine
                        ? [styles.mineBubble, { backgroundColor: colors.primaryAccent }]
                        : [
                            styles.theirBubble,
                            {
                              backgroundColor: colors.surfaceSecondary,
                              borderColor: colors.borderSubtle,
                            },
                          ],
                    ]}>
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

                    {/* Sender Identity on Incoming Messages */}
                    {!mine ? (
                      <RocketText
                        color="secondaryAccent"
                        numberOfLines={1}
                        style={styles.senderName}
                        variant="caption">
                        {sender ? `${sender.displayName} · @${sender.username}` : 'Group member'}
                      </RocketText>
                    ) : null}

                    {/* Image Attachment */}
                    {message.imageUrl ? (
                      <Pressable
                        accessibilityHint="View full screen image"
                        accessibilityLabel="Attached photo"
                        accessibilityRole="imagebutton"
                        onPress={() => setPhoto(message.imageUrl)}>
                        <Image
                          contentFit="cover"
                          source={message.imageUrl}
                          style={styles.messageImage}
                        />
                      </Pressable>
                    ) : null}

                    {/* Video Attachment */}
                    {message.videoUrl ? <Video onPress={() => setVideo(message.videoUrl)} url={message.videoUrl} /> : null}

                    {/* File Attachment */}
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
                              : `${message.fileSize != null ? `${Math.ceil(message.fileSize / 1024)} KB` : 'Document'}`}
                          </Text>
                        </View>
                      </Pressable>
                    ) : null}

                    {/* Location Card */}
                    {message.locationType ? (
                      <RocketLocationCard
                        groupId={groupId}
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

                    {replyPreview ? (
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
                          {replyPreview.sender}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.quotedText,
                            {
                              color: mine
                                ? 'rgba(255, 255, 255, 0.85)'
                                : colors.secondaryText,
                            },
                          ]}>
                          {replyPreview.preview}
                        </Text>
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
                        text={replyPreview?.body ?? message.text}
                      />
                    ) : null}

                    {/* Timestamp */}
                    <Text
                      style={[
                        styles.timestamp,
                        mine
                          ? { color: 'rgba(255, 255, 255, 0.7)', textAlign: 'right' }
                          : { color: colors.mutedText },
                      ]}>
                      {formatMessageTime(message)}
                    </Text>
                  </Pressable>
                </View>
                </RocketSwipeToReply>
              );
            })
          )}
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
        {progress ? (
          <View style={styles.sendingProgressBar}>
            <RocketText color="accent" style={styles.sendingStatus} variant="caption">
              {progress}
            </RocketText>
          </View>
        ) : null}

        {/* Selected Media Preview Strip */}
        {media.length > 0 ? (
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
                  {media.length} item{media.length === 1 ? '' : 's'} selected
                </RocketText>
                <Pressable
                  accessibilityHint="Remove all selected photos and videos"
                  accessibilityLabel="Remove all"
                  accessibilityRole="button"
                  disabled={sending}
                  onPress={() => setMedia([])}
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
                {media.map((item, index) =>
                  item.kind === 'image' ? (
                    <Image
                      contentFit="cover"
                      key={`${item.asset.uri}_${index}`}
                      source={item.asset.uri}
                      style={styles.previewImage}
                    />
                  ) : (
                    <View key={`${item.asset.uri}_${index}`} style={styles.videoPreview}>
                      <Text style={styles.videoPreviewText}>▶ Video</Text>
                    </View>
                  )
                )}
              </ScrollView>
            </View>
          </View>
        ) : null}

        {/* Selected File Preview Strip */}
        {file ? (
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
                  {file.name}
                </Text>
                {formatFileSize(file.size ?? null) ? (
                  <Text style={[styles.fileMeta, { color: colors.secondaryText }]}>
                    {formatFileSize(file.size ?? null)}
                  </Text>
                ) : null}
              </View>
              <Pressable
                accessibilityHint="Remove selected document"
                accessibilityLabel="Remove file"
                accessibilityRole="button"
                disabled={sending}
                onPress={() => setFile(null)}
                style={styles.removeButton}>
                <Text style={[styles.removeButtonText, { color: colors.highlight }]}>
                  Remove
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Composer / Membership Guard */}
        {isMember && replyingToMessage ? (
          <View
            style={[
              styles.replyComposerBanner,
              {
                backgroundColor: colors.surfaceSecondary,
                borderLeftColor: colors.primaryAccent,
                borderTopColor: colors.borderSubtle,
              },
            ]}>
            <View style={styles.replyComposerCopy}>
              <RocketText color="accent" variant="captionBold">
                Replying to {replyingToMessage.senderId === user?.uid
                  ? 'yourself'
                  : profiles[replyingToMessage.senderId]?.displayName ?? 'group member'}
              </RocketText>
              <RocketText color="secondary" numberOfLines={1} variant="caption">
                {groupReplyPreview(replyingToMessage)}
              </RocketText>
            </View>
            <Pressable
              accessibilityLabel="Cancel reply"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setReplyingToMessage(null)}
              style={styles.replyComposerClose}>
              <Text style={[styles.replyComposerCloseText, { color: colors.mutedText }]}>✕</Text>
            </Pressable>
          </View>
        ) : null}
        {!isMember ? (
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
              You are no longer a member of this group.
            </RocketText>
          </View>
        ) : (
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
                disabled={sending}
                glyph="＋"
                glyphStyle={styles.attachmentGlyph}
                onPress={attachment}
                size="md"
                variant="filled"
              />
            ) : null}

            <TextInput
              accessibilityLabel="Group message text input"
              editable={!sending && !isVoiceRecordingActive}
              multiline
              onChangeText={setText}
              placeholder="Write a message..."
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

            {(!text.trim() && media.length === 0 && !file) || isVoiceRecordingActive ? (
              <RocketVoiceRecorder
                disabled={sending}
                onSend={sendVoiceMessage}
                onActiveChange={setIsVoiceRecordingActive}
              />
            ) : (
              <RocketIconButton
                accessibilityHint="Send your group message"
                accessibilityLabel="Send message"
                disabled={sending || (!text.trim() && !media.length && !file)}
                glyph={sending ? '…' : '↑'}
                glyphStyle={styles.sendGlyph}
                onPress={() => void send()}
                size="md"
                variant="accent"
              />
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Full-screen Photo Viewer Modal */}
      <Modal
        animationType="fade"
        onRequestClose={() => setPhoto(null)}
        transparent={false}
        visible={!!photo}>
        <View style={viewerModalStyles.container}>
          <RocketIconButton
            accessibilityLabel="Close photo viewer"
            glyph="✕"
            glyphStyle={viewerModalStyles.closeText}
            onPress={() => setPhoto(null)}
            size="md"
            style={viewerModalStyles.closeButton}
            variant="filled"
          />
          {photo ? (
            <Image
              contentFit="contain"
              source={photo}
              style={viewerModalStyles.image}
            />
          ) : null}
        </View>
      </Modal>

      {/* Full-screen Video Viewer Modal */}
      {video ? (
        <Modal
          animationType="fade"
          onRequestClose={() => setVideo(null)}
          transparent={false}
          visible>
          <View style={viewerModalStyles.container}>
            <RocketIconButton
              accessibilityLabel="Close video viewer"
              glyph="✕"
              glyphStyle={viewerModalStyles.closeText}
              onPress={() => setVideo(null)}
              size="md"
              style={viewerModalStyles.closeButton}
              variant="filled"
            />
            <VideoPlayerDialog url={video} />
          </View>
        </Modal>
      ) : null}

      {/* Message Actions Modal */}
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
            <View style={styles.actionItemsList}>
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

      {/* Location Picker Sheet Modal */}
      <RocketLocationPickerSheet
        onClose={() => setIsLocationSheetOpen(false)}
        onSendCurrentLocation={handleSendCurrentLocation}
        onStartLiveLocation={handleStartLiveLocation}
        visible={isLocationSheetOpen}
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
  headerTitle: {
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    marginTop: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.xs,
  },
  searchGlyph: {
    fontSize: 15,
  },
  infoGlyph: {
    fontSize: 16,
    fontWeight: '700',
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
  messageRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  mineMessageRow: {
    justifyContent: 'flex-end',
  },
  theirMessageRow: {
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    gap: SpacingScale.sm,
  },
  senderAvatarWrap: {
    marginBottom: 2,
  },
  bubble: {
    maxWidth: '78%',
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
  senderName: {
    fontWeight: '700',
    marginBottom: 4,
    letterSpacing: 0.1,
  },
  quotedReplyWrap: {
    borderLeftWidth: 3,
    borderRadius: Radius.xs,
    marginBottom: SpacingScale.xs,
    paddingHorizontal: SpacingScale.sm,
    paddingVertical: SpacingScale.xs,
  },
  quotedSenderName: {
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 2,
  },
  quotedText: {
    fontSize: 12,
    lineHeight: 16,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.1,
  },
  timestamp: {
    fontSize: 10,
    lineHeight: 13,
    marginTop: 4,
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
  replyComposerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderLeftWidth: 3,
    paddingHorizontal: SpacingScale.md,
    paddingVertical: SpacingScale.sm,
  },
  replyComposerCopy: {
    flex: 1,
    gap: 2,
  },
  replyComposerClose: {
    padding: SpacingScale.xs,
    marginLeft: SpacingScale.sm,
  },
  replyComposerCloseText: {
    fontSize: 16,
    fontWeight: '700',
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
