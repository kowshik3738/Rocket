/**
 * Security & Logic Unit Tests for Rocket Hardened Notification Backend
 * Runs with Node.js built-in test runner: node --test backend/test-security.js
 */

const { test } = require('node:test');
const assert = require('node:assert');

// 1. Test Document ID validation regex
const DOC_ID_REGEX = /^[A-Za-z0-9_-]{1,160}$/;
function isValidDocId(id) {
  return typeof id === 'string' && DOC_ID_REGEX.test(id);
}

test('Document ID validation regex accepts valid IDs and rejects malicious ones', () => {
  assert.strictEqual(isValidDocId('user_123'), true);
  assert.strictEqual(isValidDocId('conv_abc-123_def-456'), true);
  assert.strictEqual(isValidDocId('3b80e028-f2fa-469f-9192-220b602d0b7a'), true);

  // Directory traversal / path injection attacks
  assert.strictEqual(isValidDocId('../admin'), false);
  assert.strictEqual(isValidDocId('users/123'), false);
  assert.strictEqual(isValidDocId(''), false);
  assert.strictEqual(isValidDocId(null), false);
  assert.strictEqual(isValidDocId(undefined), false);
  assert.strictEqual(isValidDocId({}), false);
  assert.strictEqual(isValidDocId('a'.repeat(161)), false);
  assert.strictEqual(isValidDocId('invalid.dot.id'), false);
  assert.strictEqual(isValidDocId('user$id'), false);
});

// 2. Test Rate Limiter logic
test('Rate limiter restricts excess requests within window', () => {
  const windowMs = 1000;
  const maxReqs = 5;
  const timestamps = [];

  function check(now) {
    const valid = timestamps.filter((t) => now - t < windowMs);
    if (valid.length >= maxReqs) return false;
    valid.push(now);
    timestamps.length = 0;
    timestamps.push(...valid);
    return true;
  }

  const baseTime = 10000;
  for (let i = 0; i < maxReqs; i++) {
    assert.strictEqual(check(baseTime + i * 10), true);
  }
  // 6th request within window must be rejected
  assert.strictEqual(check(baseTime + 60), false);
  // Request after window expires must succeed
  assert.strictEqual(check(baseTime + windowMs + 10), true);
});

// 3. Test Replay Cache logic
test('Replay protection catches duplicate event keys', () => {
  const ttlMs = 5000;
  const cache = new Map();

  function isReplay(key, now) {
    const cached = cache.get(key);
    if (cached && now - cached < ttlMs) return true;
    cache.set(key, now);
    return false;
  }

  const t0 = 20000;
  assert.strictEqual(isReplay('msg:c1:m1', t0), false);
  // Duplicate within TTL
  assert.strictEqual(isReplay('msg:c1:m1', t0 + 1000), true);
  // Different key
  assert.strictEqual(isReplay('msg:c1:m2', t0 + 1000), false);
  // Same key after TTL expires
  assert.strictEqual(isReplay('msg:c1:m1', t0 + ttlMs + 10), false);
});

// 4. Test Timestamp Age validation logic
test('Timestamp age check rejects stale messages and future timestamps', () => {
  function isRecent(millis, now, maxAgeSec = 120) {
    const age = now - millis;
    return age >= -30000 && age <= maxAgeSec * 1000;
  }

  const now = Date.now();
  assert.strictEqual(isRecent(now - 10000, now), true); // 10s old -> valid
  assert.strictEqual(isRecent(now - 60000, now), true); // 60s old -> valid
  assert.strictEqual(isRecent(now - 200000, now), false); // 200s old -> rejected
  assert.strictEqual(isRecent(now + 60000, now), false); // 60s in future -> rejected
});

// 5. Test Private Message Relationship Check
test('Private message check requires caller and recipient to match conversation participants', () => {
  function verifyParticipants(conv, callerUid, recipientUid) {
    const isCallerA = conv.participantA === callerUid && conv.participantB === recipientUid;
    const isCallerB = conv.participantB === callerUid && conv.participantA === recipientUid;
    return isCallerA || isCallerB;
  }

  const conversation = { participantA: 'alice', participantB: 'bob' };
  assert.strictEqual(verifyParticipants(conversation, 'alice', 'bob'), true);
  assert.strictEqual(verifyParticipants(conversation, 'bob', 'alice'), true);

  // Arbitrary target user attack (Alice sends to Charlie using alice_bob conversation)
  assert.strictEqual(verifyParticipants(conversation, 'alice', 'charlie'), false);
  // Unrelated third-party attack (Eve calls using alice_bob conversation)
  assert.strictEqual(verifyParticipants(conversation, 'eve', 'bob'), false);
  assert.strictEqual(verifyParticipants(conversation, 'eve', 'alice'), false);
});

// 6. Test Group Message Relationship Check
test('Group message check requires both caller and recipient to be members', () => {
  function verifyGroupMembers(group, callerUid, recipientUid) {
    const members = group.memberIds || [];
    return members.includes(callerUid) && members.includes(recipientUid);
  }

  const group = { memberIds: ['alice', 'bob', 'charlie'] };
  assert.strictEqual(verifyGroupMembers(group, 'alice', 'bob'), true);
  assert.strictEqual(verifyGroupMembers(group, 'bob', 'charlie'), true);

  // Caller not in group
  assert.strictEqual(verifyGroupMembers(group, 'stranger', 'bob'), false);
  // Recipient not in group
  assert.strictEqual(verifyGroupMembers(group, 'alice', 'stranger'), false);
});

// 7. Test Call Verification Check
test('Call verification rejects non-ringing, non-matching, and expired calls', () => {
  function verifyCall(call, callerUid, recipientUid, now) {
    if (!call) return { valid: false, reason: 'not_found' };
    if (call.callerId !== callerUid) return { valid: false, reason: 'caller_mismatch' };
    if (call.calleeId !== recipientUid) return { valid: false, reason: 'callee_mismatch' };
    if (call.phase !== 'ringing') return { valid: false, reason: 'not_ringing' };
    const age = now - call.createdAtMillis;
    if (age < -30000 || age > 90000) return { valid: false, reason: 'expired' };
    return { valid: true };
  }

  const now = 1000000;
  const validCall = {
    callerId: 'alice',
    calleeId: 'bob',
    phase: 'ringing',
    createdAtMillis: now - 5000,
  };

  assert.deepStrictEqual(verifyCall(validCall, 'alice', 'bob', now), { valid: true });

  // Caller mismatch
  assert.strictEqual(verifyCall(validCall, 'eve', 'bob', now).valid, false);
  // Callee mismatch (arbitrary target)
  assert.strictEqual(verifyCall(validCall, 'alice', 'charlie', now).valid, false);
  // Not ringing (ended/cancelled)
  assert.strictEqual(verifyCall({ ...validCall, phase: 'ended' }, 'alice', 'bob', now).valid, false);
  assert.strictEqual(verifyCall({ ...validCall, phase: 'declined' }, 'alice', 'bob', now).valid, false);
  // Expired (100 seconds old)
  assert.strictEqual(verifyCall({ ...validCall, createdAtMillis: now - 100000 }, 'alice', 'bob', now).valid, false);
});

// 8. Test Preference Filtering
test('Device preference filtering respects muted categories', () => {
  function filterDevices(deviceDocs, category) {
    return deviceDocs.filter((doc) => {
      const prefs = doc.preferences;
      if (!prefs || typeof prefs !== 'object') return true;
      return prefs[category] !== false;
    });
  }

  const devices = [
    { id: 'phone', preferences: { messages: true, calls: true, social: false } },
    { id: 'tablet', preferences: { messages: false, calls: true, social: true } },
    { id: 'watch', preferences: { messages: true, calls: false, social: true } },
  ];

  // Messages category
  const forMessages = filterDevices(devices, 'messages');
  assert.deepStrictEqual(forMessages.map((d) => d.id), ['phone', 'watch']);

  // Calls category
  const forCalls = filterDevices(devices, 'calls');
  assert.deepStrictEqual(forCalls.map((d) => d.id), ['phone', 'tablet']);

  // Social category
  const forSocial = filterDevices(devices, 'social');
  assert.deepStrictEqual(forSocial.map((d) => d.id), ['tablet', 'watch']);
});

// 9. Test Service Account Parsing & Diagnostics
const { parseServiceAccountString } = require('./server');

test('parseServiceAccountString correctly parses JSON, quoted strings, base64, and rejects malformed inputs', () => {
  const validObj = {
    project_id: 'rocket-87c6a',
    client_email: 'service-account@rocket-87c6a.iam.gserviceaccount.com',
    private_key: '-----BEGIN MOCK KEY-----\\nmock_key_value_for_unit_test\\n-----END MOCK KEY-----\\n',
  };

  // Plain JSON string
  const plain = parseServiceAccountString(JSON.stringify(validObj));
  assert.strictEqual(plain.project_id, 'rocket-87c6a');
  assert.strictEqual(plain.client_email, validObj.client_email);
  assert.ok(plain.private_key.includes('\n'), 'Double-escaped newlines must be normalized to real newlines');

  // Single-quoted JSON string (e.g. copied from .env)
  const singleQuoted = parseServiceAccountString(`'${JSON.stringify(validObj)}'`);
  assert.strictEqual(singleQuoted.project_id, 'rocket-87c6a');

  // Double-quoted JSON string
  const doubleQuoted = parseServiceAccountString(`"${JSON.stringify(validObj)}"`);
  assert.strictEqual(doubleQuoted.project_id, 'rocket-87c6a');

  // Base64-encoded JSON string
  const b64 = parseServiceAccountString(Buffer.from(JSON.stringify(validObj)).toString('base64'));
  assert.strictEqual(b64.project_id, 'rocket-87c6a');

  // Rejects invalid JSON
  assert.throws(
    () => parseServiceAccountString('not_valid_json'),
    /is not valid JSON/
  );

  // Rejects JSON missing required fields
  assert.throws(
    () => parseServiceAccountString(JSON.stringify({ project_id: 'test' })),
    /missing required fields/
  );
});
