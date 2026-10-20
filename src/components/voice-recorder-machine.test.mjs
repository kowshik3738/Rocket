import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acquireVoiceRecorder,
  canTransitionVoiceRecorder,
  getVoiceGestureOutcome,
  releaseVoiceRecorder,
} from './voice-recorder-machine.ts';

test('recorder state machine allows the recording, preview, send, and retry flow', () => {
  const transitions = [
    ['idle', 'preparing'],
    ['preparing', 'recording'],
    ['recording', 'locked'],
    ['locked', 'stopping'],
    ['stopping', 'preview'],
    ['preview', 'sending'],
    ['sending', 'preview'],
    ['preview', 'idle'],
    ['preparing', 'error'],
    ['error', 'preparing'],
  ];

  for (const [current, next] of transitions) {
    assert.equal(canTransitionVoiceRecorder(current, next), true, `${current} -> ${next}`);
  }
});

test('recorder state machine rejects concurrent and out-of-order operations', () => {
  assert.equal(canTransitionVoiceRecorder('preparing', 'preparing'), true);
  assert.equal(canTransitionVoiceRecorder('recording', 'sending'), false);
  assert.equal(canTransitionVoiceRecorder('sending', 'recording'), false);
  assert.equal(canTransitionVoiceRecorder('idle', 'preview'), false);
});

test('gesture outcomes use fixed cancel and lock thresholds without moving the control', () => {
  assert.equal(getVoiceGestureOutcome(-81, -81, true), 'cancel');
  assert.equal(getVoiceGestureOutcome(-80, -81, true), 'lock');
  assert.equal(getVoiceGestureOutcome(-80, -80, true), 'send');
  assert.equal(getVoiceGestureOutcome(40, 40, false), 'cancel');
});

test('only one mounted recorder can own the microphone at a time', () => {
  const firstRecorder = Symbol('first');
  const secondRecorder = Symbol('second');

  assert.equal(acquireVoiceRecorder(firstRecorder), true);
  assert.equal(acquireVoiceRecorder(secondRecorder), false);
  releaseVoiceRecorder(secondRecorder);
  assert.equal(acquireVoiceRecorder(secondRecorder), false);
  releaseVoiceRecorder(firstRecorder);
  assert.equal(acquireVoiceRecorder(secondRecorder), true);
  releaseVoiceRecorder(secondRecorder);
});
