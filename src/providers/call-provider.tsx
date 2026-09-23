import { usePathname, useRouter } from 'expo-router';
import { PropsWithChildren, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';
import { CallRecord, CallState, disposeCallSession, getCallState, subscribeToCallState, subscribeToIncomingCalls } from '@/services/call-service';

export function CallProvider({ children }: PropsWithChildren) {
  const { loading, profileError, profileMissing, user } = useAuth();
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const pathname = usePathname();
  const appState = useRef(AppState.currentState);
  const incomingCalls = useRef<CallRecord[]>([]);
  const navigatedCallIds = useRef(new Set<string>());
  const terminalCallIds = useRef(new Set<string>());
  const [callState, setCallState] = useState<CallState>(getCallState());

  useEffect(() => subscribeToCallState((nextState) => {
    if (nextState.call && ['cancelled', 'declined', 'failed', 'ended'].includes(nextState.call.phase)) {
      terminalCallIds.current.add(nextState.call.id);
    }
    setCallState(nextState);
  }), []);

  useEffect(() => {
    if (!loading && (!user || profileError || profileMissing)) {
      disposeCallSession();
    }
  }, [loading, profileError, profileMissing, user]);

  useEffect(() => {
    if (loading || !user || profileError || profileMissing) {
      return;
    }

    const openIncomingCall = () => {
      if (appState.current !== 'active') {
        return;
      }
      const currentCall = getCallState().call;
      if (currentCall && !['cancelled', 'declined', 'failed', 'ended'].includes(currentCall.phase)) {
        return;
      }
      const incomingCall = incomingCalls.current.find((call) => !navigatedCallIds.current.has(call.id) && !terminalCallIds.current.has(call.id));
      if (!incomingCall) {
        return;
      }
      navigatedCallIds.current.add(incomingCall.id);
      try {
        routerRef.current.push(`/call/${incomingCall.id}`);
      } catch (error) {
        navigatedCallIds.current.delete(incomingCall.id);
        console.error('[Rocket calls] incoming navigation failed', error);
      }
    };

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      appState.current = nextState;
      openIncomingCall();
    });
    const unsubscribe = subscribeToIncomingCalls(user.uid, (calls) => {
      incomingCalls.current = calls;
      const ringingIds = new Set(calls.map((call) => call.id));
      navigatedCallIds.current.forEach((callId) => {
        if (!ringingIds.has(callId)) navigatedCallIds.current.delete(callId);
      });
      openIncomingCall();
    }, () => undefined);

    return () => {
      unsubscribe();
      appStateSubscription.remove();
      incomingCalls.current = [];
      navigatedCallIds.current.clear();
      terminalCallIds.current.clear();
    };
  }, [loading, profileError, profileMissing, user?.uid]);

  const activeCall = callState.call;
  const isCallScreen = pathname.startsWith('/call/');
  const showActiveCallBar = !!activeCall
    && !['cancelled', 'declined', 'failed', 'ended'].includes(activeCall.phase)
    && !isCallScreen;

  return <View style={styles.root}>
    {children}
    {showActiveCallBar ? (
      <Pressable accessibilityLabel="Return to active voice call" onPress={() => {
        router.push(`/call/${activeCall.id}`);
      }} style={styles.activeCallBar}>
        <Text style={styles.activeCallTitle}>Voice call active</Text>
        <Text style={styles.activeCallAction}>Return</Text>
      </Pressable>
    ) : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  activeCallBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 108,
    minHeight: 46,
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 100,
    elevation: 8,
  },
  activeCallTitle: { color: '#FFF', fontSize: 15, fontWeight: '900' },
  activeCallAction: { color: '#EAF5FF', fontSize: 13, fontWeight: '800' },
});
