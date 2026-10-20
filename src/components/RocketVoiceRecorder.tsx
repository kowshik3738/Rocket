import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Keyboard, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import {
  AudioPlayer,
  AudioStatus,
  AudioModule,
  AudioQuality,
  IOSOutputFormat,
  RecordingOptions,
  RecordingStatus,
  useAudioPlayer,
  useAudioRecorder,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { getCallState, subscribeToCallState } from '@/services/call-service';
import { getVideoCallState, subscribeToVideoCallState } from '@/services/video-call-service';
import { useRocketTheme } from '@/design-system';
import { RocketIconButton } from '@/components/rocket-ui';
import { pauseVoiceMessagePlayback } from '@/components/RocketVoiceMessage';
import {
  acquireVoiceRecorder,
  canTransitionVoiceRecorder,
  getVoiceGestureOutcome,
  releaseVoiceRecorder as releaseRecorderLease,
  type VoiceRecorderState,
} from '@/components/voice-recorder-machine';

const MAX_RECORDING_MS = 600000;
const MIN_RECORDING_MS = 300;

export const ROCKET_VOICE_RECORDING_OPTIONS: RecordingOptions = {
  isMeteringEnabled: false,
  extension: '.m4a',
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 64000,
  android: {
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 64000,
  },
};

interface Props {
  onSend: (uri: string, durationMs: number, mimeType: VoiceMessageMimeType) => Promise<void>;
  onActiveChange: (active: boolean) => void;
  disabled?: boolean;
}

export type VoiceMessageMimeType = 'audio/mp4' | 'audio/webm';

type GestureOutcome = 'send' | 'cancel' | 'lock';

function formatTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder < 10 ? '0' : ''}${remainder}`;
}

function isCallActive() {
  const voiceStatus = getCallState().status;
  const videoStatus = getVideoCallState().status;
  return ['ringing', 'connecting', 'connected'].includes(voiceStatus)
    || ['ringing', 'connecting', 'connected'].includes(videoStatus);
}

function safeErrorDetails(error: unknown) {
  const candidate = error instanceof Error
    ? error as Error & { code?: unknown }
    : { name: 'UnknownError', message: String(error) };
  const message = (candidate.message || 'Unknown error')
    .replace(/(?:file|content|https?):\/\/\S+/gi, '[source]')
    .replace(/(?:\/[^\s:]+){2,}/g, '[path]')
    .slice(0, 240);
  const code = typeof candidate.code === 'string' || typeof candidate.code === 'number'
    ? candidate.code
    : 'unknown';
  return { name: candidate.name || 'UnknownError', code, message };
}

function recordingErrorMessage(error: unknown) {
  const details = safeErrorDetails(error);
  if (/permission|denied/i.test(details.message)) {
    return 'Microphone access is required. Allow microphone access in Android settings and try again.';
  }
  if (/audio.*(?:in use|busy|focus)|(?:in use|busy).*(?:microphone|audio)|resource busy|start failed:?\s*-38|prepare failed:?\s*-38/i.test(details.message)) {
    return 'The microphone is busy. End any call and close other apps using the microphone, then try again.';
  }
  return 'Voice recording could not start. Check microphone access and try again.';
}

function activeRecorderState(state: VoiceRecorderState) {
  return state !== 'idle';
}

function VoicePreviewPlayer({
  source,
  onPlayerChange,
  onStatus,
}: {
  source: string;
  onPlayerChange: (player: AudioPlayer | null) => void;
  onStatus: (status: AudioStatus) => void;
}) {
  const player = useAudioPlayer(source, { updateInterval: 500 });

  useEffect(() => {
    onPlayerChange(player);
    const subscription = player.addListener('playbackStatusUpdate', onStatus);
    return () => {
      subscription.remove();
      onPlayerChange(null);
    };
  }, [onPlayerChange, onStatus, player]);

  return null;
}

export function RocketVoiceRecorder({ onSend, onActiveChange, disabled = false }: Props) {
  const { colors } = useRocketTheme();
  const onSendRef = useRef(onSend);
  const onActiveChangeRef = useRef(onActiveChange);
  const disabledRef = useRef(disabled);
  const mountedRef = useRef(false);
  const stateRef = useRef<VoiceRecorderState>('idle');
  const ownerRef = useRef(Symbol('rocket-voice-recorder'));
  const previewPlayerRef = useRef<AudioPlayer | null>(null);
  const gestureOutcomeRef = useRef<GestureOutcome | null>(null);
  const cancelRequestedRef = useRef(false);
  const activeNotifiedRef = useRef(false);
  const recordingStartedAtRef = useRef(0);
  const recordingUriRef = useRef<string | null>(null);
  const durationMsRef = useRef(0);
  const recorderErrorHandlerRef = useRef<(error: unknown) => void>(() => {});

  const [recorderState, setRecorderState] = useState<VoiceRecorderState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [sendFailed, setSendFailed] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [previewDurationMs, setPreviewDurationMs] = useState(0);
  const [previewPlaybackSeconds, setPreviewPlaybackSeconds] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

  const pulse = useSharedValue(1);

  onSendRef.current = onSend;
  onActiveChangeRef.current = onActiveChange;
  disabledRef.current = disabled;

  const transitionTo = useCallback((next: VoiceRecorderState) => {
    const current = stateRef.current;
    if (!canTransitionVoiceRecorder(current, next)) {
      console.error('[Rocket voice recorder] invalid state transition', { current, next });
      return false;
    }

    stateRef.current = next;
    if (mountedRef.current) setRecorderState(next);

    const active = activeRecorderState(next);
    if (mountedRef.current && active !== activeNotifiedRef.current) {
      activeNotifiedRef.current = active;
      onActiveChangeRef.current(active);
    }
    return true;
  }, []);

  const handleRecorderStatus = useCallback((status: RecordingStatus) => {
    const state = stateRef.current;
    if (status.hasError && (state === 'recording' || state === 'locked')) {
      recorderErrorHandlerRef.current(status.error || 'The native recorder reported an error.');
    }
  }, []);
  const recorder = useAudioRecorder(ROCKET_VOICE_RECORDING_OPTIONS, handleRecorderStatus);

  const cleanupAudioMode = useCallback(async () => {
    if (isCallActive()) return;
    try {
      await AudioModule.setAudioModeAsync({ allowsRecording: false });
    } catch (error) {
      console.error('[Rocket voice recorder] audio mode reset failed', safeErrorDetails(error));
    }
  }, []);

  const cleanupNativeRecorder = useCallback(async () => {
    try {
      const status = recorder.getStatus();
      if (status.isRecording || status.canRecord) {
        await recorder.stop();
      }
    } catch (error) {
      console.error('[Rocket voice recorder] native recorder cleanup failed', safeErrorDetails(error));
    }
  }, [recorder]);

  const removeRecordingFile = useCallback(async (uri: string | null) => {
    if (!uri) return;
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch (error) {
      console.error('[Rocket voice recorder] temporary file cleanup failed', safeErrorDetails(error));
    }
  }, []);

  const handlePreviewPlayerChange = useCallback((player: AudioPlayer | null) => {
    previewPlayerRef.current = player;
  }, []);

  const handlePreviewStatus = useCallback((status: AudioStatus) => {
    if (!mountedRef.current) return;
    setIsPreviewPlaying(status.playing);
    setPreviewPlaybackSeconds(status.currentTime);
  }, []);

  const releaseRecorderOwner = useCallback(() => {
    releaseRecorderLease(ownerRef.current);
  }, []);

  const resetRecorder = useCallback(async () => {
    const uri = recordingUriRef.current || recorder.uri;
    if (stateRef.current === 'recording' || stateRef.current === 'locked') {
      transitionTo('stopping');
    }
    previewPlayerRef.current?.pause();
    await cleanupNativeRecorder();
    await cleanupAudioMode();
    await removeRecordingFile(uri);
    recordingUriRef.current = null;
    durationMsRef.current = 0;
    recordingStartedAtRef.current = 0;
    cancelRequestedRef.current = false;
    gestureOutcomeRef.current = null;
    setErrorMessage('');
    setSendFailed(false);
    setElapsedSeconds(0);
    setPreviewDurationMs(0);
    setPreviewPlaybackSeconds(0);
    setIsPreviewPlaying(false);
    releaseRecorderOwner();
    transitionTo('idle');
  }, [
    cleanupAudioMode,
    cleanupNativeRecorder,
    recorder,
    releaseRecorderOwner,
    removeRecordingFile,
    transitionTo,
  ]);

  const cancelRecording = useCallback(async () => {
    const state = stateRef.current;
    if (state === 'preparing') {
      cancelRequestedRef.current = true;
      gestureOutcomeRef.current = 'cancel';
      return;
    }
    if (state === 'stopping') {
      cancelRequestedRef.current = true;
      return;
    }
    if (state === 'sending') return;
    if (state !== 'idle') await resetRecorder();
    else await cleanupAudioMode();
  }, [cleanupAudioMode, resetRecorder]);

  const sendPreview = useCallback(async () => {
    const uri = recordingUriRef.current;
    const durationMs = durationMsRef.current;
    if (stateRef.current !== 'preview' || !uri || durationMs <= 0) return;

    transitionTo('sending');
    setSendFailed(false);
    try {
      const mimeType: VoiceMessageMimeType = uri.toLowerCase().endsWith('.webm')
        ? 'audio/webm'
        : 'audio/mp4';
      await onSendRef.current(uri, durationMs, mimeType);
      previewPlayerRef.current?.pause();
      await removeRecordingFile(uri);
      recordingUriRef.current = null;
      durationMsRef.current = 0;
      releaseRecorderOwner();
      transitionTo('idle');
      setPreviewDurationMs(0);
      setElapsedSeconds(0);
    } catch (error) {
      console.error('[Rocket voice recorder] send failed', safeErrorDetails(error));
      setSendFailed(true);
      setErrorMessage('Voice message was not sent. Tap send to retry.');
      transitionTo('preview');
    }
  }, [releaseRecorderOwner, removeRecordingFile, transitionTo]);

  const stopAndPreview = useCallback(async (sendAfterStop: boolean) => {
    if (stateRef.current !== 'recording' && stateRef.current !== 'locked') return;
    transitionTo('stopping');
    try {
      await recorder.stop();
      const status = recorder.getStatus();

      if (cancelRequestedRef.current || !mountedRef.current) {
        await removeRecordingFile(status.url || recorder.uri);
        await cleanupAudioMode();
        recordingUriRef.current = null;
        releaseRecorderOwner();
        transitionTo('idle');
        return;
      }
      if (isCallActive()) {
        await removeRecordingFile(status.url || recorder.uri);
        recordingUriRef.current = null;
        setErrorMessage('Recording stopped because a call became active.');
        transitionTo('error');
        releaseRecorderOwner();
        return;
      }

      const durationMs = Math.min(
        MAX_RECORDING_MS,
        Math.round(Math.max(status.durationMillis, Date.now() - recordingStartedAtRef.current)),
      );
      const uri = status.url || recorder.uri;
      if (!uri) throw new Error('The recording did not produce an audio file. Please try again.');
      if (durationMs <= 0) throw new Error('The recording was too short. Hold the microphone a little longer.');

      recordingUriRef.current = uri;
      durationMsRef.current = durationMs;
      await cleanupAudioMode();
      setPreviewDurationMs(durationMs);
      setElapsedSeconds(Math.floor(durationMs / 1000));
      releaseRecorderOwner();
      transitionTo('preview');
      if (sendAfterStop) await sendPreview();
    } catch (error) {
      console.error('[Rocket voice recorder] stop failed', safeErrorDetails(error));
      await cleanupNativeRecorder();
      await cleanupAudioMode();
      await removeRecordingFile(recordingUriRef.current || recorder.uri);
      recordingUriRef.current = null;
      releaseRecorderOwner();
      setErrorMessage(recordingErrorMessage(error));
      transitionTo('error');
    } finally {
      cancelRequestedRef.current = false;
    }
  }, [
    cleanupAudioMode,
    cleanupNativeRecorder,
    recorder,
    releaseRecorderOwner,
    removeRecordingFile,
    sendPreview,
    transitionTo,
  ]);

  const failRecording = useCallback(async (error: unknown) => {
    if (stateRef.current === 'recording' || stateRef.current === 'locked') {
      transitionTo('stopping');
    }
    const uri = recordingUriRef.current || recorder.uri;
    await cleanupNativeRecorder();
    await cleanupAudioMode();
    await removeRecordingFile(uri);
    recordingUriRef.current = null;
    releaseRecorderOwner();
    setErrorMessage(recordingErrorMessage(error));
    transitionTo('error');
  }, [
    cleanupAudioMode,
    cleanupNativeRecorder,
    recorder,
    releaseRecorderOwner,
    removeRecordingFile,
    transitionTo,
  ]);

  const processGestureOutcome = useCallback(async (outcome: GestureOutcome) => {
    const state = stateRef.current;
    if (state === 'preparing') {
      gestureOutcomeRef.current = outcome;
      if (outcome === 'cancel') cancelRequestedRef.current = true;
      return;
    }
    if (state !== 'recording') return;

    if (outcome === 'cancel') {
      await cancelRecording();
    } else if (outcome === 'lock') {
      transitionTo('locked');
    } else {
      const elapsedMs = Date.now() - recordingStartedAtRef.current;
      if (elapsedMs < MIN_RECORDING_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_RECORDING_MS - elapsedMs));
      }
      if (stateRef.current === 'recording') await stopAndPreview(true);
    }
  }, [cancelRecording, stopAndPreview, transitionTo]);

  const beginRecording = useCallback(async () => {
    if (disabledRef.current || (stateRef.current !== 'idle' && stateRef.current !== 'error')) return;
    const pendingOutcome = gestureOutcomeRef.current;
    if (pendingOutcome === 'cancel') {
      gestureOutcomeRef.current = null;
      return;
    }
    if (isCallActive()) {
      gestureOutcomeRef.current = null;
      setErrorMessage("Can't record a voice message during a call.");
      transitionTo('preparing');
      transitionTo('error');
      return;
    }
    if (!acquireVoiceRecorder(ownerRef.current)) {
      gestureOutcomeRef.current = null;
      setErrorMessage('Another voice recorder is already active. Close it and try again.');
      transitionTo('preparing');
      transitionTo('error');
      return;
    }

    cancelRequestedRef.current = false;
    setErrorMessage('');
    setSendFailed(false);
    Keyboard.dismiss();
    transitionTo('preparing');
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (cancelRequestedRef.current || !mountedRef.current) {
        await resetRecorder();
        return;
      }
      if (!permission.granted) throw new Error('Microphone permission denied.');
      if (isCallActive()) throw new Error("Can't record a voice message during a call.");

      pauseVoiceMessagePlayback();
      await AudioModule.setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      if (cancelRequestedRef.current || !mountedRef.current || isCallActive()) {
        await resetRecorder();
        return;
      }

      await recorder.prepareToRecordAsync();
      if (cancelRequestedRef.current || !mountedRef.current || isCallActive()) {
        await resetRecorder();
        return;
      }

      recorder.record();
      recordingStartedAtRef.current = Date.now();
      setElapsedSeconds(0);
      transitionTo('recording');
      const pending = gestureOutcomeRef.current;
      gestureOutcomeRef.current = null;
      if (pending) await processGestureOutcome(pending);
    } catch (error) {
      console.error('[Rocket voice recorder] start failed', safeErrorDetails(error));
      await cleanupNativeRecorder();
      await cleanupAudioMode();
      releaseRecorderOwner();
      gestureOutcomeRef.current = null;
      if (cancelRequestedRef.current || !mountedRef.current) {
        cancelRequestedRef.current = false;
        transitionTo('idle');
      } else {
        setErrorMessage(recordingErrorMessage(error));
        transitionTo('error');
      }
    }
  }, [
    cleanupAudioMode,
    cleanupNativeRecorder,
    processGestureOutcome,
    recorder,
    releaseRecorderOwner,
    resetRecorder,
    transitionTo,
  ]);

  const finishGesture = useCallback((translationX: number, translationY: number, successful: boolean) => {
    if (disabledRef.current) return;
    const outcome = getVoiceGestureOutcome(translationX, translationY, successful);
    const state = stateRef.current;
    if (state === 'preparing') {
      gestureOutcomeRef.current = outcome;
      if (outcome === 'cancel') cancelRequestedRef.current = true;
      return;
    }
    if (state === 'recording') {
      void processGestureOutcome(outcome);
      return;
    }
    if (state === 'idle') {
      gestureOutcomeRef.current = outcome;
      if (outcome !== 'cancel') void beginRecording();
    }
  }, [beginRecording, processGestureOutcome]);

  const recordingGesture = useMemo(
    () => Gesture.Pan()
      .minDistance(0)
      .maxPointers(1)
      .shouldCancelWhenOutside(false)
      .onBegin(() => {
        runOnJS(beginRecording)();
      })
      .onFinalize((event, successful) => {
        runOnJS(finishGesture)(event.translationX, event.translationY, successful);
      }),
    [beginRecording, finishGesture],
  );

  recorderErrorHandlerRef.current = (error) => {
    console.error('[Rocket voice recorder] native recording error', safeErrorDetails(error));
    void failRecording(error);
  };

  useEffect(() => {
    mountedRef.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void cancelRecording();
    });
    return () => {
      mountedRef.current = false;
      subscription.remove();
      void cancelRecording();
    };
  }, [cancelRecording]);

  useEffect(() => {
    const handleCallState = () => {
      if (isCallActive() && stateRef.current !== 'idle') void cancelRecording();
    };
    const unsubscribeVoice = subscribeToCallState(handleCallState);
    const unsubscribeVideo = subscribeToVideoCallState(handleCallState);
    return () => {
      unsubscribeVoice();
      unsubscribeVideo();
    };
  }, [cancelRecording]);

  useFocusEffect(useCallback(() => {
    if (stateRef.current === 'idle') void cleanupAudioMode();
    return () => {
      void cancelRecording();
    };
  }, [cancelRecording, cleanupAudioMode]));

  useEffect(() => {
    if (recorderState !== 'recording' && recorderState !== 'locked') {
      cancelAnimation(pulse);
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(withTiming(1.15, { duration: 700 }), -1, true);
    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - recordingStartedAtRef.current) / 1000);
      if (mountedRef.current) setElapsedSeconds(seconds);
      if (seconds * 1000 >= MAX_RECORDING_MS) void stopAndPreview(false);
    }, 250);
    return () => clearInterval(timer);
  }, [pulse, recorderState, stopAndPreview]);

  const pulseAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  const isRecording = recorderState === 'recording' || recorderState === 'locked';
  const hasPreview = recorderState === 'preview' || recorderState === 'sending';
  const isExpanded = recorderState !== 'idle';
  const isPreparing = recorderState === 'preparing';
  const isLocked = recorderState === 'locked';
  const isSending = recorderState === 'sending';

  return (
    <View
      style={[
        styles.container,
        isExpanded && [
          styles.expandedContainer,
          { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderSubtle },
        ],
      ]}>
      {isExpanded ? (
        <View style={styles.statusColumn}>
          {isRecording ? (
            <>
              <View style={styles.recordingStatus}>
                <Animated.View
                  style={[styles.recordingDot, { backgroundColor: colors.error }, pulseAnimatedStyle]}
                />
                <Text style={[styles.durationText, { color: colors.primaryText }]}>
                  {formatTime(elapsedSeconds)}
                </Text>
              </View>
              <Text style={[styles.hintText, { color: colors.secondaryText }]}>
                {isLocked ? 'Locked · tap stop to preview' : '← Cancel · slide up to lock'}
              </Text>
            </>
          ) : hasPreview ? (
            <>
              <Text style={[styles.previewTitle, { color: colors.primaryText }]}>Voice message</Text>
              <Text style={[styles.hintText, { color: sendFailed ? colors.error : colors.secondaryText }]}>
                {isSending
                  ? 'Sending…'
                  : sendFailed
                    ? 'Not sent · tap send to retry'
                    : `${formatTime(isPreviewPlaying ? previewPlaybackSeconds : previewDurationMs / 1000)} / ${formatTime(previewDurationMs / 1000)}`}
              </Text>
            </>
          ) : isPreparing ? (
            <Text style={[styles.hintText, { color: colors.secondaryText }]}>Preparing microphone…</Text>
          ) : (
            <Text style={[styles.hintText, { color: colors.error }]}>{errorMessage}</Text>
          )}
        </View>
      ) : null}

      <View style={styles.micTouchTarget}>
        {isLocked ? (
          <RocketIconButton
            accessibilityLabel="Stop recording and preview"
            disabled={disabled}
            glyph="■"
            onPress={() => void stopAndPreview(false)}
            size="md"
            variant="accent"
          />
        ) : hasPreview ? (
          <View style={styles.previewActions}>
            <RocketIconButton
              accessibilityLabel={isPreviewPlaying ? 'Pause voice message preview' : 'Play voice message preview'}
              disabled={isSending || disabled}
              glyph={isPreviewPlaying ? '⏸' : '▶'}
              onPress={() => {
                  const player = previewPlayerRef.current;
                  if (!player) return;
                  if (player.playing) player.pause();
                  else player.play();
              }}
              size="md"
              variant="filled"
            />
            <RocketIconButton
              accessibilityLabel="Delete voice message"
              disabled={isSending || disabled}
              glyph="×"
              onPress={() => void resetRecorder()}
              size="md"
              variant="ghost"
            />
            <RocketIconButton
              accessibilityLabel={isSending ? 'Sending voice message' : 'Send voice message'}
              disabled={isSending || disabled}
              glyph={isSending ? '…' : '↑'}
              onPress={() => void sendPreview()}
              size="md"
              variant="accent"
            />
          </View>
        ) : (
          <GestureDetector gesture={recordingGesture}>
            <View style={styles.gestureTarget}>
              <RocketIconButton
                accessibilityHint="Press and hold to record. Release to send. Slide left to cancel or up to lock."
                accessibilityLabel={
                  isPreparing
                    ? 'Preparing microphone'
                    : recorderState === 'error'
                      ? 'Retry voice recording'
                      : isRecording
                        ? 'Recording voice message'
                        : 'Record voice message'
                }
                disabled={disabled || isPreparing || recorderState === 'stopping'}
                glyph={isPreparing ? '…' : isRecording ? '●' : recorderState === 'error' ? '↻' : '🎙'}
                size="md"
                variant={isRecording || recorderState === 'error' ? 'accent' : 'filled'}
              />
            </View>
          </GestureDetector>
        )}
      </View>
      {hasPreview && recordingUriRef.current ? (
        <VoicePreviewPlayer
          onPlayerChange={handlePreviewPlayerChange}
          onStatus={handlePreviewStatus}
          source={recordingUriRef.current}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandedContainer: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 8,
  },
  statusColumn: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: 8,
  },
  recordingStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordingDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  durationText: {
    fontSize: 16,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  previewTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  hintText: {
    fontSize: 11,
    marginTop: 3,
  },
  micTouchTarget: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gestureTarget: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
