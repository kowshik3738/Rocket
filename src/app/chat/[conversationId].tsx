import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as IntentLauncher from 'expo-intent-launcher';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar, Screen, colors } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';
import { uploadChatFile, uploadChatVideo, uploadPostImage } from '@/services/cloudinary-service';
import { getResumableCallForConversation, startOutgoingCall } from '@/services/call-service';
import {
  ChatFile,
  ChatMessage,
  Conversation,
  getConversation,
  getFirestoreTimestampMillis,
  markViewOnceMessageViewed,
  sendMessage,
  subscribeToMessages,
} from '@/services/messaging-service';
import { getProfileColor, getProfileInitials } from '@/services/user-service';

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
  return !!message.callId && !!message.callerId && !!message.calleeId && !!message.callOutcome;
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
  const normalized = name?.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').trim().replace(/[. ]+$/g, '');
  if (!normalized || normalized === '.' || normalized === '..') return 'attachment';

  // Keep the file extension when shortening a name for a safe cache path.
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
  const isSpecificMimeType = !!mimeType
    && mimeType !== '*/*'
    && mimeType !== 'application/octet-stream'
    && mimeType !== 'application/unknown'
    && /^[-\w.+]+\/[-\w.+]+$/.test(mimeType);
  if (isSpecificMimeType) return mimeType;

  const extension = name.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  return extension ? MIME_TYPES_BY_EXTENSION[extension] ?? 'application/octet-stream' : 'application/octet-stream';
}

function redactFileOpenError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/\S+/g, '[remote URL]');
}

function ChatVideo({ url }: { url: string }) {
  const player = useVideoPlayer(url, (videoPlayer) => {
    videoPlayer.loop = false;
  });

  return <VideoView contentFit="contain" nativeControls player={player} style={videoStyles.player} />;
}

function ViewOnceVideo({ url, onAvailable }: { url: string; onAvailable: () => void }) {
  const player = useVideoPlayer(url, (videoPlayer) => {
    videoPlayer.loop = false;
  });

  return <VideoView contentFit="contain" nativeControls onFirstFrameRender={onAvailable} player={player} style={viewOnceStyles.media} />;
}

function ViewOnceViewer({ message, onClose, onAvailable }: { message: ChatMessage; onClose: () => void; onAvailable: () => void }) {
  // The hook releases Android FLAG_SECURE when this dedicated viewer unmounts.
  usePreventScreenCapture(`rocket-view-once-${message.id}`);
  const [loadFailed, setLoadFailed] = useState(false);
  const [mediaAvailable, setMediaAvailable] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => {
      setLoadFailed((failed) => mediaAvailable ? failed : true);
    }, 15000);
    return () => clearTimeout(timeout);
  }, [mediaAvailable]);
  const handleAvailable = () => {
    setMediaAvailable(true);
    onAvailable();
  };

  return (
    <Modal animationType="fade" visible transparent={false} onRequestClose={onClose}>
      <View style={viewOnceStyles.viewer}>
        <Pressable accessibilityLabel="Close view once media" onPress={onClose} style={viewOnceStyles.close}>
          <Text style={viewOnceStyles.closeText}>X</Text>
        </Pressable>
        {message.imageUrl ? <Image contentFit="contain" onError={() => setLoadFailed(true)} onLoad={handleAvailable} source={message.imageUrl} style={viewOnceStyles.media} /> : null}
        {message.videoUrl ? <ViewOnceVideo onAvailable={handleAvailable} url={message.videoUrl} /> : null}
        {loadFailed ? <Text style={viewOnceStyles.error}>This media could not be loaded.</Text> : !mediaAvailable ? <View pointerEvents="none" style={viewOnceStyles.loading}><ActivityIndicator color="#FFF" /></View> : null}
      </View>
    </Modal>
  );
}

const videoStyles = StyleSheet.create({
  player: { width: 220, maxWidth: '100%', height: 160, borderRadius: 12, marginBottom: 8, backgroundColor: '#000' },
});

const viewOnceStyles = StyleSheet.create({
  viewer: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  media: { width: '100%', height: '100%', backgroundColor: '#000' },
  close: { position: 'absolute', top: 52, right: 20, zIndex: 2, width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#FFF', fontSize: 22, fontWeight: '800' },
  loading: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  error: { position: 'absolute', bottom: 70, color: '#FFF', fontSize: 14 },
});

type PendingMedia = {
  kind: 'image' | 'video';
  asset: ImagePicker.ImagePickerAsset;
};

export default function ChatScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [selectedMedia, setSelectedMedia] = useState<PendingMedia[]>([]);
  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [sendMediaViewOnce, setSendMediaViewOnce] = useState(false);
  const [photoViewerUrl, setPhotoViewerUrl] = useState<string | null>(null);
  const [viewOnceMessage, setViewOnceMessage] = useState<ChatMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendingProgress, setSendingProgress] = useState<{ current: number; total: number } | null>(null);
  const [startingCall, setStartingCall] = useState(false);
  const [error, setError] = useState('');
  const openingFileUrls = useRef(new Set<string>());
  const [openingFileUrl, setOpeningFileUrl] = useState<string | null>(null);
  const openingViewOnceIds = useRef(new Set<string>());
  const viewOnceAvailable = useRef(false);

  useEffect(() => {
    if (!user || !conversationId) return;
    let active = true;
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
        setError(loadError instanceof Error ? loadError.message : 'This conversation could not be loaded.');
        setLoading(false);
    });
    const unsubscribe = subscribeToMessages(conversationId, setMessages, (messageError) => {
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
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [conversationId, user]);

  async function handlePickMedia() {
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
      setSelectedMedia(result.assets.map((asset) => ({ kind: asset.type as PendingMedia['kind'], asset })));
      setSelectedFile(null);
      setSendMediaViewOnce(false);
      setError('');
    }
  }

  async function handleStartVoiceCall() {
    if (!user || !conversation?.otherUser || startingCall) return;
    setStartingCall(true);
    setError('');
    try {
      const resumableCall = getResumableCallForConversation(conversation.id, user.uid);
      if (resumableCall) {
        router.push(`/call/${resumableCall.id}`);
        return;
      }
      const callId = await startOutgoingCall(conversation.id, user.uid, conversation.otherUser.uid);
      router.push(`/call/${callId}`);
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : 'The voice call could not be started.');
    } finally {
      setStartingCall(false);
    }
  }

  async function handlePickFile() {
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
          throw new Error(`The document picker did not return a local cache file (${uriScheme || 'unknown'} URI).`);
        }
        setSelectedFile(asset);
        setSelectedMedia([]);
        setSendMediaViewOnce(false);
        setError('');
      }
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : 'The selected file could not be prepared for upload.');
    }
  }

  function handleOpenViewOnce(message: ChatMessage) {
    if (!user || message.senderId === user.uid || message.viewedAt || openingViewOnceIds.current.has(message.id)) return;
    openingViewOnceIds.current.add(message.id);
    viewOnceAvailable.current = false;
    setError('');
    setViewOnceMessage(message);
  }

  function closeViewOnceViewer() {
    if (viewOnceMessage) openingViewOnceIds.current.delete(viewOnceMessage.id);
    setViewOnceMessage(null);
  }

  async function handleViewOnceAvailable() {
    if (!viewOnceMessage || viewOnceAvailable.current || !user) return;
    viewOnceAvailable.current = true;
    try {
      await markViewOnceMessageViewed(conversationId, viewOnceMessage.id, user.uid);
    } catch {
      setError('This view-once media could not be opened.');
      closeViewOnceViewer();
    }
  }

  function handlePickAttachment() {
    Alert.alert('Add attachment', 'Choose photos, videos, or a file to send.', [
      { text: 'Photos & videos', onPress: () => void handlePickMedia() },
      { text: 'File', onPress: () => void handlePickFile() },
      { text: 'Cancel', style: 'cancel' },
    ]);
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
          // Android can leave a partial file behind when a streamed download fails.
          if (localFile.exists) {
            try {
              localFile.delete();
            } catch {
              // A stale cache entry is non-fatal; the original download error is more useful.
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
        // Android FLAG_GRANT_READ_URI_PERMISSION lets the selected viewer read Expo's content URI.
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
      setError('This file could not be opened. Check your connection and install a compatible app.');
    } finally {
      openingFileUrls.current.delete(url);
      setOpeningFileUrl((current) => current === url ? null : current);
    }
  }

  async function handleSend() {
    if (!conversation || !user || sending) return;
    const canSendText = !!text.trim();
    if (!canSendText && selectedMedia.length === 0 && !selectedFile) return;
    setSending(true);
    setError('');
    try {
      if (selectedMedia.length === 0 && !selectedFile) {
        await sendMessage(conversation, user.uid, text);
      } else if (selectedFile) {
        setSendingProgress({ current: 1, total: 1 });
        const fileUrl = await uploadChatFile(selectedFile.uri, selectedFile.name);
        const file: ChatFile = {
          fileUrl,
          fileName: selectedFile.name,
          fileSize: selectedFile.size ?? null,
          fileMimeType: selectedFile.mimeType ?? null,
        };
        await sendMessage(conversation, user.uid, text, null, null, file);
      } else {
        const caption = text.trim();
        for (let index = 0; index < selectedMedia.length; index += 1) {
          const media = selectedMedia[index];
          setSendingProgress({ current: index + 1, total: selectedMedia.length });
          try {
            const imageUrl = media.kind === 'image' ? await uploadPostImage(media.asset.base64, media.asset.mimeType) : null;
            const videoUrl = media.kind === 'video' ? await uploadChatVideo(media.asset.uri, media.asset.mimeType, media.asset.fileName) : null;
            await sendMessage(conversation, user.uid, index === 0 ? caption : '', imageUrl, videoUrl, null, sendMediaViewOnce);
          } catch (batchError) {
            setSelectedMedia(selectedMedia.slice(index));
            if (index > 0) setText('');
            const message = batchError instanceof Error ? batchError.message : 'Message could not be sent.';
            throw new Error(`Could not send item ${index + 1} of ${selectedMedia.length}: ${message}`);
          }
        }
      }
      setText('');
      setSelectedMedia([]);
      setSelectedFile(null);
      setSendMediaViewOnce(false);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Message could not be sent.');
    } finally {
      setSendingProgress(null);
      setSending(false);
    }
  }

  const page = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, paddingTop: 46 },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
    back: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.backgroundElement, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
    backIcon: { color: colors.text, fontSize: 29, lineHeight: 29, marginTop: -3 },
    headerInfo: { flex: 1, marginLeft: 10 },
    callButton: { width: 38, height: 38, borderRadius: 13, backgroundColor: colors.backgroundElement, alignItems: 'center', justifyContent: 'center' },
    callButtonDisabled: { opacity: 0.5 },
    callButtonText: { color: colors.accent, fontSize: 19, fontWeight: '800' },
    name: { color: colors.text, fontSize: 15, fontWeight: '800' },
    handle: { color: colors.textSecondary, fontSize: 11, marginTop: 4 },
    messages: { flexGrow: 1, padding: 20, justifyContent: 'flex-end' },
    empty: { alignItems: 'center', paddingVertical: 90 },
    emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
    emptyText: { color: colors.textSecondary, fontSize: 13, marginTop: 7 },
    messageRow: { flexDirection: 'row', justifyContent: 'flex-start', marginBottom: 10 },
    mineRow: { justifyContent: 'flex-end' },
    bubble: { maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
    theirBubble: { backgroundColor: colors.backgroundElement, borderBottomLeftRadius: 5 },
    mineBubble: { backgroundColor: colors.accent, borderBottomRightRadius: 5 },
    messageText: { color: colors.text, fontSize: 15, lineHeight: 20 },
    mineText: { color: '#FFF' },
    timestamp: { color: colors.textSecondary, fontSize: 9, marginTop: 5 },
    mineTimestamp: { color: '#FFE3E5', textAlign: 'right' },
    callHistoryRow: { alignItems: 'center', marginBottom: 12 },
    callHistoryCard: { maxWidth: '88%', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 14, backgroundColor: colors.backgroundElement, borderWidth: 1, borderColor: colors.border },
    callHistoryText: { color: colors.textSecondary, fontSize: 12, fontWeight: '800', textAlign: 'center' },
    callHistoryTime: { color: colors.textSecondary, fontSize: 9, marginTop: 4 },
    messageImage: { width: 220, maxWidth: '100%', height: 220, maxHeight: 260, borderRadius: 12, marginBottom: 8 },
    previewWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
    previewList: { flex: 1 },
    previewListContent: { gap: 8 },
    preview: { width: 72, height: 72, borderRadius: 12 },
    videoPreview: { width: 72, height: 72, borderRadius: 12, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
    videoPreviewText: { color: '#FFF', fontSize: 12, fontWeight: '800' },
    filePreview: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
    fileIcon: { color: colors.accent, fontSize: 22, fontWeight: '800' },
    fileInfo: { flex: 1 },
    fileName: { color: colors.text, fontSize: 13, fontWeight: '800' },
    fileMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 3 },
    mineFileName: { color: '#FFF' },
    mineFileMeta: { color: '#FFE3E5' },
    fileMessage: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8, padding: 10, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.08)' },
    remove: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.backgroundElement },
    removeText: { color: colors.accent, fontSize: 12, fontWeight: '700' },
    selectionCount: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6 },
    viewOnceToggle: { alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.backgroundElement },
    viewOnceToggleActive: { backgroundColor: colors.accent },
    viewOnceToggleText: { color: colors.accent, fontSize: 12, fontWeight: '800' },
    viewOnceToggleTextActive: { color: '#FFF' },
    viewOnceCard: { minWidth: 170, minHeight: 92, alignItems: 'center', justifyContent: 'center', gap: 5, marginBottom: 8, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.12)' },
    viewOnceIcon: { color: colors.accent, fontSize: 24, fontWeight: '800' },
    viewOnceTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
    viewOnceDetail: { color: colors.textSecondary, fontSize: 11 },
    mineViewOnceTitle: { color: '#FFF' },
    mineViewOnceDetail: { color: '#FFE3E5' },
    sendingStatus: { color: colors.textSecondary, fontSize: 12, paddingHorizontal: 20, paddingTop: 8 },
    gallery: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.backgroundElement, alignItems: 'center', justifyContent: 'center' },
    galleryText: { color: colors.accent, fontSize: 22, lineHeight: 22 },
    composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 9, padding: 12, borderTopWidth: 1, borderTopColor: colors.border },
    input: { flex: 1, maxHeight: 100, minHeight: 44, borderRadius: 16, backgroundColor: colors.backgroundElement, color: colors.text, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15 },
    send: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    sendDisabled: { opacity: 0.45 },
    sendText: { color: '#FFF', fontSize: 22, fontWeight: '800' },
    state: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
    stateText: { color: colors.textSecondary, fontSize: 13, marginTop: 10 },
    error: { color: colors.accent, textAlign: 'center', fontSize: 13, lineHeight: 19, paddingHorizontal: 20, paddingVertical: 8 },
    backLink: { color: colors.accent, fontWeight: '800', marginTop: 16 },
    viewer: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
    viewerImage: { width: '100%', height: '100%' },
    close: { position: 'absolute', top: 52, right: 20, zIndex: 2, width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
    closeText: { color: '#FFF', fontSize: 22, fontWeight: '800' },
  });

  if (loading) {
    return <Screen scroll={false}><View style={page.state}><ActivityIndicator color={colors.accent} /><Text style={page.stateText}>Loading conversation...</Text></View></Screen>;
  }
  if (!conversation || !conversation.otherUser) {
    return <Screen scroll={false}><View style={page.state}><Text style={page.error}>{error || 'This conversation is unavailable.'}</Text><Pressable onPress={() => router.back()}><Text style={page.backLink}>Go back</Text></Pressable></View></Screen>;
  }

  const otherUser = conversation.otherUser;
  const avatar = { initials: getProfileInitials(otherUser.displayName), color: getProfileColor(otherUser.uid) };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={page.container}>
      <View style={page.header}>
        <Pressable onPress={() => router.back()} style={page.back}>
          <Text style={page.backIcon}>‹</Text>
        </Pressable>
        <Avatar user={avatar} size={42} />
        <View style={page.headerInfo}>
          <Text style={page.name}>{otherUser.displayName}</Text>
          <Text style={page.handle}>@{otherUser.username}</Text>
        </View>
        <Pressable accessibilityLabel="Start voice call" disabled={startingCall} onPress={() => void handleStartVoiceCall()} style={[page.callButton, startingCall && page.callButtonDisabled]}>
          <Text style={page.callButtonText}>{startingCall ? '…' : '☎'}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={page.messages} showsVerticalScrollIndicator={false}>
        {messages.length === 0 ? (
          <View style={page.empty}>
            <Text style={page.emptyTitle}>Start your conversation</Text>
            <Text style={page.emptyText}>Send a message to {otherUser.displayName}.</Text>
          </View>
        ) : (
          messages.map((message) => {
            const mine = message.senderId === user?.uid;
            if (isCallHistoryMessage(message)) {
              return (
                <View key={message.id} style={page.callHistoryRow}>
                  <View style={page.callHistoryCard}>
                    <Text style={page.callHistoryText}>{callHistoryLabel(message, user?.uid)}</Text>
                    <Text style={page.callHistoryTime}>{formatTime(message)}</Text>
                  </View>
                </View>
              );
            }
            const fileUrl = message.fileUrl;
            const viewOnceState = message.viewedAt ? 'Opened' : mine ? 'View once' : `View ${message.imageUrl ? 'photo' : 'video'}`;
            return (
              <View key={message.id} style={[page.messageRow, mine && page.mineRow]}>
                <View style={[page.bubble, mine ? page.mineBubble : page.theirBubble]}>
                  {message.viewOnce ? (
                    <Pressable
                      accessibilityLabel={viewOnceState}
                      disabled={mine || !!message.viewedAt || openingViewOnceIds.current.has(message.id)}
                      onPress={() => handleOpenViewOnce(message)}
                      style={page.viewOnceCard}
                    >
                      <Text style={page.viewOnceIcon}>{message.viewedAt ? '✓' : '◉'}</Text>
                      <Text style={[page.viewOnceTitle, mine && page.mineViewOnceTitle]}>{viewOnceState}</Text>
                      <Text style={[page.viewOnceDetail, mine && page.mineViewOnceDetail]}>{message.viewedAt ? 'No longer available' : mine ? 'Waiting to be opened' : 'Tap to open'}</Text>
                    </Pressable>
                  ) : message.imageUrl ? (
                    <Pressable onPress={() => setPhotoViewerUrl(message.imageUrl)}>
                      <Image contentFit="contain" source={message.imageUrl} style={page.messageImage} />
                    </Pressable>
                  ) : null}
                  {message.videoUrl ? <ChatVideo url={message.videoUrl} /> : null}
                  {fileUrl ? (
                    <Pressable disabled={openingFileUrl === fileUrl} onPress={() => void handleOpenFile(fileUrl, message.fileName, message.fileMimeType)} style={page.fileMessage}>
                      <Text style={page.fileIcon}>▣</Text>
                      <View style={page.fileInfo}>
                        <Text numberOfLines={1} style={[page.fileName, mine && page.mineFileName]}>{message.fileName || 'File'}</Text>
                        <Text style={[page.fileMeta, mine && page.mineFileMeta]}>{openingFileUrl === fileUrl ? 'Opening...' : formatFileSize(message.fileSize) || 'File'}</Text>
                      </View>
                    </Pressable>
                  ) : null}
                  {message.text ? <Text style={[page.messageText, mine && page.mineText]}>{message.text}</Text> : null}
                  <Text style={[page.timestamp, mine && page.mineTimestamp]}>{formatTime(message)}</Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {error ? <Text style={page.error}>{error}</Text> : null}
      {sendingProgress ? <Text style={page.sendingStatus}>Sending item {sendingProgress.current} of {sendingProgress.total}…</Text> : null}

      <Modal animationType="fade" visible={!!photoViewerUrl} transparent={false} onRequestClose={() => setPhotoViewerUrl(null)}>
        <View style={page.viewer}>
          <Pressable onPress={() => setPhotoViewerUrl(null)} style={page.close}>
            <Text style={page.closeText}>X</Text>
          </Pressable>
          {photoViewerUrl ? <Image contentFit="contain" source={photoViewerUrl} style={page.viewerImage} /> : null}
        </View>
      </Modal>

      {viewOnceMessage ? <ViewOnceViewer message={viewOnceMessage} onAvailable={() => void handleViewOnceAvailable()} onClose={closeViewOnceViewer} /> : null}

      {selectedMedia.length > 0 ? (
        <View style={page.previewWrap}>
          <View style={page.previewList}>
            <Text style={page.selectionCount}>{selectedMedia.length} item{selectedMedia.length === 1 ? '' : 's'} selected</Text>
            <ScrollView contentContainerStyle={page.previewListContent} horizontal showsHorizontalScrollIndicator={false}>
              {selectedMedia.map((media, index) => media.kind === 'image' ? (
                <Image contentFit="cover" key={`${media.asset.uri}_${index}`} source={media.asset.uri} style={page.preview} />
              ) : (
                <View key={`${media.asset.uri}_${index}`} style={page.videoPreview}><Text style={page.videoPreviewText}>▶ Video</Text></View>
              ))}
            </ScrollView>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: sendMediaViewOnce }}
              disabled={sending}
              onPress={() => setSendMediaViewOnce((current) => !current)}
              style={[page.viewOnceToggle, sendMediaViewOnce && page.viewOnceToggleActive]}
            >
              <Text style={[page.viewOnceToggleText, sendMediaViewOnce && page.viewOnceToggleTextActive]}>◉ {sendMediaViewOnce ? 'View once on' : 'Send as view once'}</Text>
            </Pressable>
          </View>
          <Pressable disabled={sending} onPress={() => { setSelectedMedia([]); setSendMediaViewOnce(false); }} style={page.remove}>
            <Text style={page.removeText}>Remove all</Text>
          </Pressable>
        </View>
      ) : null}

      {selectedFile ? (
        <View style={page.previewWrap}>
          <View style={page.filePreview}>
            <Text style={page.fileIcon}>▣</Text>
            <View style={page.fileInfo}>
              <Text numberOfLines={1} style={page.fileName}>{selectedFile.name}</Text>
              {formatFileSize(selectedFile.size ?? null) ? <Text style={page.fileMeta}>{formatFileSize(selectedFile.size ?? null)}</Text> : null}
            </View>
          </View>
          <Pressable disabled={sending} onPress={() => setSelectedFile(null)} style={page.remove}>
            <Text style={page.removeText}>Remove</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={page.composer}>
        <Pressable disabled={sending} onPress={handlePickAttachment} style={page.gallery}>
          <Text style={page.galleryText}>＋</Text>
        </Pressable>
        <TextInput editable={!sending} multiline onChangeText={setText} placeholder="Write a message..." placeholderTextColor={colors.textSecondary} style={page.input} value={text} />
        <Pressable
          disabled={(!text.trim() && selectedMedia.length === 0 && !selectedFile) || sending}
          onPress={() => void handleSend()}
          style={[page.send, ((!text.trim() && selectedMedia.length === 0 && !selectedFile) || sending) && page.sendDisabled]}
        >
          <Text style={page.sendText}>{sending ? '…' : '↑'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
