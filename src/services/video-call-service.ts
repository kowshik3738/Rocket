import {
  addDoc,
  collection,
  doc,
  getDocFromServer,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { PermissionsAndroid, Platform } from 'react-native';
import InCallManager from 'react-native-incall-manager';
import {
  mediaDevices,
  MediaStream,
  MediaStreamTrack,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
} from 'react-native-webrtc';

import { db } from '@/lib/firebase';
import { dispatchPushNotification } from '@/services/notification-service';

const STUN_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const TERMINAL_PHASES = new Set<VideoCallPhase>(['cancelled', 'declined', 'failed', 'ended']);

export type VideoCallPhase = 'ringing' | 'accepted' | 'cancelled' | 'declined' | 'failed' | 'ended';
export type VideoCallRole = 'caller' | 'callee';
export type VideoCallStatus = 'idle' | 'ringing' | 'connecting' | 'connected' | 'ended';

export type VideoCallRecord = {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  kind: 'video';
  phase: VideoCallPhase;
  offerType: 'offer';
  offerSdp: string;
  answerType: 'answer' | null;
  answerSdp: string | null;
  createdAt: Timestamp | null;
  answeredAt: Timestamp | null;
  endedAt: Timestamp | null;
  endedBy: string | null;
};

export type VideoCallState = {
  call: VideoCallRecord | null;
  role: VideoCallRole | null;
  status: VideoCallStatus;
  muted: boolean;
  cameraOff: boolean;
  isFrontCamera: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  error: string | null;
};

type CandidatePayload = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
};

type VideoCallSession = {
  callId: string;
  userId: string;
  role: VideoCallRole | null;
  call: VideoCallRecord | null;
  status: VideoCallStatus;
  muted: boolean;
  cameraOff: boolean;
  isFrontCamera: boolean;
  inCallAudioStarted: boolean;
  error: string | null;
  peer: RTCPeerConnection | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
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

let activeSession: VideoCallSession | null = null;
let state: VideoCallState = {
  call: null,
  role: null,
  status: 'idle',
  muted: false,
  cameraOff: false,
  isFrontCamera: true,
  localStream: null,
  remoteStream: null,
  error: null,
};

const listeners = new Set<(nextState: VideoCallState) => void>();

function publish(session?: VideoCallSession | null) {
  if (session && activeSession === session) {
    state = {
      call: session.call,
      role: session.role,
      status: session.status,
      muted: session.muted,
      cameraOff: session.cameraOff,
      isFrontCamera: session.isFrontCamera,
      localStream: session.localStream,
      remoteStream: session.remoteStream,
      error: session.error,
    };
  } else if (!activeSession) {
    state = {
      call: null,
      role: null,
      status: 'idle',
      muted: false,
      cameraOff: false,
      isFrontCamera: true,
      localStream: null,
      remoteStream: null,
      error: null,
    };
  }
  listeners.forEach((listener) => listener(state));
}

export function getVideoCallState(): VideoCallState {
  return state;
}

export function subscribeToVideoCallState(listener: (nextState: VideoCallState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

function callRef(callId: string) {
  return doc(db, 'videoCalls', callId);
}

function mapCall(id: string, data: Record<string, unknown> | undefined): VideoCallRecord | null {
  if (!data) return null;
  return {
    id,
    conversationId: (data.conversationId as string | undefined) ?? '',
    callerId: (data.callerId as string | undefined) ?? '',
    calleeId: (data.calleeId as string | undefined) ?? '',
    kind: 'video',
    phase: (data.phase as VideoCallPhase | undefined) ?? 'failed',
    offerType: 'offer',
    offerSdp: (data.offerSdp as string | undefined) ?? '',
    answerType: (data.answerType as 'answer' | undefined) ?? null,
    answerSdp: (data.answerSdp as string | undefined) ?? null,
    createdAt: (data.createdAt as Timestamp | undefined) ?? null,
    answeredAt: (data.answeredAt as Timestamp | undefined) ?? null,
    endedAt: (data.endedAt as Timestamp | undefined) ?? null,
    endedBy: (data.endedBy as string | undefined) ?? null,
  };
}

async function requestPermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const permissions = [
    PermissionsAndroid.PERMISSIONS.CAMERA,
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  ];
  const results = await PermissionsAndroid.requestMultiple(permissions);
  const cameraGranted = results[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED;
  const audioGranted = results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;

  if (!cameraGranted && !audioGranted) {
    throw new Error('Camera and microphone access are required for video calls.');
  }
  if (!cameraGranted) {
    throw new Error('Camera access is required for video calls.');
  }
  if (!audioGranted) {
    throw new Error('Microphone access is required for video calls.');
  }
}

function startInCallAudio(session: VideoCallSession) {
  if (session.inCallAudioStarted) return;
  session.inCallAudioStarted = true;
  try {
    InCallManager.start({ media: 'video' });
    InCallManager.setForceSpeakerphoneOn(true);
  } catch (error) {
    console.warn('[Rocket video] InCallManager start error', error);
  }
}

function stopInCallAudio(session: VideoCallSession) {
  if (!session.inCallAudioStarted) return;
  session.inCallAudioStarted = false;
  try {
    InCallManager.stop();
  } catch (error) {
    console.warn('[Rocket video] InCallManager stop error', error);
  }
}

function cleanupLocalMedia(session: VideoCallSession) {
  if (session.localStream) {
    session.localStream.getTracks().forEach((track) => {
      try {
        track.enabled = false;
        track.stop();
      } catch (err) {
        console.warn('[Rocket video] error stopping track', err);
      }
    });
    session.localStream = null;
  }
}

function disposeSession() {
  if (!activeSession) return;
  const session = activeSession;
  activeSession = null;

  stopInCallAudio(session);
  cleanupLocalMedia(session);

  if (session.unsubscribeCall) {
    session.unsubscribeCall();
    session.unsubscribeCall = null;
  }
  if (session.unsubscribeRemoteCandidates) {
    session.unsubscribeRemoteCandidates();
    session.unsubscribeRemoteCandidates = null;
  }

  if (session.peer) {
    try {
      session.peer.close();
    } catch {
      // Ignore close errors
    }
    session.peer = null;
  }

  session.remoteStream = null;
  publish(null);
}

export function disposeVideoCallSession() {
  disposeSession();
}

function candidatePayload(candidate: RTCIceCandidate): CandidatePayload {
  const serialized = candidate.toJSON();
  return {
    candidate: serialized.candidate,
    sdpMid: serialized.sdpMid ?? null,
    sdpMLineIndex: serialized.sdpMLineIndex ?? null,
  };
}

async function writeLocalCandidate(session: VideoCallSession, candidate: CandidatePayload) {
  if (!session.role) return;
  const collectionName = session.role === 'caller' ? 'callerCandidates' : 'calleeCandidates';
  await addDoc(collection(db, 'videoCalls', session.callId, collectionName), {
    ...candidate,
    createdAt: serverTimestamp(),
  });
}

function queueOrWriteLocalCandidate(session: VideoCallSession, candidate: CandidatePayload) {
  if (!session.callWritten) {
    session.localCandidateQueue.push(candidate);
    return;
  }
  void writeLocalCandidate(session, candidate).catch((err) => {
    console.warn('[Rocket video] write candidate error', err);
  });
}

async function flushLocalCandidates(session: VideoCallSession) {
  const candidates = session.localCandidateQueue.splice(0);
  for (const candidate of candidates) {
    await writeLocalCandidate(session, candidate);
  }
}

function applyOrQueueRemoteCandidate(session: VideoCallSession, candidate: CandidatePayload) {
  if (!session.peer || !session.remoteDescriptionSet) {
    session.remoteCandidateQueue.push(candidate);
    return;
  }
  try {
    void session.peer.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.warn('[Rocket video] addIceCandidate error', err);
  }
}

function flushRemoteCandidates(session: VideoCallSession) {
  if (!session.peer || !session.remoteDescriptionSet) return;
  const candidates = session.remoteCandidateQueue.splice(0);
  candidates.forEach((candidate) => {
    try {
      void session.peer?.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('[Rocket video] flush remote candidate error', err);
    }
  });
}

function subscribeToRemoteCandidates(session: VideoCallSession) {
  if (!session.role || session.unsubscribeRemoteCandidates) return;
  const collectionName = session.role === 'caller' ? 'calleeCandidates' : 'callerCandidates';
  const candidatesQuery = query(collection(db, 'videoCalls', session.callId, collectionName), limit(100));

  session.unsubscribeRemoteCandidates = onSnapshot(candidatesQuery, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type !== 'added' || session.receivedCandidateIds.has(change.doc.id)) return;
      session.receivedCandidateIds.add(change.doc.id);
      const data = change.doc.data();
      applyOrQueueRemoteCandidate(session, {
        candidate: data.candidate as string,
        sdpMid: (data.sdpMid as string | undefined) ?? null,
        sdpMLineIndex: (data.sdpMLineIndex as number | undefined) ?? null,
      });
    });
  });
}

function createPeerConnection(session: VideoCallSession): RTCPeerConnection {
  const peer = new RTCPeerConnection({ iceServers: STUN_SERVERS });

  peer.onicecandidate = (event: { candidate: RTCIceCandidate | null }) => {
    if (event.candidate) {
      queueOrWriteLocalCandidate(session, candidatePayload(event.candidate));
    }
  };

  peer.ontrack = (event: { streams: MediaStream[] }) => {
    if (event.streams && event.streams[0]) {
      session.remoteStream = event.streams[0];
      publish(session);
    }
  };

  peer.onconnectionstatechange = () => {
    if (peer.connectionState === 'connected') {
      session.hasConnected = true;
      session.status = 'connected';
      startInCallAudio(session);
      publish(session);
    } else if (peer.connectionState === 'failed') {
      void failConnection(session);
    } else if (peer.connectionState === 'disconnected') {
      // Disconnection might recover; if it drops permanently, failConnection triggers
    }
  };

  return peer;
}

async function failConnection(session: VideoCallSession) {
  if (
    activeSession !== session ||
    !session.call ||
    TERMINAL_PHASES.has(session.call.phase) ||
    session.terminalTransitionInFlight
  ) {
    return;
  }
  session.terminalTransitionInFlight = true;
  try {
    await updateDoc(callRef(session.callId), {
      phase: 'failed',
      endedAt: serverTimestamp(),
      endedBy: session.userId,
    });
  } catch (err) {
    console.warn('[Rocket video] failConnection error', err);
  } finally {
    session.terminalTransitionInFlight = false;
    session.status = 'ended';
    publish(session);
  }
}

export async function startOutgoingVideoCall(
  conversationId: string,
  callerId: string,
  calleeId: string,
): Promise<string> {
  if (callerId === calleeId) {
    throw new Error('You cannot start a call with yourself.');
  }

  // Check friendship and block restrictions
  const conversationSnapshot = await doc(db, 'conversations', conversationId);
  const friendshipRef = doc(db, 'friendships', conversationId);
  const blockRef = doc(db, 'userBlocks', `${callerId}_${calleeId}`);

  await runTransaction(db, async (transaction) => {
    const [friendshipSnap, blockSnap] = await Promise.all([
      transaction.get(friendshipRef),
      transaction.get(blockRef),
    ]);
    if (blockSnap.exists()) {
      throw new Error('You have blocked this user.');
    }
    if (!friendshipSnap.exists()) {
      throw new Error('You can only call accepted friends.');
    }
  });

  disposeSession();

  // Request permissions safely
  await requestPermissions();

  const callDocRef = doc(collection(db, 'videoCalls'));
  const callId = callDocRef.id;

  const session: VideoCallSession = {
    callId,
    userId: callerId,
    role: 'caller',
    call: null,
    status: 'ringing',
    muted: false,
    cameraOff: false,
    isFrontCamera: true,
    inCallAudioStarted: false,
    error: null,
    peer: null,
    localStream: null,
    remoteStream: null,
    callWritten: false,
    answerApplied: false,
    remoteDescriptionSet: false,
    localCandidateQueue: [],
    remoteCandidateQueue: [],
    receivedCandidateIds: new Set(),
    hasConnected: false,
    terminalTransitionInFlight: false,
    unsubscribeCall: null,
    unsubscribeRemoteCandidates: null,
  };
  activeSession = session;

  try {
    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: {
        facingMode: 'user',
        frameRate: 30,
      },
    });
    session.localStream = stream;

    const peer = createPeerConnection(session);
    session.peer = peer;

    stream.getTracks().forEach((track) => {
      peer.addTrack(track, stream);
    });

    const offer = await peer.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await peer.setLocalDescription(offer);

    const callPayload = {
      conversationId,
      callerId,
      calleeId,
      kind: 'video',
      phase: 'ringing',
      offerType: 'offer',
      offerSdp: offer.sdp ?? '',
      createdAt: serverTimestamp(),
    };

    await setDoc(callDocRef, callPayload);
    session.callWritten = true;

    void dispatchPushNotification({
      recipientUid: calleeId,
      kind: 'video_call',
      data: {
        callId,
      },
    }).catch((err) => {
      console.warn(`[Push] Failed to dispatch video call notification to ${calleeId}:`, err);
    });

    session.call = {
      id: callId,
      conversationId,
      callerId,
      calleeId,
      kind: 'video',
      phase: 'ringing',
      offerType: 'offer',
      offerSdp: offer.sdp ?? '',
      answerType: null,
      answerSdp: null,
      createdAt: Timestamp.now(),
      answeredAt: null,
      endedAt: null,
      endedBy: null,
    };

    await flushLocalCandidates(session);
    subscribeToRemoteCandidates(session);

    session.unsubscribeCall = onSnapshot(callDocRef, (snapshot) => {
      if (!snapshot.exists()) return;
      const callData = mapCall(snapshot.id, snapshot.data());
      if (!callData) return;
      session.call = callData;

      if (callData.phase === 'accepted' && callData.answerSdp && !session.answerApplied) {
        session.answerApplied = true;
        session.status = 'connecting';
        publish(session);

        void peer
          .setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: callData.answerSdp }))
          .then(() => {
            session.remoteDescriptionSet = true;
            flushRemoteCandidates(session);
          })
          .catch((err) => {
            console.error('[Rocket video] setRemoteDescription error', err);
          });
      } else if (TERMINAL_PHASES.has(callData.phase)) {
        session.status = 'ended';
        stopInCallAudio(session);
        cleanupLocalMedia(session);
        publish(session);
      }
    });

    publish(session);
    return callId;
  } catch (setupError) {
    disposeSession();
    throw setupError;
  }
}

export async function joinVideoCallSession(callId: string, userId: string): Promise<void> {
  if (activeSession?.callId === callId && activeSession.userId === userId) {
    return;
  }

  const snapshot = await getDocFromServer(callRef(callId));
  if (!snapshot.exists()) {
    throw new Error('Video call could not be found.');
  }
  const call = mapCall(snapshot.id, snapshot.data());
  if (!call) {
    throw new Error('Invalid video call record.');
  }
  if (call.callerId !== userId && call.calleeId !== userId) {
    throw new Error('You are not authorized for this video call.');
  }

  // Callee joining incoming call
  if (call.calleeId === userId && call.phase === 'ringing') {
    disposeSession();
    await requestPermissions();

    const session: VideoCallSession = {
      callId,
      userId,
      role: 'callee',
      call,
      status: 'ringing',
      muted: false,
      cameraOff: false,
      isFrontCamera: true,
      inCallAudioStarted: false,
      error: null,
      peer: null,
      localStream: null,
      remoteStream: null,
      callWritten: true,
      answerApplied: false,
      remoteDescriptionSet: false,
      localCandidateQueue: [],
      remoteCandidateQueue: [],
      receivedCandidateIds: new Set(),
      hasConnected: false,
      terminalTransitionInFlight: false,
      unsubscribeCall: null,
      unsubscribeRemoteCandidates: null,
    };
    activeSession = session;

    try {
      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: 'user',
          frameRate: 30,
        },
      });
      session.localStream = stream;

      const peer = createPeerConnection(session);
      session.peer = peer;

      stream.getTracks().forEach((track) => {
        peer.addTrack(track, stream);
      });

      subscribeToRemoteCandidates(session);

      session.unsubscribeCall = onSnapshot(callRef(callId), (snap) => {
        if (!snap.exists()) return;
        const updated = mapCall(snap.id, snap.data());
        if (!updated) return;
        session.call = updated;
        if (TERMINAL_PHASES.has(updated.phase)) {
          session.status = 'ended';
          stopInCallAudio(session);
          cleanupLocalMedia(session);
          publish(session);
        }
      });

      publish(session);
    } catch (err) {
      disposeSession();
      throw err;
    }
  }
}

export async function acceptVideoCall(callId: string, calleeId: string): Promise<void> {
  const session = activeSession;
  if (!session || session.callId !== callId || !session.peer || !session.call) {
    throw new Error('Call session is not active.');
  }

  try {
    session.status = 'connecting';
    publish(session);

    await session.peer.setRemoteDescription(
      new RTCSessionDescription({ type: 'offer', sdp: session.call.offerSdp }),
    );
    session.remoteDescriptionSet = true;
    flushRemoteCandidates(session);

    const answer = await session.peer.createAnswer();
    await session.peer.setLocalDescription(answer);

    await updateDoc(callRef(callId), {
      phase: 'accepted',
      answerType: 'answer',
      answerSdp: answer.sdp ?? '',
      answeredAt: serverTimestamp(),
    });

    await flushLocalCandidates(session);
    publish(session);
  } catch (acceptError) {
    void failConnection(session);
    throw acceptError;
  }
}

export async function declineVideoCall(callId: string, calleeId: string): Promise<void> {
  const session = activeSession;
  try {
    await updateDoc(callRef(callId), {
      phase: 'declined',
      endedAt: serverTimestamp(),
      endedBy: calleeId,
    });
  } catch (err) {
    console.warn('[Rocket video] decline error', err);
  } finally {
    if (session && session.callId === callId) {
      session.status = 'ended';
      publish(session);
    }
    disposeSession();
  }
}

export async function cancelVideoCall(callId: string, callerId: string): Promise<void> {
  const session = activeSession;
  try {
    await updateDoc(callRef(callId), {
      phase: 'cancelled',
      endedAt: serverTimestamp(),
      endedBy: callerId,
    });
  } catch (err) {
    console.warn('[Rocket video] cancel error', err);
  } finally {
    if (session && session.callId === callId) {
      session.status = 'ended';
      publish(session);
    }
    disposeSession();
  }
}

export async function endActiveVideoCall(): Promise<void> {
  const session = activeSession;
  if (!session || !session.call) {
    disposeSession();
    return;
  }

  const callId = session.callId;
  const userId = session.userId;

  try {
    await updateDoc(callRef(callId), {
      phase: 'ended',
      endedAt: serverTimestamp(),
      endedBy: userId,
    });
  } catch (err) {
    console.warn('[Rocket video] end call error', err);
  } finally {
    session.status = 'ended';
    publish(session);
    disposeSession();
  }
}

export function getResumableVideoCallForConversation(
  conversationId: string,
  userId: string
): VideoCallRecord | null {
  const call = activeSession?.call;
  if (
    !activeSession ||
    activeSession.userId !== userId ||
    !call ||
    call.conversationId !== conversationId ||
    TERMINAL_PHASES.has(call.phase)
  ) {
    return null;
  }
  return call;
}

export function toggleVideoMute(): boolean {
  if (!activeSession || !activeSession.localStream) return false;
  const audioTrack = activeSession.localStream.getAudioTracks()[0];
  if (!audioTrack) return false;
  audioTrack.enabled = !audioTrack.enabled;
  activeSession.muted = !audioTrack.enabled;
  publish(activeSession);
  return activeSession.muted;
}

export function toggleCamera(): boolean {
  if (!activeSession || !activeSession.localStream) return false;
  const videoTrack = activeSession.localStream.getVideoTracks()[0];
  if (!videoTrack) return false;
  videoTrack.enabled = !videoTrack.enabled;
  activeSession.cameraOff = !videoTrack.enabled;
  publish(activeSession);
  return activeSession.cameraOff;
}

export function switchCamera(): boolean {
  if (!activeSession || !activeSession.localStream) return true;
  const videoTrack = activeSession.localStream.getVideoTracks()[0] as MediaStreamTrack & {
    _switchCamera?: () => void;
  };
  if (!videoTrack) return true;
  if (typeof videoTrack._switchCamera === 'function') {
    videoTrack._switchCamera();
    activeSession.isFrontCamera = !activeSession.isFrontCamera;
    publish(activeSession);
  }
  return activeSession.isFrontCamera;
}

export function subscribeToIncomingVideoCalls(
  userId: string,
  onIncomingCalls: (calls: VideoCallRecord[]) => void,
  onError: (error: Error) => void,
): () => void {
  const incomingQuery = query(
    collection(db, 'videoCalls'),
    where('calleeId', '==', userId),
    where('phase', '==', 'ringing'),
    limit(20),
  );
  return onSnapshot(
    incomingQuery,
    (snapshot) => {
      const calls = snapshot.docs
        .map((item) => mapCall(item.id, item.data()))
        .filter((call): call is VideoCallRecord => !!call && call.phase === 'ringing');
      onIncomingCalls(calls);
    },
    (error) => {
      console.warn('[Rocket video] incoming calls listener error', error);
      onError(error);
    },
  );
}
