/**
 * Automated Tests for Rocket Vercel Serverless Notification Backend
 *
 * Tests:
 * 1. Serverless compatibility (api/index.js export, /health, /api/health)
 * 2. Unauthorized notification requests (missing or invalid auth headers)
 * 3. Invalid recipients & payload validation (doc ID regex, self-notify, invalid kinds)
 * 4. Duplicate notification attempts & distributed replay protection
 *
 * Runs with Node.js built-in test runner:
 *   node --test backend/test-serverless.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

// Load serverless entry point and server
const serverlessApp = require('./api/index');
const serverApp = require('./server');

/**
 * In-memory HTTP request simulator for Express without opening network sockets.
 * Executes within standard sandboxed environments without EPERM errors.
 */
function simulateRequest(app, options) {
  return new Promise((resolve) => {
    const req = new http.IncomingMessage();
    req.method = options.method || 'GET';
    req.url = options.url || '/';
    req.headers = Object.fromEntries(
      Object.entries(options.headers || {}).map(([k, v]) => [k.toLowerCase(), v])
    );

    const res = new http.ServerResponse(req);
    let body = '';

    res.write = function (chunk) {
      if (chunk) body += chunk.toString();
      return true;
    };

    res.end = function (chunk) {
      if (chunk) body += chunk.toString();
      let json = null;
      try {
        json = JSON.parse(body);
      } catch {}
      resolve({
        statusCode: res.statusCode,
        headers: res.getHeaders(),
        body,
        json,
      });
    };

    const payload = options.body ? JSON.stringify(options.body) : '';
    if (payload) {
      req.headers['content-type'] = 'application/json';
      req.headers['content-length'] = Buffer.byteLength(payload);
      app(req, res);
      req.emit('data', Buffer.from(payload));
      req.emit('end');
    } else {
      app(req, res);
      req.emit('end');
    }
  });
}

// =============================================================================
// 1. Serverless Compatibility Tests
// =============================================================================

test('Serverless entry point (api/index.js) exports valid Express application', () => {
  assert.strictEqual(typeof serverlessApp, 'function');
  assert.strictEqual(typeof serverlessApp.handle, 'function');
  assert.strictEqual(typeof serverlessApp.listen, 'function');
});

test('Health check endpoint /health returns 200 OK with valid service payload', async () => {
  const response = await simulateRequest(serverlessApp, {
    method: 'GET',
    url: '/health',
  });

  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.json?.status, 'ok');
  assert.strictEqual(response.json?.service, 'rocket-notification-backend');
  assert.ok(response.json?.timestamp);
});

test('Health check alias /api/health returns 200 OK for Vercel route compatibility', async () => {
  const response = await simulateRequest(serverlessApp, {
    method: 'GET',
    url: '/api/health',
  });

  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.json?.status, 'ok');
  assert.strictEqual(response.json?.service, 'rocket-notification-backend');
});

// =============================================================================
// 2. Unauthorized Notification Requests Tests
// =============================================================================

test('Rejects notification dispatch when Authorization header is missing', async () => {
  const response = await simulateRequest(serverlessApp, {
    method: 'POST',
    url: '/api/notify',
    body: {
      recipientUid: 'target_user_123',
      kind: 'message',
      data: { conversationId: 'conv_1', messageId: 'msg_1' },
    },
  });

  assert.strictEqual(response.statusCode, 401);
  assert.strictEqual(response.json?.error, 'Missing or malformed Authorization header.');
});

test('Rejects notification dispatch when Authorization header is not Bearer format', async () => {
  const response = await simulateRequest(serverlessApp, {
    method: 'POST',
    url: '/api/notify',
    headers: {
      Authorization: 'Basic invalid_token_format',
    },
    body: {
      recipientUid: 'target_user_123',
      kind: 'message',
      data: { conversationId: 'conv_1', messageId: 'msg_1' },
    },
  });

  assert.strictEqual(response.statusCode, 401);
  assert.strictEqual(response.json?.error, 'Missing or malformed Authorization header.');
});

test('Rejects notification dispatch on /notify alias when Authorization is missing', async () => {
  const response = await simulateRequest(serverlessApp, {
    method: 'POST',
    url: '/notify',
    body: {
      recipientUid: 'target_user_123',
      kind: 'message',
    },
  });

  assert.strictEqual(response.statusCode, 401);
  assert.strictEqual(response.json?.error, 'Missing or malformed Authorization header.');
});

// =============================================================================
// 3. Invalid Recipients & Payload Validation Tests
// =============================================================================

test('Validates recipient document IDs against directory traversal and invalid characters', () => {
  const { isValidDocId } = serverApp;
  assert.strictEqual(isValidDocId('alice123'), true);
  assert.strictEqual(isValidDocId('user_abc-789'), true);
  assert.strictEqual(isValidDocId('c7330768-4a52-4751-bb38-4e8c56fa68c8'), true);

  // Directory traversal attacks
  assert.strictEqual(isValidDocId('../etc/passwd'), false);
  assert.strictEqual(isValidDocId('/root'), false);
  assert.strictEqual(isValidDocId('users/alice'), false);
  assert.strictEqual(isValidDocId(''), false);
  assert.strictEqual(isValidDocId(null), false);
  assert.strictEqual(isValidDocId(undefined), false);
  assert.strictEqual(isValidDocId('invalid.id.with.dots'), false);
});

test('Timestamp age check rejects stale events and excessive future timestamps', () => {
  const { isTimestampRecent } = serverApp;
  const now = Date.now();

  // Fresh events within 120s
  assert.strictEqual(isTimestampRecent({ toMillis: () => now - 5000 }, 120), true);
  assert.strictEqual(isTimestampRecent({ seconds: Math.floor((now - 60000) / 1000) }, 120), true);

  // Stale event older than maxAge
  assert.strictEqual(isTimestampRecent({ toMillis: () => now - 200000 }, 120), false);

  // Timestamp in the future beyond acceptable 30s clock skew
  assert.strictEqual(isTimestampRecent({ toMillis: () => now + 60000 }, 120), false);
});

// =============================================================================
// 4. Duplicate Notification Attempts & Replay Protection Tests
// =============================================================================

test('SHA-256 hashReplayKey generates collision-resistant 64-char valid doc IDs', () => {
  const { hashReplayKey } = serverApp;
  const key1 = 'msg:conversation_123:message_456';
  const key2 = 'grp:group_abc:message_789:recipient_xyz';

  const hash1 = hashReplayKey(key1);
  const hash2 = hashReplayKey(key2);

  assert.strictEqual(hash1.length, 64);
  assert.strictEqual(hash2.length, 64);
  assert.notStrictEqual(hash1, hash2);
  assert.match(hash1, /^[a-f0-9]{64}$/);
});

test('checkAndRecordReplay detects and blocks duplicate notification dispatches', async () => {
  const { checkAndRecordReplay, clearReplay } = serverApp;

  const testEventKey = `test_event_${Date.now()}_${Math.random()}`;

  // First dispatch: not a duplicate
  const firstAttempt = await checkAndRecordReplay(testEventKey, 'caller_1', 'recipient_1', 'message');
  assert.strictEqual(firstAttempt, false, 'First attempt should be recorded and not marked duplicate');

  // Second immediate attempt: duplicate detected
  const secondAttempt = await checkAndRecordReplay(testEventKey, 'caller_1', 'recipient_1', 'message');
  assert.strictEqual(secondAttempt, true, 'Second attempt should be blocked as duplicate');

  // Different event: allowed
  const differentEvent = await checkAndRecordReplay(`${testEventKey}_diff`, 'caller_1', 'recipient_1', 'message');
  assert.strictEqual(differentEvent, false, 'Different event key should be allowed');

  // Clearing replay lock allows re-dispatch (e.g. after dispatch failure)
  await clearReplay(testEventKey);
  const attemptAfterClear = await checkAndRecordReplay(testEventKey, 'caller_1', 'recipient_1', 'message');
  assert.strictEqual(attemptAfterClear, false, 'Re-dispatch should succeed after replay is cleared');
});

test('Rate limiter restricts excess requests per caller', async () => {
  const { checkRateLimit } = serverApp;
  const testUid = `rate_test_user_${Date.now()}`;

  // Up to 30 requests should succeed
  for (let i = 0; i < 30; i++) {
    const allowed = await checkRateLimit(testUid);
    assert.strictEqual(allowed, true, `Request #${i + 1} should be allowed`);
  }

  // 31st request should be throttled
  const throttled = await checkRateLimit(testUid);
  assert.strictEqual(throttled, false, '31st request within window must be throttled');
});

test('Simulated distributed multi-instance concurrency prevents duplicate notifications', async () => {
  // Simulates two separate Vercel serverless function instances receiving the same notification event simultaneously
  const testKey = `concurrent_call_${Date.now()}`;
  const { checkAndRecordReplay } = serverApp;

  // Simulate Instance A and Instance B executing checkAndRecordReplay concurrently
  const [resultInstanceA, resultInstanceB] = await Promise.all([
    checkAndRecordReplay(testKey, 'caller_alice', 'recipient_bob', 'call'),
    checkAndRecordReplay(testKey, 'caller_alice', 'recipient_bob', 'call'),
  ]);

  // Exactly one instance must succeed (false = not duplicate) and the other must be rejected (true = duplicate)
  const results = [resultInstanceA, resultInstanceB].sort();
  assert.deepStrictEqual(
    results,
    [false, true],
    'Exactly one concurrent instance must proceed and the second must be blocked as duplicate'
  );
});
