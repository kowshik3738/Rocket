import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RTCView } from 'react-native-webrtc';

import {
  Radius,
  RocketAvatar,
  RocketIconButton,
  RocketLoadingIndicator,
  RocketText,
  SpacingScale,
  useRocketTheme,
} from '@/design-system';
import { useAuth } from '@/providers/auth-provider';
import { getUserProfile, UserProfile, getProfileInitials, getProfileColor } from '@/services/user-service';
import {
  acceptVideoCall,
  cancelVideoCall,
  declineVideoCall,
  disposeVideoCallSession,
  endActiveVideoCall,
  getVideoCallState,
  joinVideoCallSession,
  subscribeToVideoCallState,
  switchCamera,
  toggleCamera,
  toggleVideoMute,
  VideoCallState,
} from '@/services/video-call-service';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export default function VideoCallScreen() {
  const { callId } = useLocalSearchParams<{ callId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { colors } = useRocketTheme();

  const [callState, setCallState] = useState<VideoCallState>(getVideoCallState());
  const [otherUser, setOtherUser] = useState<UserProfile | null>(null);
  const [connectingDuration, setConnectingDuration] = useState(0);
  const [pipPosition, setPipPosition] = useState({ x: SCREEN_WIDTH - 120 - 16, y: insets.top + 70 });

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user || !callId) return;

    // Join session if incoming or initialize
    void joinVideoCallSession(callId, user.uid).catch((err) => {
      console.warn('[Rocket video screen] join error', err);
    });

    const unsubscribe = subscribeToVideoCallState((nextState) => {
      setCallState(nextState);

      // Fetch other user profile
      if (nextState.call) {
        const otherUid =
          nextState.call.callerId === user.uid
            ? nextState.call.calleeId
            : nextState.call.callerId;
        if (!otherUser || otherUser.uid !== otherUid) {
          void getUserProfile(otherUid).then(setOtherUser).catch(() => undefined);
        }
      }

      // Handle call ended auto-navigate back after 1.5 seconds
      if (
        nextState.status === 'ended' ||
        (nextState.call &&
          ['cancelled', 'declined', 'failed', 'ended'].includes(nextState.call.phase))
      ) {
        if (!autoLeaveTimerRef.current) {
          autoLeaveTimerRef.current = setTimeout(() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)');
            }
          }, 1500);
        }
      }
    });

    return () => {
      unsubscribe();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (autoLeaveTimerRef.current) {
        clearTimeout(autoLeaveTimerRef.current);
        autoLeaveTimerRef.current = null;
      }
    };
  }, [callId, user]);

  // Real connected call duration timer
  useEffect(() => {
    if (callState.status === 'connected') {
      if (!timerRef.current) {
        timerRef.current = setInterval(() => {
          setConnectingDuration((prev) => prev + 1);
        }, 1000);
      }
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [callState.status]);

  const handleEndOrCancel = async () => {
    if (!user || !callId) return;
    if (callState.role === 'caller' && callState.call?.phase === 'ringing') {
      await cancelVideoCall(callId, user.uid);
    } else {
      await endActiveVideoCall();
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  };

  const handleDecline = async () => {
    if (!user || !callId) return;
    await declineVideoCall(callId, user.uid);
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  };

  const handleAccept = async () => {
    if (!user || !callId) return;
    try {
      await acceptVideoCall(callId, user.uid);
    } catch (err) {
      console.warn('[Rocket video] accept error', err);
    }
  };

  const isCalleeRinging =
    callState.role === 'callee' && callState.call?.phase === 'ringing';
  const isCallerRinging =
    callState.role === 'caller' && callState.call?.phase === 'ringing';
  const isConnected = callState.status === 'connected';
  const isEnded =
    callState.status === 'ended' ||
    (callState.call &&
      ['cancelled', 'declined', 'failed', 'ended'].includes(callState.call.phase));

  const avatar = otherUser
    ? {
        initials: getProfileInitials(otherUser.displayName),
        color: getProfileColor(otherUser.uid),
      }
    : { initials: '✦', color: colors.primaryAccent };

  const statusLabel = isEnded
    ? 'Call ended'
    : isConnected
      ? formatDuration(connectingDuration)
      : isCallerRinging
        ? 'Ringing…'
        : isCalleeRinging
          ? 'Incoming video call…'
          : 'Connecting…';

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Primary Surface: Remote Video Stream or Avatar Placeholder */}
      {callState.remoteStream ? (
        <RTCView
          mirror={false}
          objectFit="cover"
          streamURL={callState.remoteStream.toURL()}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholderBackground]}>
          <View style={styles.callerCard}>
            <RocketAvatar hasOrbit={isConnected} size={110} source={otherUser?.photoUrl} user={avatar} />
            <RocketText style={styles.callerName} variant="screenTitle">
              {otherUser?.displayName ?? 'Calling orbit…'}
            </RocketText>
            {otherUser ? (
              <RocketText color="secondary" variant="bodySecondary">
                @{otherUser.username}
              </RocketText>
            ) : null}
            <RocketText
              color={isConnected ? 'online' : 'muted'}
              style={styles.statusText}
              variant="bodyMedium">
              {statusLabel}
            </RocketText>
            {!isConnected && !isEnded && (
              <View style={styles.loadingSpinner}>
                <RocketLoadingIndicator size="normal" />
              </View>
            )}
          </View>
        </View>
      )}

      {/* Top Header Bar: Minimize Button + Active Status */}
      <View style={[styles.topBar, { paddingTop: Math.max(insets.top, 16) }]}>
        <RocketIconButton
          accessibilityLabel="Minimize call"
          glyph="‹"
          glyphStyle={styles.minimizeGlyph}
          onPress={() => router.back()}
          size="md"
          variant="filled"
        />

        <View style={styles.topStatusPill}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: isConnected
                  ? colors.online
                  : isEnded
                    ? colors.error
                    : colors.warning,
              },
            ]}
          />
          <Text style={styles.topStatusText}>
            {otherUser?.displayName ? `${otherUser.displayName} · ` : ''}
            {statusLabel}
          </Text>
        </View>

        <View style={styles.topBarSpacer} />
      </View>

      {/* Floating PIP Surface: Local Camera Preview */}
      {callState.localStream && !callState.cameraOff ? (
        <View
          style={[
            styles.pipContainer,
            { top: Math.max(insets.top + 60, 80) },
          ]}>
          <RTCView
            mirror={callState.isFrontCamera}
            objectFit="cover"
            streamURL={callState.localStream.toURL()}
            style={styles.pipVideo}
            zOrder={2}
          />
        </View>
      ) : null}

      {/* Error Notice */}
      {callState.error ? (
        <View style={styles.errorNotice}>
          <RocketText color="error" variant="caption">
            {callState.error}
          </RocketText>
        </View>
      ) : null}

      {/* Bottom Controls Bar */}
      <View
        style={[
          styles.bottomControlsWrap,
          { paddingBottom: Math.max(insets.bottom, 24) },
        ]}>
        {isCalleeRinging ? (
          /* Incoming Call Action Buttons */
          <View style={styles.incomingActionsRow}>
            <Pressable
              accessibilityLabel="Decline video call"
              accessibilityRole="button"
              onPress={() => void handleDecline()}
              style={[styles.actionButtonCircle, { backgroundColor: colors.emergency }]}>
              <Text style={styles.actionButtonGlyph}>✕</Text>
              <Text style={styles.actionButtonLabel}>Decline</Text>
            </Pressable>

            <Pressable
              accessibilityLabel="Accept video call"
              accessibilityRole="button"
              onPress={() => void handleAccept()}
              style={[styles.actionButtonCircle, { backgroundColor: colors.success }]}>
              <Text style={styles.actionButtonGlyph}>📹</Text>
              <Text style={styles.actionButtonLabel}>Accept</Text>
            </Pressable>
          </View>
        ) : (
          /* In-Call / Outgoing Controls */
          <View style={styles.controlsRow}>
            {/* Mute Microphone */}
            <Pressable
              accessibilityLabel={callState.muted ? 'Unmute microphone' : 'Mute microphone'}
              accessibilityRole="button"
              disabled={isEnded}
              onPress={toggleVideoMute}
              style={[
                styles.controlButton,
                callState.muted && { backgroundColor: colors.emergencySubtle },
              ]}>
              <Text style={styles.controlIcon}>{callState.muted ? '🔇' : '🎙'}</Text>
              <Text style={styles.controlLabel}>{callState.muted ? 'Unmute' : 'Mute'}</Text>
            </Pressable>

            {/* Toggle Camera On/Off */}
            <Pressable
              accessibilityLabel={callState.cameraOff ? 'Turn camera on' : 'Turn camera off'}
              accessibilityRole="button"
              disabled={isEnded}
              onPress={toggleCamera}
              style={[
                styles.controlButton,
                callState.cameraOff && { backgroundColor: colors.emergencySubtle },
              ]}>
              <Text style={styles.controlIcon}>{callState.cameraOff ? '🚫' : '📷'}</Text>
              <Text style={styles.controlLabel}>{callState.cameraOff ? 'Cam On' : 'Cam Off'}</Text>
            </Pressable>

            {/* Switch Camera (Front / Back) */}
            <Pressable
              accessibilityLabel="Flip camera"
              accessibilityRole="button"
              disabled={isEnded || callState.cameraOff}
              onPress={switchCamera}
              style={[styles.controlButton, callState.cameraOff && { opacity: 0.4 }]}>
              <Text style={styles.controlIcon}>🔄</Text>
              <Text style={styles.controlLabel}>Flip</Text>
            </Pressable>

            {/* End / Cancel Call */}
            <Pressable
              accessibilityLabel={isCallerRinging ? 'Cancel call' : 'End call'}
              accessibilityRole="button"
              onPress={() => void handleEndOrCancel()}
              style={[styles.controlButton, styles.endCallButton]}>
              <Text style={styles.endCallIcon}>☎</Text>
              <Text style={styles.controlLabel}>{isCallerRinging ? 'Cancel' : 'End'}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080A11',
  },
  placeholderBackground: {
    backgroundColor: '#0B0F1C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  callerCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: SpacingScale.sm,
    paddingHorizontal: SpacingScale.xl,
  },
  callerName: {
    marginTop: SpacingScale.md,
    textAlign: 'center',
  },
  statusText: {
    marginTop: SpacingScale.xs,
    fontWeight: '600',
  },
  loadingSpinner: {
    marginTop: SpacingScale.md,
  },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SpacingScale.lg,
    zIndex: 10,
  },
  minimizeGlyph: {
    fontSize: 28,
    marginTop: -2,
  },
  topStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(8, 10, 17, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  topStatusText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '600',
  },
  topBarSpacer: {
    width: 44,
  },
  pipContainer: {
    position: 'absolute',
    right: 16,
    width: 105,
    height: 145,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    backgroundColor: '#000000',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    zIndex: 20,
  },
  pipVideo: {
    width: '100%',
    height: '100%',
  },
  errorNotice: {
    position: 'absolute',
    bottom: 120,
    left: 20,
    right: 20,
    padding: 10,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    borderColor: '#EF4444',
    alignItems: 'center',
  },
  bottomControlsWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: SpacingScale.lg,
    zIndex: 10,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: Radius.xxl,
    backgroundColor: 'rgba(17, 22, 37, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  controlButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 58,
    height: 58,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  controlIcon: {
    fontSize: 20,
  },
  controlLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  endCallButton: {
    backgroundColor: '#EF4444',
  },
  endCallIcon: {
    fontSize: 22,
    color: '#FFFFFF',
    transform: [{ rotate: '135deg' }],
  },
  incomingActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '80%',
  },
  actionButtonCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  actionButtonGlyph: {
    fontSize: 26,
    color: '#FFFFFF',
  },
  actionButtonLabel: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 3,
  },
});
