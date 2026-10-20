/**
 * Rocket FCM Push Notification Backend
 *
 * Hardened, production-ready external push notification service.
 * Compatible with Firebase Spark (free) plan because compute runs externally.
 *
 * Security & Integrity Protections:
 * 1. Strict Authentication: Firebase Auth ID token verification + email_verified requirement.
 * 2. Rate Limiting: Sliding-window rate limit (30 requests/min per user) to stop abuse/flooding.
 * 3. Replay Protection: In-memory TTL cache prevents duplicate notifications for the same event.
 * 4. Input Validation: Document IDs must strictly match /^[A-Za-z0-9_-]{1,160}$/.
 * 5. Impersonation Defense: Notification title and body are NEVER accepted from client input.
 *    They are derived server-side from verified Firestore documents and user profiles.
 * 6. Authorization & Relationship Verification:
 *    - Private messages: Sender and recipient must be the two participants in conversations/{id}.
 *      Message document must exist in Firestore and have been created by caller within 120s.
 *    - Group messages: Sender and recipient must both be active members in groups/{id}.
 *      Group message document must exist and have been created by caller within 120s.
 *    - Calls: Call document must exist, callerId must match caller, calleeId must match recipient,
 *      phase must be 'ringing', and createdAt must be within 90s.
 *    - Social: Verified against actual Firestore friendRequests, comments, or likes documents.
 * 7. Privacy: Respects mutual user blocks (userBlocks collection) and per-device category preferences.
 * 8. Clean-up: Automatically deletes invalid/unregistered tokens from Firestore.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
try {
  require('dotenv').config();
} catch {}

let admin;
try {
  admin = require('firebase-admin');
} catch {
  console.warn('[Rocket Backend] firebase-admin is not installed in local environment. Run `npm install` inside backend/ before deploying.');
}

// Firebase Admin Initialization Status & Safe Diagnostics
let firebaseInitStatus = {
  initialized: false,
  credentialConfigured: false,
  authMethod: 'none',
  projectId: process.env.FIREBASE_PROJECT_ID || 'rocket-87c6a',
  error: null,
};

function parseServiceAccountString(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let str = raw.trim();

  // Strip leading and trailing matching quotes if user wrapped the value in quotes
  if ((str.startsWith("'") && str.endsWith("'")) || (str.startsWith('"') && str.endsWith('"'))) {
    str = str.slice(1, -1).trim();
  }

  // Support base64-encoded JSON string
  if (!str.startsWith('{') && !str.startsWith('[')) {
    try {
      const decoded = Buffer.from(str, 'base64').toString('utf8').trim();
      if (decoded.startsWith('{')) {
        str = decoded;
      }
    } catch {}
  }

  let parsed;
  try {
    parsed = JSON.parse(str);
  } catch (err) {
    throw new Error(`FIREBASE_SERVICE_ACCOUNT is not valid JSON: ${err.message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('FIREBASE_SERVICE_ACCOUNT JSON must be an object.');
  }

  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is missing required fields (project_id, client_email, private_key).');
  }

  // Normalize literal \n in private_key if double-escaped
  if (typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }

  return parsed;
}

// Initialize Firebase Admin SDK
function initializeFirebase() {
  if (!admin) {
    firebaseInitStatus.error = 'firebase-admin package is not available';
    return null;
  }
  if (admin.apps && admin.apps.length > 0) {
    firebaseInitStatus.initialized = true;
    return admin.app();
  }

  // 1. Local file credential (local development only)
  const localKeyPath = path.join(__dirname, 'serviceAccountKey.json');
  if (fs.existsSync(localKeyPath)) {
    try {
      const fileData = JSON.parse(fs.readFileSync(localKeyPath, 'utf8'));
      const app = admin.initializeApp({
        credential: admin.credential.cert(fileData),
      });
      firebaseInitStatus = {
        initialized: true,
        credentialConfigured: true,
        authMethod: 'local_service_account_file',
        projectId: fileData.project_id || process.env.FIREBASE_PROJECT_ID || 'rocket-87c6a',
        error: null,
      };
      return app;
    } catch (err) {
      console.warn('[Rocket Backend] Could not parse serviceAccountKey.json:', err.message);
    }
  }

  // 2. Full Service Account JSON from Environment Variable
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = parseServiceAccountString(process.env.FIREBASE_SERVICE_ACCOUNT);
      const app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      firebaseInitStatus = {
        initialized: true,
        credentialConfigured: true,
        authMethod: 'service_account_env_json',
        projectId: serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID || 'rocket-87c6a',
        error: null,
      };
      return app;
    } catch (err) {
      console.error('[Rocket Backend] FIREBASE_SERVICE_ACCOUNT initialization failed:', err.message);
      firebaseInitStatus.error = err.message;
      return null;
    }
  }

  // 3. Individual Credentials from Environment Variables
  if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
    try {
      let rawKey = process.env.FIREBASE_PRIVATE_KEY.trim();
      if ((rawKey.startsWith("'") && rawKey.endsWith("'")) || (rawKey.startsWith('"') && rawKey.endsWith('"'))) {
        rawKey = rawKey.slice(1, -1);
      }
      const formattedKey = rawKey.replace(/\\n/g, '\n');
      const PEM_HEADER = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
      if (!formattedKey.includes(PEM_HEADER)) {
        throw new Error(`FIREBASE_PRIVATE_KEY is missing valid PEM header (${PEM_HEADER}).`);
      }
      const app = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID || 'rocket-87c6a',
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL.trim(),
          privateKey: formattedKey,
        }),
      });
      firebaseInitStatus = {
        initialized: true,
        credentialConfigured: true,
        authMethod: 'service_account_individual_env',
        projectId: process.env.FIREBASE_PROJECT_ID || 'rocket-87c6a',
        error: null,
      };
      return app;
    } catch (err) {
      console.error('[Rocket Backend] FIREBASE_PRIVATE_KEY initialization failed:', err.message);
      firebaseInitStatus.error = err.message;
      return null;
    }
  }

  // 4. Default initialization (ADC or test environment)
  try {
    const app = admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID || 'rocket-87c6a',
    });
    firebaseInitStatus = {
      initialized: true,
      credentialConfigured: false,
      authMethod: 'adc_fallback_uncredentialed',
      projectId: process.env.FIREBASE_PROJECT_ID || 'rocket-87c6a',
      error: 'Running without explicit Firebase service account credentials. FCM and Firestore operations will fail unless GCP metadata is available.',
    };
    return app;
  } catch (err) {
    firebaseInitStatus.error = err.message;
    return null;
  }
}

const app = express();
app.use(cors());
app.use(express.json());

const firebaseApp = initializeFirebase();
const db = firebaseApp ? admin.firestore(firebaseApp) : null;
const messaging = firebaseApp ? admin.messaging(firebaseApp) : null;

// =============================================================================
// Helper: Document ID and String Validators
// =============================================================================
const DOC_ID_REGEX = /^[A-Za-z0-9_-]{1,160}$/;

function isValidDocId(id) {
  return typeof id === 'string' && DOC_ID_REGEX.test(id);
}

// =============================================================================
// Security: Persistent Distributed Rate Limiter (30 requests / 60 seconds)
// Compatible with Vercel serverless multi-instance execution and Spark tier
// =============================================================================
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 30;
const memoryRateLimitMap = new Map();

async function checkRateLimit(uid) {
  const now = Date.now();

  if (db) {
    try {
      const rateLimitRef = db.collection('notificationRateLimits').doc(uid);
      const isAllowed = await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(rateLimitRef);
        if (!snap.exists) {
          transaction.set(rateLimitRef, {
            windowStartMs: now,
            count: 1,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return true;
        }

        const data = snap.data();
        const windowStartMs = typeof data.windowStartMs === 'number' ? data.windowStartMs : 0;
        const count = typeof data.count === 'number' ? data.count : 0;

        if (now - windowStartMs >= RATE_LIMIT_WINDOW_MS) {
          transaction.set(rateLimitRef, {
            windowStartMs: now,
            count: 1,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return true;
        }

        if (count >= MAX_REQUESTS_PER_WINDOW) {
          return false;
        }

        transaction.update(rateLimitRef, {
          count: admin.firestore.FieldValue.increment(1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return true;
      });

      return isAllowed;
    } catch (err) {
      console.warn('[RateLimit] Firestore rate limit error, falling back to local window', err.message);
    }
  }

  // Fallback to in-memory sliding window (clean inline, zero setInterval timers)
  const timestamps = (memoryRateLimitMap.get(uid) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    memoryRateLimitMap.set(uid, timestamps);
    return false;
  }
  timestamps.push(now);
  memoryRateLimitMap.set(uid, timestamps);
  return true;
}

// =============================================================================
// Security: Persistent Distributed Replay Protection (TTL: 5 minutes)
// Prevents duplicate notifications across all separate Vercel serverless instances
// =============================================================================
const REPLAY_CACHE_TTL_MS = 5 * 60 * 1000;
const memoryReplayCache = new Map();

function hashReplayKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

async function checkAndRecordReplay(replayKey, callerUid, recipientUid, kind) {
  const now = Date.now();

  if (db) {
    try {
      const docId = hashReplayKey(replayKey);
      const replayRef = db.collection('notificationReplays').doc(docId);

      const isDuplicate = await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(replayRef);
        if (snap.exists) {
          const data = snap.data();
          const expiresAtMs = typeof data.expiresAtMs === 'number' ? data.expiresAtMs : 0;
          if (expiresAtMs > now) {
            return true; // Duplicate found within active TTL
          }
        }

        transaction.set(replayRef, {
          replayKey,
          callerUid: callerUid || null,
          recipientUid: recipientUid || null,
          kind: kind || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          expiresAtMs: now + REPLAY_CACHE_TTL_MS,
        });
        return false;
      });

      return isDuplicate;
    } catch (err) {
      console.warn('[Replay] Firestore replay error, falling back to local cache', err.message);
    }
  }

  // Fallback to in-memory replay check (clean inline)
  const cachedTime = memoryReplayCache.get(replayKey);
  if (cachedTime && now - cachedTime < REPLAY_CACHE_TTL_MS) {
    return true;
  }
  memoryReplayCache.set(replayKey, now);
  return false;
}

async function clearReplay(replayKey) {
  memoryReplayCache.delete(replayKey);
  if (db) {
    try {
      const docId = hashReplayKey(replayKey);
      await db.collection('notificationReplays').doc(docId).delete();
    } catch (err) {
      console.warn('[Replay] Failed to delete replay key upon error', err.message);
    }
  }
}

// =============================================================================
// Middleware: Firebase Auth & Verification
// =============================================================================
async function authenticateUser(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header.' });
  }

  const idToken = authHeader.split('Bearer ')[1].trim();
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    if (!decodedToken.email_verified) {
      return res.status(403).json({ error: 'Email verification is required before sending notifications.' });
    }
    req.user = decodedToken;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired Firebase Auth token.' });
  }
}

// Health Check (Supports both /health and /api/health for Vercel routing)
const healthHandler = (req, res) => {
  res.json({
    status: 'ok',
    service: 'rocket-notification-backend',
    environment: process.env.VERCEL ? 'vercel-serverless' : 'node',
    firebase: {
      initialized: firebaseInitStatus.initialized,
      credentialsConfigured: firebaseInitStatus.credentialConfigured,
      authMethod: firebaseInitStatus.authMethod,
      projectId: firebaseInitStatus.projectId,
      ...(firebaseInitStatus.error ? { warning: firebaseInitStatus.error } : {}),
    },
    timestamp: new Date().toISOString(),
  });
};
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// =============================================================================
// Helper: Helper to retrieve User Display Name / Username from Firestore
// =============================================================================
async function getUserDisplayName(uid) {
  try {
    const userDoc = await db.collection('users').doc(uid).get();
    if (userDoc.exists) {
      const data = userDoc.data();
      return data.displayName || data.username || 'Someone';
    }
  } catch (err) {
    console.warn(`[Backend] Could not load profile for ${uid}`, err);
  }
  return 'Someone';
}

// Helper: Check if either user has blocked the other
async function isBlocked(uidA, uidB) {
  try {
    const [blockAB, blockBA] = await Promise.all([
      db.collection('userBlocks').doc(`${uidA}_${uidB}`).get(),
      db.collection('userBlocks').doc(`${uidB}_${uidA}`).get(),
    ]);
    return blockAB.exists || blockBA.exists;
  } catch (err) {
    console.warn('[Backend] Could not check user blocks', err);
    return false;
  }
}

// Helper: Verify timestamp age (in seconds)
function isTimestampRecent(timestamp, maxAgeSeconds = 120) {
  if (!timestamp) return false;
  let millis = 0;
  if (typeof timestamp.toMillis === 'function') {
    millis = timestamp.toMillis();
  } else if (timestamp._seconds) {
    millis = timestamp._seconds * 1000;
  } else if (typeof timestamp.seconds === 'number') {
    millis = timestamp.seconds * 1000;
  }
  if (!millis) return false;
  const ageMs = Date.now() - millis;
  return ageMs >= -30000 && ageMs <= maxAgeSeconds * 1000; // Allow 30s clock skew
}

// =============================================================================
// Main Notification Dispatch Endpoint
// =============================================================================
app.post(['/api/notify', '/notify'], authenticateUser, async (req, res) => {
  // Guard: Ensure Firebase Admin is credentialed in production
  if (!firebaseInitStatus.credentialConfigured && process.env.NODE_ENV !== 'test') {
    return res.status(503).json({
      error: 'Firebase Admin credentials are not configured on this server. Push notifications cannot be processed.',
      details: firebaseInitStatus.error || 'Missing FIREBASE_SERVICE_ACCOUNT or FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY.',
    });
  }

  const callerUid = req.user.uid;

  // 1. Rate Limiting Check
  if (!(await checkRateLimit(callerUid))) {
    return res.status(429).json({ error: 'Too many notification requests. Please wait a moment.' });
  }

  const { recipientUid, kind, data } = req.body;

  // 2. Input Validation
  if (!isValidDocId(recipientUid)) {
    return res.status(400).json({ error: 'Valid recipientUid is required.' });
  }

  if (callerUid === recipientUid) {
    return res.status(400).json({ error: 'Cannot send push notifications to self.' });
  }

  const validKinds = ['message', 'group_message', 'call', 'video_call', 'social'];
  if (!validKinds.includes(kind)) {
    return res.status(400).json({ error: `Invalid notification kind: ${kind}` });
  }

  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Notification data payload is required.' });
  }

  try {
    // 3. User Block Enforcement
    if (await isBlocked(callerUid, recipientUid)) {
      return res.status(403).json({ error: 'Notification blocked by user privacy settings.' });
    }

    let verifiedTitle = 'Rocket';
    let verifiedBody = 'You have a new notification.';
    let verifiedData = { kind };
    let categoryKey = 'messages';
    let channelId = 'messages';
    let isHighPriority = false;
    let replayKey = '';

    // =========================================================================
    // 4. Authorization & Content Derivation by Kind
    // =========================================================================

    // -------------------------------------------------------------------------
    // A. PRIVATE MESSAGES
    // -------------------------------------------------------------------------
    if (kind === 'message') {
      const { conversationId, messageId } = data;
      if (!isValidDocId(conversationId) || !isValidDocId(messageId)) {
        return res.status(400).json({ error: 'Valid conversationId and messageId are required for messages.' });
      }

      // Verify conversation exists and participants match
      const convSnap = await db.collection('conversations').doc(conversationId).get();
      if (!convSnap.exists) {
        return res.status(404).json({ error: 'Conversation not found.' });
      }
      const convData = convSnap.data();
      const isCallerA = convData.participantA === callerUid && convData.participantB === recipientUid;
      const isCallerB = convData.participantB === callerUid && convData.participantA === recipientUid;
      if (!isCallerA && !isCallerB) {
        return res.status(403).json({ error: 'Sender and recipient are not the participants of this conversation.' });
      }

      // Verify message document exists and was authored by caller
      const msgSnap = await db.collection('conversations').doc(conversationId).collection('messages').doc(messageId).get();
      if (!msgSnap.exists) {
        return res.status(404).json({ error: 'Message document not found.' });
      }
      const msgData = msgSnap.data();
      if (msgData.senderId !== callerUid || msgData.recipientId !== recipientUid) {
        return res.status(403).json({ error: 'Message sender or recipient does not match.' });
      }

      // Replay & Age Protection
      if (!isTimestampRecent(msgData.createdAt, 120)) {
        return res.status(400).json({ error: 'Message is too old to send notifications for.' });
      }
      replayKey = `msg:${conversationId}:${messageId}`;
      if (await checkAndRecordReplay(replayKey, callerUid, recipientUid, kind)) {
        return res.json({ sentCount: 0, status: 'duplicate_skipped' });
      }

      // Derive title & body from verified Firestore data
      const senderName = await getUserDisplayName(callerUid);
      verifiedTitle = senderName;
      if (msgData.viewOnce) {
        verifiedBody = 'View once media';
      } else if (msgData.audioUrl) {
        verifiedBody = '🎤 Voice message';
      } else if (msgData.imageUrl) {
        verifiedBody = '📷 Photo';
      } else if (msgData.videoUrl) {
        verifiedBody = '🎥 Video';
      } else if (msgData.fileName) {
        verifiedBody = `📎 File: ${msgData.fileName}`;
      } else if (msgData.locationType === 'live') {
        verifiedBody = '📡 Live location';
      } else if (msgData.locationType === 'current' || msgData.location) {
        verifiedBody = '📍 Location';
      } else if (msgData.text && msgData.text.trim()) {
        verifiedBody = msgData.text.trim().slice(0, 200);
      } else {
        verifiedBody = 'Sent an attachment';
      }

      verifiedData = {
        kind: 'message',
        conversationId,
        messageId,
      };
      categoryKey = 'messages';
      channelId = 'messages';
    }

    // -------------------------------------------------------------------------
    // B. GROUP MESSAGES
    // -------------------------------------------------------------------------
    else if (kind === 'group_message') {
      const { groupId, messageId } = data;
      if (!isValidDocId(groupId) || !isValidDocId(messageId)) {
        return res.status(400).json({ error: 'Valid groupId and messageId are required for group messages.' });
      }

      // Verify group exists and both sender and recipient are members
      const groupSnap = await db.collection('groups').doc(groupId).get();
      if (!groupSnap.exists) {
        return res.status(404).json({ error: 'Group not found.' });
      }
      const groupData = groupSnap.data();
      const memberIds = Array.isArray(groupData.memberIds) ? groupData.memberIds : [];
      if (!memberIds.includes(callerUid)) {
        return res.status(403).json({ error: 'Caller is not a member of this group.' });
      }
      if (!memberIds.includes(recipientUid)) {
        return res.status(403).json({ error: 'Recipient is not a member of this group.' });
      }

      // Verify message document exists and was authored by caller
      const msgSnap = await db.collection('groups').doc(groupId).collection('messages').doc(messageId).get();
      if (!msgSnap.exists) {
        return res.status(404).json({ error: 'Group message document not found.' });
      }
      const msgData = msgSnap.data();
      if (msgData.senderId !== callerUid) {
        return res.status(403).json({ error: 'Caller is not the sender of this group message.' });
      }

      // Replay & Age Protection
      if (!isTimestampRecent(msgData.createdAt, 120)) {
        return res.status(400).json({ error: 'Group message is too old to send notifications for.' });
      }
      replayKey = `grp:${groupId}:${messageId}:${recipientUid}`;
      if (await checkAndRecordReplay(replayKey, callerUid, recipientUid, kind)) {
        return res.json({ sentCount: 0, status: 'duplicate_skipped' });
      }

      // Derive title & body from verified Firestore data
      const senderName = await getUserDisplayName(callerUid);
      verifiedTitle = groupData.name || 'Group Message';
      let previewText = '';
      if (msgData.audioUrl) {
        previewText = '🎤 Voice message';
      } else if (msgData.imageUrl) {
        previewText = '📷 Photo';
      } else if (msgData.videoUrl) {
        previewText = '🎥 Video';
      } else if (msgData.fileName) {
        previewText = `📎 File: ${msgData.fileName}`;
      } else if (msgData.locationType === 'live') {
        previewText = '📡 Live location';
      } else if (msgData.locationType === 'current' || msgData.location) {
        previewText = '📍 Location';
      } else if (msgData.text && msgData.text.trim()) {
        previewText = msgData.text.trim().slice(0, 180);
      } else {
        previewText = 'Attachment';
      }
      verifiedBody = `${senderName}: ${previewText}`;

      verifiedData = {
        kind: 'group_message',
        groupId,
        messageId,
      };
      categoryKey = 'messages';
      channelId = 'messages';
    }

    // -------------------------------------------------------------------------
    // C. VOICE & VIDEO CALLS
    // -------------------------------------------------------------------------
    else if (kind === 'call' || kind === 'video_call') {
      const { callId } = data;
      if (!isValidDocId(callId)) {
        return res.status(400).json({ error: 'Valid callId is required for calls.' });
      }

      const collectionName = kind === 'video_call' ? 'videoCalls' : 'calls';
      const callSnap = await db.collection(collectionName).doc(callId).get();

      // Require existing call document
      if (!callSnap.exists) {
        return res.status(404).json({ error: 'Call document not found.' });
      }

      const callData = callSnap.data();

      // Verify callerId and calleeId match caller and recipient
      if (callData.callerId !== callerUid) {
        return res.status(403).json({ error: 'Caller is not the initiator of this call.' });
      }
      if (callData.calleeId !== recipientUid) {
        return res.status(403).json({ error: 'Recipient is not the callee of this call.' });
      }

      // Verify active ringing status (reject expired, cancelled, declined, or completed calls)
      if (callData.phase !== 'ringing') {
        return res.status(400).json({ error: `Call is not active (current phase: ${callData.phase}).` });
      }

      // Age check: call must have been created within 90 seconds
      if (!isTimestampRecent(callData.createdAt, 90)) {
        return res.status(400).json({ error: 'Call has expired.' });
      }

      // Replay protection: ring only once per callId
      replayKey = `${kind}:${callId}`;
      if (await checkAndRecordReplay(replayKey, callerUid, recipientUid, kind)) {
        return res.json({ sentCount: 0, status: 'duplicate_skipped' });
      }

      // Derive title & body from verified data
      const callerName = await getUserDisplayName(callerUid);
      verifiedTitle = callerName;
      verifiedBody = kind === 'video_call' ? 'Incoming video call...' : 'Incoming voice call...';

      verifiedData = {
        kind,
        callId,
        callerId: callerUid,
      };
      categoryKey = 'calls';
      channelId = 'calls';
      isHighPriority = true;
    }

    // -------------------------------------------------------------------------
    // D. SOCIAL NOTIFICATIONS (Verified Firestore Event Required)
    // -------------------------------------------------------------------------
    else if (kind === 'social') {
      const { subkind, postId, commentId } = data;

      if (!subkind || typeof subkind !== 'string') {
        return res.status(400).json({ error: 'Social subkind is required (friend_request, friend_accepted, comment, like).' });
      }

      const callerName = await getUserDisplayName(callerUid);

      // Subkind 1: Friend Request Sent
      if (subkind === 'friend_request') {
        const reqDoc = await db.collection('friendRequests').doc(`${callerUid}_${recipientUid}`).get();
        if (!reqDoc.exists) {
          return res.status(404).json({ error: 'Friend request record not found.' });
        }
        const reqData = reqDoc.data();
        if (reqData.senderId !== callerUid || reqData.recipientId !== recipientUid || reqData.status !== 'pending') {
          return res.status(400).json({ error: 'No active pending friend request found.' });
        }
        if (!isTimestampRecent(reqData.createdAt, 180)) {
          return res.status(400).json({ error: 'Friend request is too old.' });
        }

        replayKey = `freq:${callerUid}:${recipientUid}`;
        if (await checkAndRecordReplay(replayKey, callerUid, recipientUid, kind)) {
          return res.json({ sentCount: 0, status: 'duplicate_skipped' });
        }

        verifiedTitle = 'Friend Request';
        verifiedBody = `${callerName} sent you a friend request.`;
        verifiedData = { kind: 'social', subkind: 'friend_request', userId: callerUid };
      }

      // Subkind 2: Friend Request Accepted
      else if (subkind === 'friend_accepted') {
        const reqDoc = await db.collection('friendRequests').doc(`${recipientUid}_${callerUid}`).get();
        if (!reqDoc.exists) {
          return res.status(404).json({ error: 'Accepted friend request record not found.' });
        }
        const reqData = reqDoc.data();
        if (reqData.status !== 'accepted') {
          return res.status(400).json({ error: 'Friend request is not accepted.' });
        }
        if (!isTimestampRecent(reqData.acceptedAt, 180)) {
          return res.status(400).json({ error: 'Acceptance event is too old.' });
        }

        replayKey = `faccept:${callerUid}:${recipientUid}`;
        if (await checkAndRecordReplay(replayKey, callerUid, recipientUid, kind)) {
          return res.json({ sentCount: 0, status: 'duplicate_skipped' });
        }

        verifiedTitle = 'Friend Request Accepted';
        verifiedBody = `${callerName} accepted your friend request.`;
        verifiedData = { kind: 'social', subkind: 'friend_accepted', userId: callerUid };
      }

      // Subkind 3: Post Comment
      else if (subkind === 'comment') {
        if (!isValidDocId(postId) || !isValidDocId(commentId)) {
          return res.status(400).json({ error: 'Valid postId and commentId are required for comment notifications.' });
        }
        const [postDoc, commentDoc] = await Promise.all([
          db.collection('posts').doc(postId).get(),
          db.collection('posts').doc(postId).collection('comments').doc(commentId).get(),
        ]);
        if (!postDoc.exists || !commentDoc.exists) {
          return res.status(404).json({ error: 'Post or comment record not found.' });
        }
        const postData = postDoc.data();
        const commentData = commentDoc.data();
        if (postData.authorUid !== recipientUid) {
          return res.status(403).json({ error: 'Recipient is not the author of this post.' });
        }
        if (commentData.authorUid !== callerUid) {
          return res.status(403).json({ error: 'Caller is not the author of this comment.' });
        }
        if (!isTimestampRecent(commentData.createdAt, 180)) {
          return res.status(400).json({ error: 'Comment is too old.' });
        }

        replayKey = `comm:${postId}:${commentId}`;
        if (await checkAndRecordReplay(replayKey, callerUid, recipientUid, kind)) {
          return res.json({ sentCount: 0, status: 'duplicate_skipped' });
        }

        verifiedTitle = 'New Comment';
        const commentSnippet = (commentData.text || '').trim().slice(0, 100);
        verifiedBody = `${callerName} commented: "${commentSnippet}"`;
        verifiedData = { kind: 'social', subkind: 'comment', postId, userId: callerUid };
      }

      // Subkind 4: Post Like
      else if (subkind === 'like') {
        if (!isValidDocId(postId)) {
          return res.status(400).json({ error: 'Valid postId is required for like notifications.' });
        }
        const [postDoc, likeDoc] = await Promise.all([
          db.collection('posts').doc(postId).get(),
          db.collection('posts').doc(postId).collection('likes').doc(callerUid).get(),
        ]);
        if (!postDoc.exists || !likeDoc.exists) {
          return res.status(404).json({ error: 'Post or like record not found.' });
        }
        const postData = postDoc.data();
        if (postData.authorUid !== recipientUid) {
          return res.status(403).json({ error: 'Recipient is not the author of this post.' });
        }
        const likeData = likeDoc.data();
        if (!isTimestampRecent(likeData.createdAt, 180)) {
          return res.status(400).json({ error: 'Like event is too old.' });
        }

        replayKey = `like:${postId}:${callerUid}`;
        if (await checkAndRecordReplay(replayKey, callerUid, recipientUid, kind)) {
          return res.json({ sentCount: 0, status: 'duplicate_skipped' });
        }

        verifiedTitle = 'Post Like';
        verifiedBody = `${callerName} liked your post.`;
        verifiedData = { kind: 'social', subkind: 'like', postId, userId: callerUid };
      } else {
        return res.status(400).json({ error: `Unsupported social subkind: ${subkind}` });
      }

      categoryKey = 'social';
      channelId = 'social';
    }

    // =========================================================================
    // 5. Fetch Recipient Push Tokens & Respect Category Preferences
    // =========================================================================
    const tokensSnapshot = await db.collection('users').doc(recipientUid).collection('pushTokens').get();
    if (tokensSnapshot.empty) {
      return res.json({ sentCount: 0, message: 'Recipient has no registered push devices.' });
    }

    const validDeviceDocs = [];
    tokensSnapshot.forEach((docSnapshot) => {
      const docData = docSnapshot.data();
      const token = docData.token;
      const preferences = docData.preferences;

      if (!token || typeof token !== 'string') return;

      // Filter against device-level category preferences (messages, calls, social)
      if (preferences && typeof preferences === 'object') {
        if (preferences[categoryKey] === false) {
          return; // User muted this category on this device
        }
      }
      validDeviceDocs.push({ id: docSnapshot.id, token, docRef: docSnapshot.ref });
    });

    if (validDeviceDocs.length === 0) {
      return res.json({ sentCount: 0, message: 'All recipient devices have this notification category disabled.' });
    }

    const tokens = validDeviceDocs.map((d) => d.token);

    // =========================================================================
    // 6. Build Multicast FCM Payload with Verified Content
    // =========================================================================
    // Ensure all data attributes are string key-value pairs (FCM protocol requirement)
    const sanitizedData = {};
    for (const [k, v] of Object.entries(verifiedData)) {
      sanitizedData[k] = String(v ?? '');
    }

    const multicastMessage = {
      tokens,
      notification: {
        title: verifiedTitle,
        body: verifiedBody,
      },
      data: sanitizedData,
      android: {
        priority: isHighPriority ? 'high' : 'normal',
        notification: {
          channelId,
          color: '#208AEF',
          sound: isHighPriority ? 'default' : 'default',
        },
      },
    };

    // =========================================================================
    // 7. Dispatch via Firebase Cloud Messaging v1
    // =========================================================================
    const fcmResponse = await messaging.sendEachForMulticast(multicastMessage);

    // =========================================================================
    // 8. Auto-Purge Unregistered or Dead Tokens
    // =========================================================================
    const deadTokenCleanups = [];
    fcmResponse.responses.forEach((resp, idx) => {
      if (!resp.success && resp.error) {
        const errCode = resp.error.code;
        if (
          errCode === 'messaging/registration-token-not-registered' ||
          errCode === 'messaging/invalid-registration-token'
        ) {
          console.log(`[FCM] Purging dead device token: ${validDeviceDocs[idx].id}`);
          deadTokenCleanups.push(validDeviceDocs[idx].docRef.delete().catch(() => undefined));
        }
      }
    });

    await Promise.all(deadTokenCleanups);

    return res.json({
      success: true,
      sentCount: fcmResponse.successCount,
      failedCount: fcmResponse.failureCount,
    });
  } catch (error) {
    if (replayKey) {
      await clearReplay(replayKey).catch(() => undefined);
    }
    console.error('[Rocket Notification Backend Error]', error);
    return res.status(500).json({ error: 'Internal notification error.' });
  }
});

const PORT = process.env.PORT || 8080;
if (require.main === module && process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Rocket Hardened Notification Backend listening on port ${PORT}`);
  });
}

module.exports = app;
module.exports.checkRateLimit = checkRateLimit;
module.exports.checkAndRecordReplay = checkAndRecordReplay;
module.exports.clearReplay = clearReplay;
module.exports.hashReplayKey = hashReplayKey;
module.exports.isValidDocId = isValidDocId;
module.exports.isTimestampRecent = isTimestampRecent;
module.exports.getUserDisplayName = getUserDisplayName;
module.exports.isBlocked = isBlocked;
module.exports.authenticateUser = authenticateUser;
module.exports.parseServiceAccountString = parseServiceAccountString;
module.exports.getFirebaseInitStatus = () => ({ ...firebaseInitStatus });
