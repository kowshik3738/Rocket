import {
  addDoc,
  collection,
  doc,
  DocumentData,
  getDocFromServer,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { PermissionsAndroid, Platform } from 'react-native';
import { MediaStream, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription, mediaDevices } from 'react-native-webrtc';

import { db } from '@/lib/firebase';
import {
  FirestoreTimestampValue,
  getFirestoreTimestampMillis,
  recordCallHistory,
} from '@/services/messaging-service';

const STUN_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const TERMINAL_PHASES = new Set<CallPhase>(['cancelled', 'declined', 'failed', 'ended']);
const TERMINAL_HISTORY_READ_ATTEMPTS = 3;
const TERMINAL_HISTORY_RETRY_DELAY_MS = 200;

function firestoreErrorDetails(error: Error) {
  const firestoreError = error as Error & { code?: string };
  return { code: firestoreError.code ?? 'unknown', message: firestoreError.message };
}

export type CallPhase = 'ringing' | 'accepted' | 'cancelled' | 'declined' | 'failed' | 'ended';
export type CallRole = 'caller' | 'callee';
export type CallStatus = 'idle' | 'ringing' | 'connecting' | 'connected' | 'ended';

export type CallRecord = {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  kind: 'voice';
  phase: CallPhase;
  offerType: 'offer';
  offerSdp: string;
  answerType: 'answer' | null;
  answerSdp: string | null;
  createdAt: Timestamp | null;
  answeredAt: Timestamp | null;
  endedAt: Timestamp | null;
  endedBy: string | null;
};

export type CallState = {
  call: CallRecord | null;
  role: CallRole | null;
  status: CallStatus;
  muted: boolean;
  error: string | null;
};

type CandidatePayload = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
};

type CallSession = {
  callId: string;
  userId: string;
  role: CallRole | null;
  call: CallRecord | null;
  status: CallStatus;
  muted: boolean;
  error: string | null;
  peer: RTCPeerConnection | null;
  localStream: MediaStream | null;
  callWritten: boolean;
  answerApplied: boolean;
  remoteDescriptionSet: boolean;
  localCandidateQueue: CandidatePayload[];
  remoteCandidateQueue: CandidatePayload[];
  receivedCandidateIds: Set<string>;
  hasConnected: boolean;
  terminalTransitionInFlight: boolean;
  unsubscribeCall: (() => void) | null;
  unsubscribeRemoteCandidates: (() => void) | null;
};

let activeSession: CallSession | null = null;
let state: CallState = { call: null, role: null, status: 'idle', muted: false, error: null };
const stateListeners = new Set<(nextState: CallState) => void>();

function isCallPhase(value: unknown): value is CallPhase {
  return value === 'ringing' || value === 'accepted' || value === 'cancelled' || value === 'declined' || value === 'failed' || value === 'ended';
}

function isFirestoreTimestamp(value: unknown): value is Timestamp {
  if (value instanceof Timestamp) return true;
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { seconds?: unknown; nanoseconds?: unknown; toMillis?: unknown; toDate?: unknown };
  return Number.isInteger(candidate.seconds)
    && Number.isInteger(candidate.nanoseconds)
    && typeof candidate.toMillis === 'function'
    && typeof candidate.toDate === 'function';
}

function timestampOrNull(value: unknown): Timestamp | null {
  return isFirestoreTimestamp(value) ? value : null;
}

function historyTimestampOrNull(value: unknown): FirestoreTimestampValue | null {
  return getFirestoreTimestampMillis(value) == null ? null : value as FirestoreTimestampValue;
}

type TerminalHistoryCall = {
  callId: string;
  conversationId: string | null;
  callerId: string | null;
  calleeId: string | null;
  phase: CallPhase | null;
  answeredAt: FirestoreTimestampValue | null;
  endedAt: FirestoreTimestampValue | null;
  answeredAtMillis: number | null;
  endedAtMillis: number | null;
  endedBy: string | null;
  callerAndCalleeDiffer: boolean;
  authenticatedUidIsParticipant: boolean;
  failedPredicates: string[];
};

function mapTerminalHistoryCall(callId: string, data: DocumentData, userId: string): TerminalHistoryCall {
  const conversationId = typeof data.conversationId === 'string' ? data.conversationId : null;
  const callerId = typeof data.callerId === 'string' ? data.callerId : null;
  const calleeId = typeof data.calleeId === 'string' ? data.calleeId : null;
  const phase = isCallPhase(data.phase) ? data.phase : null;
  const answeredAt = historyTimestampOrNull(data.answeredAt);
  const endedAt = historyTimestampOrNull(data.endedAt);
  const answeredAtMillis = getFirestoreTimestampMillis(data.answeredAt);
  const endedAtMillis = getFirestoreTimestampMillis(data.endedAt);
  const endedBy = typeof data.endedBy === 'string' ? data.endedBy : null;
  const callerAndCalleeDiffer = !!callerId && !!calleeId && callerId !== calleeId;
  const authenticatedUidIsParticipant = !!callerId && !!calleeId && (userId === callerId || userId === calleeId);
  const failedPredicates: string[] = [];

  if (!conversationId) failedPredicates.push('conversationId is a string');
  if (!callerId) failedPredicates.push('callerId is a string');
  if (!calleeId) failedPredicates.push('calleeId is a string');
  if (phase !== 'cancelled' && phase !== 'declined' && phase !== 'failed' && phase !== 'ended') failedPredicates.push('phase is terminal');
  if (!endedAt) failedPredicates.push('endedAt does not yield finite timestamp milliseconds');
  if (phase === 'ended' && !answeredAt) failedPredicates.push('answeredAt does not yield finite timestamp milliseconds for completed calls');

  return {
    callId,
    conversationId,
    callerId,
    calleeId,
    phase,
    answeredAt,
    endedAt,
    answeredAtMillis,
    endedAtMillis,
    endedBy,
    callerAndCalleeDiffer,
    authenticatedUidIsParticipant,
    failedPredicates,
  };
}

function mapCall(id: string, data: DocumentData): CallRecord | null {
  if (
    typeof data.conversationId !== 'string'
    || typeof data.callerId !== 'string'
    || typeof data.calleeId !== 'string'
    || data.kind !== 'voice'
    || !isCallPhase(data.phase)
    || data.offerType !== 'offer'
    || typeof data.offerSdp !== 'string'
  ) return null;

  const hasAnswer = Object.prototype.hasOwnProperty.call(data, 'answerType')
    || Object.prototype.hasOwnProperty.call(data, 'answerSdp')
    || Object.prototype.hasOwnProperty.call(data, 'answeredAt');
  const hasEnd = Object.prototype.hasOwnProperty.call(data, 'endedBy')
    || Object.prototype.hasOwnProperty.call(data, 'endedAt');
  const timestampOrPending = (value: unknown) => value == null || isFirestoreTimestamp(value);

  // Firestore returns `null` for a pending serverTimestamp in the local
  // optimistic snapshot. Terminal calls do not need active-call answer data,
  // so recognize them before validating active signaling fields.
  if (TERMINAL_PHASES.has(data.phase)) {
    if (!hasEnd || typeof data.endedBy !== 'string' || !timestampOrPending(data.endedAt)) return null;
  } else {
    if (hasEnd) return null;
    if (data.phase === 'accepted') {
      if (
        !hasAnswer
        || data.answerType !== 'answer'
        || typeof data.answerSdp !== 'string'
        || !timestampOrPending(data.answeredAt)
      ) return null;
    } else if (hasAnswer) return null;
  }

  return {
    id,
    conversationId: data.conversationId,
    callerId: data.callerId,
    calleeId: data.calleeId,
    kind: 'voice',
    phase: data.phase,
    offerType: 'offer',
    offerSdp: data.offerSdp,
    answerType: data.answerType === 'answer' ? 'answer' : null,
    answerSdp: typeof data.answerSdp === 'string' ? data.answerSdp : null,
    createdAt: timestampOrNull(data.createdAt),
    answeredAt: timestampOrNull(data.answeredAt),
    endedAt: timestampOrNull(data.endedAt),
    endedBy: typeof data.endedBy === 'string' ? data.endedBy : null,
  };
}

function callRef(callId: string) {
  return doc(db, 'calls', callId);
}

function getRole(call: CallRecord, userId: string): CallRole | null {
  if (call.callerId === userId) return 'caller';
  if (call.calleeId === userId) return 'callee';
  return null;
}

function publish(session: CallSession | null = activeSession) {
  state = session
    ? { call: session.call, role: session.role, status: session.status, muted: session.muted, error: session.error }
    : { call: null, role: null, status: 'idle', muted: false, error: null };
  stateListeners.forEach((listener) => listener(state));
}

function setError(session: CallSession, error: unknown, status?: CallStatus) {
  session.error = error instanceof Error ? error.message : String(error);
  if (status) session.status = status;
  publish(session);
}

function createSession(callId: string, userId: string, role: CallRole | null = null): CallSession {
  return {
    callId,
    userId,
    role,
    call: null,
    status: 'idle',
    muted: false,
    error: null,
    peer: null,
    localStream: null,
    callWritten: false,
    answerApplied: false,
    remoteDescriptionSet: false,
    localCandidateQueue: [],
    remoteCandidateQueue: [],
    receivedCandidateIds: new Set<string>(),
    hasConnected: false,
    terminalTransitionInFlight: false,
    unsubscribeCall: null,
    unsubscribeRemoteCandidates: null,
  };
}

function stopTransport(session: CallSession, _reason: string) {
  session.unsubscribeRemoteCandidates?.();
  session.unsubscribeRemoteCandidates = null;
  session.peer?.close();
  session.peer = null;
  session.localStream?.getTracks().forEach((track) => track.stop());
  session.localStream?.release();
  session.localStream = null;
  session.localCandidateQueue = [];
  session.remoteCandidateQueue = [];
  session.receivedCandidateIds.clear();
  session.muted = false;
}

function disposeSession() {
  if (!activeSession) return;
  activeSession.unsubscribeCall?.();
  activeSession.unsubscribeCall = null;
  stopTransport(activeSession, 'session-disposed');
  activeSession = null;
  publish(null);
}

function markTerminal(session: CallSession) {
  stopTransport(session, 'terminal-call');
  session.status = 'ended';
  publish(session);
}

function markLocalTerminal(session: CallSession, phase: Extract<CallPhase, 'cancelled' | 'declined' | 'failed' | 'ended'>) {
  if (!session.call) return;
  session.call = { ...session.call, phase, endedAt: null, endedBy: session.userId };
  markTerminal(session);
}

function delayTerminalHistoryRead() {
  return new Promise<void>((resolve) => setTimeout(resolve, TERMINAL_HISTORY_RETRY_DELAY_MS));
}

function hasOnlyPendingTimestampFailures(call: TerminalHistoryCall) {
  return call.failedPredicates.length > 0
    && call.failedPredicates.every((predicate) => predicate.startsWith('endedAt does not yield') || predicate.startsWith('answeredAt does not yield'));
}

async function readTerminalHistoryCall(session: CallSession): Promise<TerminalHistoryCall> {
  for (let attempt = 1; attempt <= TERMINAL_HISTORY_READ_ATTEMPTS; attempt += 1) {
    const snapshot = await getDocFromServer(callRef(session.callId));
    if (!snapshot.exists()) {
      throw new Error('The terminal call could not be read.');
    }

    const call = mapTerminalHistoryCall(snapshot.id, snapshot.data(), session.userId);
    if (!hasOnlyPendingTimestampFailures(call) || attempt === TERMINAL_HISTORY_READ_ATTEMPTS) return call;
    await delayTerminalHistoryRead();
  }

  throw new Error('The terminal call could not be read.');
}

async function persistTerminalHistory(session: CallSession) {
  const call = await readTerminalHistoryCall(session);
  if (call.failedPredicates.length > 0 || !call.conversationId || !call.callerId || !call.calleeId || !call.endedAt) {
    throw new Error(`The terminal call does not contain valid history data: ${call.failedPredicates.join(', ')}`);
  }

  if (call.phase !== 'cancelled' && call.phase !== 'declined' && call.phase !== 'failed' && call.phase !== 'ended') {
    throw new Error('The terminal call does not contain a terminal phase.');
  }

  // A failed peer connection is terminal signaling only. It never becomes a
  // chat-history event because no participant confirmed a working connection.
  if (call.phase === 'failed') return;

  const outcome = call.phase === 'ended' ? 'completed' : call.phase;
  await recordCallHistory({
    callId: call.callId,
    conversationId: call.conversationId,
    callerId: call.callerId,
    calleeId: call.calleeId,
    outcome,
    answeredAt: call.answeredAt,
    endedAt: call.endedAt,
  });
}

function scheduleTerminalHistory(session: CallSession) {
  void persistTerminalHistory(session).catch((error) => {
    const details = firestoreErrorDetails(error instanceof Error ? error : new Error(String(error)));
    console.error('[Rocket call history] persistence failed', {
      operation: 'get/create',
      callId: session.callId,
      conversationId: session.call?.conversationId ?? null,
      uid: session.userId,
      phase: session.call?.phase ?? null,
      ...details,
    });
  });
}

async function requestMicrophonePermission() {
  if (Platform.OS !== 'android') return;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
    title: 'Microphone access',
    message: 'Rocket needs microphone access for voice calls.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('Microphone access is required to make or answer a voice call.');
  }
}

function candidatePayload(candidate: RTCIceCandidate): CandidatePayload {
  const serialized = candidate.toJSON();
  return {
    candidate: serialized.candidate,
    sdpMid: serialized.sdpMid ?? null,
    sdpMLineIndex: serialized.sdpMLineIndex ?? null,
  };
}

async function writeLocalCandidate(session: CallSession, candidate: CandidatePayload) {
  if (!session.role) return;
  const collectionName = session.role === 'caller' ? 'callerCandidates' : 'calleeCandidates';
  await addDoc(collection(db, 'calls', session.callId, collectionName), {
    ...candidate,
    createdAt: serverTimestamp(),
  });
}

function queueOrWriteLocalCandidate(session: CallSession, candidate: CandidatePayload) {
  if (!session.callWritten) {
    session.localCandidateQueue.push(candidate);
    return;
  }
  void writeLocalCandidate(session, candidate).catch((error) => setError(session, error));
}

async function flushLocalCandidates(session: CallSession) {
  const candidates = session.localCandidateQueue.splice(0);
  for (const candidate of candidates) {
    await writeLocalCandidate(session, candidate);
  }
}

async function addRemoteCandidate(session: CallSession, candidate: CandidatePayload) {
  if (!session.peer || !session.remoteDescriptionSet) {
    session.remoteCandidateQueue.push(candidate);
    return;
  }
  await session.peer.addIceCandidate(new RTCIceCandidate(candidate));
}

async function flushRemoteCandidates(session: CallSession) {
  const candidates = session.remoteCandidateQueue.splice(0);
  for (const candidate of candidates) {
    await addRemoteCandidate(session, candidate);
  }
}

function subscribeToRemoteCandidates(session: CallSession) {
  if (!session.role || session.unsubscribeRemoteCandidates) return;
  const collectionName = session.role === 'caller' ? 'calleeCandidates' : 'callerCandidates';
  session.unsubscribeRemoteCandidates = onSnapshot(collection(db, 'calls', session.callId, collectionName), (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type !== 'added' || session.receivedCandidateIds.has(change.doc.id)) return;
      session.receivedCandidateIds.add(change.doc.id);
      const data = change.doc.data();
      if (
        typeof data.candidate !== 'string'
        || (data.sdpMid != null && typeof data.sdpMid !== 'string')
        || (data.sdpMLineIndex != null && !Number.isInteger(data.sdpMLineIndex))
      ) return;
      void addRemoteCandidate(session, {
        candidate: data.candidate,
        sdpMid: data.sdpMid ?? null,
        sdpMLineIndex: data.sdpMLineIndex ?? null,
      }).catch((error) => setError(session, error));
    });
  }, (error) => {
    setError(session, error);
  });
}

async function preparePeer(session: CallSession) {
  await requestMicrophonePermission();
  const localStream = await mediaDevices.getUserMedia({ audio: true, video: false });
  if (localStream.getAudioTracks().length === 0) {
    localStream.release();
    throw new Error('No microphone audio track was available.');
  }

  const peer = new RTCPeerConnection({ iceServers: STUN_SERVERS });
  session.localStream = localStream;
  session.peer = peer;
  localStream.getTracks().forEach((track) => peer.addTrack(track, localStream));
  peer.onicecandidate = (event: { candidate: RTCIceCandidate | null }) => {
    if (event.candidate) {
      const candidate = candidatePayload(event.candidate);
      queueOrWriteLocalCandidate(session, candidate);
    }
  };
  peer.onconnectionstatechange = () => {
    if (activeSession !== session) return;
    if (peer.connectionState === 'connected') {
      session.hasConnected = true;
      session.status = 'connected';
      publish(session);
    } else if (peer.connectionState === 'connecting') {
      session.status = 'connecting';
      publish(session);
    } else if (peer.connectionState === 'failed') {
      // An accepted SDP exchange is not a connected call. Preserve a completed
      // history event only when this peer actually reached `connected` first.
      if (session.hasConnected) {
        void endCall().catch(() => undefined);
      } else {
        void failConnection(session);
      }
      setError(session, 'The voice connection failed.', 'ended');
    }
  };
}

async function applyAnswer(session: CallSession, call: CallRecord) {
  if (!session.peer || session.answerApplied || !call.answerSdp) return;
  session.answerApplied = true;
  try {
    await session.peer.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: call.answerSdp }));
    session.remoteDescriptionSet = true;
    await flushRemoteCandidates(session);
  } catch (error) {
    session.answerApplied = false;
    throw error;
  }
}

async function processCallSnapshot(session: CallSession, call: CallRecord) {
  const role = getRole(call, session.userId);
  if (!role) {
    setError(session, 'You are not a participant in this call.', 'ended');
    return;
  }

  session.call = call;
  session.role = role;
  session.callWritten = true;
  if (TERMINAL_PHASES.has(call.phase)) {
    markTerminal(session);
    return;
  }

  if (call.phase === 'accepted') {
    session.status = session.hasConnected ? 'connected' : 'connecting';
    publish(session);
    if (role === 'caller') {
      try {
        await applyAnswer(session, call);
      } catch (error) {
        setError(session, error, 'ended');
      }
    }
    return;
  }

  session.status = 'ringing';
  publish(session);
}

function subscribeToCallDocument(session: CallSession) {
  session.unsubscribeCall?.();
  session.unsubscribeCall = onSnapshot(callRef(session.callId), (snapshot) => {
    if (!snapshot.exists()) {
      setError(session, 'This call is no longer available.', 'ended');
      return;
    }
    const call = mapCall(snapshot.id, snapshot.data());
    if (!call) {
      setError(session, 'This call has invalid signaling data.', 'ended');
      return;
    }
    void processCallSnapshot(session, call);
  }, (error) => {
    setError(session, error, 'ended');
  });
}

function requireActiveSession(): CallSession {
  if (!activeSession || !activeSession.call) throw new Error('There is no active call.');
  return activeSession;
}

export function getCallState(): CallState {
  return state;
}

export function getResumableCallForConversation(conversationId: string, userId: string): CallRecord | null {
  const call = activeSession?.call;
  if (
    !activeSession
    || activeSession.userId !== userId
    || !call
    || call.conversationId !== conversationId
    || TERMINAL_PHASES.has(call.phase)
  ) return null;
  return call;
}

export function disposeCallSession() {
  disposeSession();
}

export function subscribeToCallState(listener: (nextState: CallState) => void): () => void {
  stateListeners.add(listener);
  listener(state);
  return () => stateListeners.delete(listener);
}

export function watchCall(callId: string, userId: string) {
  if (activeSession?.callId === callId) return;
  if (activeSession && !TERMINAL_PHASES.has(activeSession.call?.phase ?? 'ended')) {
    throw new Error('Finish the current call before opening another one.');
  }
  disposeSession();
  activeSession = createSession(callId, userId);
  subscribeToCallDocument(activeSession);
  publish(activeSession);
}

export async function startOutgoingCall(conversationId: string, callerId: string, calleeId: string): Promise<string> {
  if (!conversationId || !callerId || !calleeId || callerId === calleeId) {
    throw new Error('This conversation cannot start a voice call.');
  }
  if (activeSession && !TERMINAL_PHASES.has(activeSession.call?.phase ?? 'ended')) {
    throw new Error('Finish the current call before starting another one.');
  }

  disposeSession();
  const reference = doc(collection(db, 'calls'));
  const session = createSession(reference.id, callerId, 'caller');
  activeSession = session;
  publish(session);

  try {
    await preparePeer(session);
    const offer = await session.peer!.createOffer();
    await session.peer!.setLocalDescription(offer);
    await setDoc(reference, {
      conversationId,
      callerId,
      calleeId,
      kind: 'voice',
      phase: 'ringing',
      offerType: 'offer',
      offerSdp: offer.sdp,
      createdAt: serverTimestamp(),
    });
    session.callWritten = true;
    await flushLocalCandidates(session);
    session.call = {
      id: reference.id,
      conversationId,
      callerId,
      calleeId,
      kind: 'voice',
      phase: 'ringing',
      offerType: 'offer',
      offerSdp: offer.sdp,
      answerType: null,
      answerSdp: null,
      createdAt: null,
      answeredAt: null,
      endedAt: null,
      endedBy: null,
    };
    session.status = 'ringing';
    subscribeToCallDocument(session);
    subscribeToRemoteCandidates(session);
    publish(session);
    return reference.id;
  } catch (error) {
    stopTransport(session, 'outgoing-start-failed');
    activeSession = null;
    publish(null);
    throw error;
  }
}

export async function acceptIncomingCall() {
  const session = requireActiveSession();
  if (!session.call || session.role !== 'callee' || session.call.phase !== 'ringing') {
    throw new Error('This call can no longer be accepted.');
  }

  try {
    // The incoming call document already exists, so local ICE candidates may
    // safely be written while the answer is being prepared.
    session.callWritten = true;
    await preparePeer(session);
    subscribeToRemoteCandidates(session);
    await session.peer!.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: session.call.offerSdp }));
    session.remoteDescriptionSet = true;
    await flushRemoteCandidates(session);
    const answer = await session.peer!.createAnswer();
    await session.peer!.setLocalDescription(answer);
    await updateDoc(callRef(session.callId), {
      phase: 'accepted',
      answerType: 'answer',
      answerSdp: answer.sdp,
      answeredAt: serverTimestamp(),
    });
    session.status = session.hasConnected ? 'connected' : 'connecting';
    publish(session);
  } catch (error) {
    stopTransport(session, 'incoming-accept-failed');
    setError(session, error, 'ringing');
    throw error;
  }
}

export async function declineIncomingCall() {
  const session = requireActiveSession();
  if (!session.call || session.role !== 'callee' || session.call.phase !== 'ringing') {
    throw new Error('This call can no longer be declined.');
  }
  await updateDoc(callRef(session.callId), {
    phase: 'declined',
    endedAt: serverTimestamp(),
    endedBy: session.userId,
  });
  markLocalTerminal(session, 'declined');
  scheduleTerminalHistory(session);
}

export async function cancelOutgoingCall() {
  const session = requireActiveSession();
  if (!session.call || session.role !== 'caller' || session.call.phase !== 'ringing') {
    throw new Error('This call can no longer be cancelled.');
  }
  await updateDoc(callRef(session.callId), {
    phase: 'cancelled',
    endedAt: serverTimestamp(),
    endedBy: session.userId,
  });
  markLocalTerminal(session, 'cancelled');
  scheduleTerminalHistory(session);
}

export async function endCall() {
  const session = requireActiveSession();
  if (!session.call) throw new Error('There is no active call.');
  if (session.call.phase === 'ringing') {
    if (session.role === 'caller') return cancelOutgoingCall();
    return declineIncomingCall();
  }
  if (session.call.phase !== 'accepted') {
    throw new Error('This call has already ended.');
  }
  if (!session.hasConnected) {
    return failConnection(session);
  }
  await updateDoc(callRef(session.callId), {
    phase: 'ended',
    endedAt: serverTimestamp(),
    endedBy: session.userId,
  });
  markLocalTerminal(session, 'ended');
  scheduleTerminalHistory(session);
}

async function failConnection(session: CallSession) {
  if (
    activeSession !== session
    || !session.call
    || TERMINAL_PHASES.has(session.call.phase)
    || session.terminalTransitionInFlight
  ) return;

  session.terminalTransitionInFlight = true;
  try {
    await updateDoc(callRef(session.callId), {
      phase: 'failed',
      endedAt: serverTimestamp(),
      endedBy: session.userId,
    });
    markLocalTerminal(session, 'failed');
  } catch (error) {
    // Both peers can observe the same connection failure. If the other peer
    // already made the call terminal, preserve that immutable terminal state
    // instead of reporting a stale competing update as a second failure.
    const details = firestoreErrorDetails(error instanceof Error ? error : new Error(String(error)));
    if (details.code === 'permission-denied') {
      try {
        const snapshot = await getDocFromServer(callRef(session.callId));
        const data = snapshot.exists() ? snapshot.data() : null;
        const terminalCall = data ? mapCall(snapshot.id, data) : null;
        if (terminalCall && TERMINAL_PHASES.has(terminalCall.phase)) {
          session.call = terminalCall;
          markTerminal(session);
          return;
        }
      } catch {
        // Preserve the original failure below if the authoritative read fails.
      }
    }
    setError(session, error, 'ended');
  } finally {
    session.terminalTransitionInFlight = false;
  }
}

export function toggleMute(): boolean {
  const session = requireActiveSession();
  const track = session.localStream?.getAudioTracks()[0];
  if (!track) throw new Error('Microphone audio is not available.');
  track.enabled = !track.enabled;
  session.muted = !track.enabled;
  publish(session);
  return session.muted;
}

export function dismissEndedCall(callId: string) {
  if (activeSession?.callId !== callId || !TERMINAL_PHASES.has(activeSession.call?.phase ?? 'ended')) return;
  disposeSession();
}

export function subscribeToIncomingCalls(
  userId: string,
  onIncomingCalls: (calls: CallRecord[]) => void,
  onError: (error: Error) => void,
): () => void {
  const incomingQuery = query(
    collection(db, 'calls'),
    where('calleeId', '==', userId),
    where('phase', '==', 'ringing'),
    limit(20),
  );
  return onSnapshot(incomingQuery, (snapshot) => {
    const calls = snapshot.docs
      .map((item) => mapCall(item.id, item.data()))
      .filter((call): call is CallRecord => !!call && call.phase === 'ringing');
    onIncomingCalls(calls);
  }, (error) => {
    console.error('[Rocket calls] incoming listener error', firestoreErrorDetails(error));
    onError(error);
  });
}
