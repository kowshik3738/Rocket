# Rocket Notification Backend (Vercel Serverless & Firebase Spark Compatible)

This backend enables **reliable Firebase Cloud Messaging (FCM) v1 push notifications** for Rocket without requiring a paid Firebase plan (Blaze) or paid third-party services.

---

## Architecture & Serverless Design

The backend is configured as a **Vercel Node.js Serverless Function**:
- **Entry point**: `api/index.js` wraps the hardened Express application.
- **Routing**: `vercel.json` rewrites all requests to the serverless function.
- **Persistent Concurrency & Rate Limiting**: Unlike naive in-memory caches which fail across multi-instance serverless environments, this backend uses **atomic Cloud Firestore transactions**:
  - **Distributed Replay Protection**: Stores SHA-256 event keys in `notificationReplays/{hash}` with a 5-minute TTL. Concurrent requests for the same event across different serverless instances are atomically detected and blocked.
  - **Distributed Rate Limiting**: Tracks per-user windows (30 reqs/min) in `notificationRateLimits/{callerUid}` with atomic increments.
  - **Spark Tier Free Quotas**: Consumes standard Firestore free tier reads/writes (50k reads/day, 20k writes/day free forever on Spark).

---

## Vercel Deployment Settings (Step-by-Step)

### Step 1: Connect Git Repository to Vercel
1. Log into your [Vercel Dashboard](https://vercel.com).
2. Click **Add New...** → **Project**.
3. Select and import your Rocket repository.

### Step 2: Configure Project Settings
In the Vercel Project Import screen, configure:

| Setting | Value | Rationale |
| :--- | :--- | :--- |
| **Project Name** | `rocket-notifications` (or your choice) | Identifies your Vercel project |
| **Framework Preset** | **Other** | Standard Node.js Express serverless function |
| **Root Directory** | `backend` | **Important:** Isolates backend dependencies from the Expo app |
| **Build Command** | Leave empty (default) | No build step required for plain Node.js |
| **Output Directory** | Leave empty (default) | Not applicable |
| **Install Command** | `npm install` (default) | Installs `cors`, `dotenv`, `express`, `firebase-admin` |
| **Node.js Version** | **20.x** or **22.x** | Configured in Project Settings → General |

---

### Step 3: Configure Environment Variables

In Vercel **Project Settings → Environment Variables**, add:

#### Option A: Full Service Account JSON (Recommended)
Paste the exact JSON from Firebase Console (*Project Settings → Service Accounts → Generate new private key*):
- **Name**: `FIREBASE_SERVICE_ACCOUNT`
- **Value**: `{"type":"service_account","project_id":"rocket-87c6a",...}`

#### Option B: Individual Service Account Fields
- `FIREBASE_PROJECT_ID`: `rocket-87c6a`
- `FIREBASE_CLIENT_EMAIL`: `firebase-adminsdk-xxxxx@rocket-87c6a.iam.gserviceaccount.com`
- `FIREBASE_PRIVATE_KEY`: `"<private_key from your Firebase service account JSON>"`

*(Optional)* `NODE_ENV`: `production`

---

### Step 4: Deploy and Configure Mobile App

1. Click **Deploy**. Vercel will build and assign an HTTPS URL:
   `https://rocket-notifications.vercel.app` (or similar).
2. Verify the health check:
   ```bash
   curl https://<YOUR_VERCEL_DOMAIN>/health
   # Expected response:
   # {"status":"ok","service":"rocket-notification-backend","environment":"vercel-serverless",...}
   ```
3. In Rocket's root `.env`:
   ```env
   EXPO_PUBLIC_NOTIFICATION_BACKEND_URL=https://<YOUR_VERCEL_DOMAIN>
   ```

---

## Security Model & Protections

1. **Zero Client Secrets**:
   The Firebase Service Account credentials reside strictly as environment variables on Vercel. They are never exposed to the client app or Git.
2. **Authenticated Requests**:
   The Rocket app calls `POST /api/notify` with `Authorization: Bearer <idToken>`. The backend verifies the token and requires `email_verified: true`.
3. **Relationship Authorization**:
   - Private messages: Caller and recipient must match `participantA` & `participantB` in `conversations/{id}`.
   - Group messages: Caller and recipient must both be in `memberIds` of `groups/{id}`.
   - Voice/Video calls: Caller must be `callerId`, recipient must be `calleeId`, phase must be `'ringing'`, age < 90s.
   - Social: Verified against actual `friendRequests`, `comments`, or `likes` records.
4. **Preference Enforcement**:
   Checks recipient registered device tokens and filters against `preferences.messages`, `preferences.calls`, and `preferences.social`.
5. **Dead Token Cleanup**:
   Automatically purges dead tokens from Firestore (`messaging/registration-token-not-registered`).

---

## Running Automated Tests

Run the test suite locally with Node.js built-in test runner:
```bash
# Security & Relationship verification tests
node --test backend/test-security.js

# Serverless compatibility, auth, and replay protection tests
node --test backend/test-serverless.js

# Or run both from backend directory:
npm test
```
