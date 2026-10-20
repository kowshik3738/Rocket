import { usePathname, useRouter } from 'expo-router';
import React, { PropsWithChildren, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { useRocketTheme } from '@/design-system';
import { useAuth } from '@/providers/auth-provider';
import {
  disposeVideoCallSession,
  getVideoCallState,
  subscribeToIncomingVideoCalls,
  subscribeToVideoCallState,
  VideoCallRecord,
  VideoCallState,
} from '@/services/video-call-service';

export function VideoCallProvider({ children }: PropsWithChildren) {
  const { loading, profileError, profileMissing, user } = useAuth();
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const pathname = usePathname();
  const { colors } = useRocketTheme();

  const appState = useRef(AppState.currentState);
  const incomingCalls = useRef<VideoCallRecord[]>([]);
  const navigatedCallIds = useRef(new Set<string>());
  const terminalCallIds = useRef(new Set<string>());
  const [callState, setCallState] = useState<VideoCallState>(getVideoCallState());

  useEffect(() => {
    return subscribeToVideoCallState((nextState) => {
      if (
        nextState.call &&
        ['cancelled', 'declined', 'failed', 'ended'].includes(nextState.call.phase)
      ) {
        terminalCallIds.current.add(nextState.call.id);
      }
      setCallState(nextState);
    });
  }, []);

  useEffect(() => {
    if (!loading && (!user || profileError || profileMissing)) {
      disposeVideoCallSession();
    }
  }, [loading, profileError, profileMissing, user]);

  useEffect(() => {
    if (loading || !user || profileError || profileMissing) {
      return;
    }

    const openIncomingCall = () => {
      if (appState.current !== 'active') return;

      const currentCall = getVideoCallState().call;
      if (
        currentCall &&
        !['cancelled', 'declined', 'failed', 'ended'].includes(currentCall.phase)
      ) {
        return;
      }

      const incoming = incomingCalls.current.find(
        (call) =>
          !navigatedCallIds.current.has(call.id) && !terminalCallIds.current.has(call.id),
      );
      if (!incoming) return;

      navigatedCallIds.current.add(incoming.id);
      try {
        routerRef.current.push(`/video-call/${incoming.id}` as any);
      } catch (err) {
        navigatedCallIds.current.delete(incoming.id);
        console.error('[Rocket video provider] incoming navigation failed', err);
      }
    };

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      appState.current = nextState;
      openIncomingCall();
    });

    const unsubscribe = subscribeToIncomingVideoCalls(
      user.uid,
      (calls) => {
        incomingCalls.current = calls;
        const ringingIds = new Set(calls.map((c) => c.id));
        navigatedCallIds.current.forEach((callId) => {
          if (!ringingIds.has(callId)) navigatedCallIds.current.delete(callId);
        });
        openIncomingCall();
      },
      () => undefined,
    );

    return () => {
      unsubscribe();
      appStateSub.remove();
      incomingCalls.current = [];
      navigatedCallIds.current.clear();
      terminalCallIds.current.clear();
    };
  }, [loading, profileError, profileMissing, user?.uid]);

  const activeCall = callState.call;
  const isVideoCallScreen = pathname.startsWith('/video-call/');
  const showActiveCallBar =
    !!activeCall &&
    !['cancelled', 'declined', 'failed', 'ended'].includes(activeCall.phase) &&
    !isVideoCallScreen;

  return (
    <View style={styles.root}>
      {children}
      {showActiveCallBar ? (
        <Pressable
          accessibilityLabel="Return to active video call"
          onPress={() => {
            router.push(`/video-call/${activeCall.id}` as any);
          }}
          style={[styles.activeCallBar, { backgroundColor: colors.highlight }]}>
          <Text style={styles.activeCallTitle}>📹 Video call active</Text>
          <Text style={styles.activeCallAction}>Return</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  activeCallBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 54,
    minHeight: 46,
    borderRadius: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 999,
    elevation: 10,
  },
  activeCallTitle: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  activeCallAction: { color: '#FFF', fontSize: 13, fontWeight: '800', opacity: 0.9 },
});
