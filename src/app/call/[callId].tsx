import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, colors } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';
import {
  acceptIncomingCall,
  CallState,
  cancelOutgoingCall,
  declineIncomingCall,
  dismissEndedCall,
  endCall,
  getCallState,
  subscribeToCallState,
  toggleMute,
  watchCall,
} from '@/services/call-service';
import { getProfileColor, getProfileInitials, getUserProfile, UserProfile } from '@/services/user-service';

function statusLabel(state: CallState) {
  if (state.call?.phase === 'declined') return 'Call declined';
  if (state.call?.phase === 'cancelled') return 'Call cancelled';
  if (state.call?.phase === 'failed') return 'Voice connection failed';
  if (state.call?.phase === 'ended') return 'Call ended';
  if (state.status === 'connected') return 'Connected';
  if (state.status === 'connecting') return 'Connecting…';
  if (state.status === 'ringing') return state.role === 'callee' ? 'Incoming voice call' : 'Ringing…';
  return state.call?.phase === 'accepted' ? 'Connected' : 'Call ended';
}

export default function CallScreen() {
  const { callId } = useLocalSearchParams<{ callId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [callState, setCallState] = useState<CallState>(getCallState());
  const [otherUser, setOtherUser] = useState<UserProfile | null>(null);
  const [actionError, setActionError] = useState('');
  const [acting, setActing] = useState(false);

  useEffect(() => {
    if (!user || !callId) return;
    try {
      watchCall(callId, user.uid);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'This call could not be opened.');
    }
    const unsubscribe = subscribeToCallState(setCallState);
    return () => {
      unsubscribe();
    };
  }, [callId, user]);

  useEffect(() => {
    const call = callState.call;
    if (!call || !user) return;
    const otherUserId = call.callerId === user.uid ? call.calleeId : call.callerId;
    let active = true;
    void getUserProfile(otherUserId).then((profile) => {
      if (active) setOtherUser(profile);
    }).catch(() => {
      if (active) setOtherUser(null);
    });
    return () => { active = false; };
  }, [callState.call, user]);

  const runAction = (action: () => Promise<void> | void) => {
    setActing(true);
    setActionError('');
    Promise.resolve(action()).catch((error) => {
      setActionError(error instanceof Error ? error.message : 'The call action could not be completed.');
    }).finally(() => setActing(false));
  };

  const call = callState.call;
  const terminal = !!call && ['cancelled', 'declined', 'failed', 'ended'].includes(call.phase);
  const accepted = call?.phase === 'accepted';
  const displayName = otherUser?.displayName || 'Rocket user';
  const avatar = { initials: getProfileInitials(displayName), color: getProfileColor(otherUser?.uid || 'rocket-user') };

  return (
    <View style={styles.page}>
      <View style={styles.content}>
        <Text style={styles.kicker}>VOICE CALL</Text>
        <Avatar size={96} user={avatar} />
        <Text style={styles.name}>{displayName}</Text>
        {otherUser ? <Text style={styles.handle}>@{otherUser.username}</Text> : null}
        {!call && !actionError ? <ActivityIndicator color={colors.accent} style={styles.loading} /> : null}
        <Text style={styles.status}>{call ? statusLabel(callState) : actionError ? 'Call unavailable' : 'Loading call…'}</Text>
        {callState.error || actionError ? <Text style={styles.error}>{actionError || callState.error}</Text> : null}
      </View>

      <View style={styles.actions}>
        {callState.role === 'callee' && callState.status === 'ringing' ? (
          <>
            <Pressable disabled={acting} onPress={() => runAction(acceptIncomingCall)} style={[styles.button, styles.accept, acting && styles.disabled]}><Text style={styles.acceptText}>Accept</Text></Pressable>
            <Pressable disabled={acting} onPress={() => runAction(async () => { await declineIncomingCall(); router.back(); })} style={[styles.button, styles.decline, acting && styles.disabled]}><Text style={styles.declineText}>Decline</Text></Pressable>
          </>
        ) : null}
        {callState.role === 'caller' && callState.status === 'ringing' ? (
          <Pressable disabled={acting} onPress={() => runAction(async () => { await cancelOutgoingCall(); router.back(); })} style={[styles.button, styles.decline, acting && styles.disabled]}><Text style={styles.declineText}>Cancel</Text></Pressable>
        ) : null}
        {accepted ? (
          <>
            <Pressable disabled={acting} onPress={() => runAction(() => { toggleMute(); })} style={[styles.button, styles.mute, acting && styles.disabled]}><Text style={styles.muteText}>{callState.muted ? 'Unmute' : 'Mute'}</Text></Pressable>
            <Pressable disabled={acting} onPress={() => runAction(endCall)} style={[styles.button, styles.decline, acting && styles.disabled]}><Text style={styles.declineText}>End call</Text></Pressable>
          </>
        ) : null}
        {terminal ? <Pressable onPress={() => { if (callId) dismissEndedCall(callId); router.back(); }} style={[styles.button, styles.mute]}><Text style={styles.muteText}>Back to chat</Text></Pressable> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 28, paddingTop: 78, paddingBottom: 34, justifyContent: 'space-between' },
  content: { alignItems: 'center' },
  kicker: { color: colors.accentSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 1.5, marginBottom: 28 },
  name: { color: colors.text, fontSize: 25, fontWeight: '900', marginTop: 20 },
  handle: { color: colors.textSecondary, fontSize: 14, marginTop: 7 },
  status: { color: colors.textSecondary, fontSize: 15, fontWeight: '700', marginTop: 28 },
  loading: { marginTop: 28 },
  error: { color: colors.accent, textAlign: 'center', fontSize: 13, lineHeight: 19, marginTop: 16, maxWidth: 300 },
  actions: { gap: 12 },
  button: { minHeight: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  accept: { backgroundColor: colors.accent },
  acceptText: { color: '#FFF', fontSize: 16, fontWeight: '900' },
  decline: { backgroundColor: '#6E2834' },
  declineText: { color: '#FFF', fontSize: 16, fontWeight: '900' },
  mute: { backgroundColor: colors.backgroundElement, borderWidth: 1, borderColor: colors.border },
  muteText: { color: colors.text, fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.5 },
});
