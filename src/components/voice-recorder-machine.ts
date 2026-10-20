export type VoiceRecorderState =
  | 'idle'
  | 'preparing'
  | 'recording'
  | 'locked'
  | 'stopping'
  | 'preview'
  | 'sending'
  | 'error';

let activeRecorderOwner: symbol | null = null;

const allowedTransitions: Record<VoiceRecorderState, VoiceRecorderState[]> = {
  idle: ['preparing'],
  preparing: ['idle', 'recording', 'error'],
  recording: ['locked', 'stopping', 'error'],
  locked: ['stopping', 'error'],
  stopping: ['idle', 'preview', 'error'],
  preview: ['idle', 'sending'],
  sending: ['idle', 'preview', 'error'],
  error: ['idle', 'preparing'],
};

export function canTransitionVoiceRecorder(
  current: VoiceRecorderState,
  next: VoiceRecorderState,
): boolean {
  return current === next || allowedTransitions[current].includes(next);
}

export function getVoiceGestureOutcome(
  translationX: number,
  translationY: number,
  successful: boolean,
): 'send' | 'cancel' | 'lock' {
  if (!successful || translationX < -80) return 'cancel';
  if (translationY < -80) return 'lock';
  return 'send';
}

export function acquireVoiceRecorder(owner: symbol): boolean {
  if (activeRecorderOwner !== null && activeRecorderOwner !== owner) return false;
  activeRecorderOwner = owner;
  return true;
}

export function releaseVoiceRecorder(owner: symbol): void {
  if (activeRecorderOwner === owner) activeRecorderOwner = null;
}
