import { auth, db } from '@/lib/firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Platform } from 'react-native';

const SETTINGS_KEY = 'rocket.notifications.settings.v1';
const TOKEN_KEY_PREFIX = 'rocket.notifications.device-token.v1.';
const INSTALLATION_ID_KEY = 'rocket.notifications.installation-id.v1';

export type NotificationPreferences = {
  enabled: boolean;
  messages: boolean;
  calls: boolean;
  social: boolean;
};

export type StoredDevicePushToken = {
  type: string;
  data: string;
};

const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: false,
  messages: true,
  calls: true,
  social: true,
};

let activePreferences = DEFAULT_PREFERENCES;

/**
 * Foreground notification presentation handler.
 * Evaluates the incoming notification's category against the user's stored preferences.
 * If notifications are globally disabled or the specific category is toggled off,
 * all visual banners, sounds, and list appearances are suppressed.
 */
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const preferences = await getNotificationPreferences().catch(() => activePreferences);
    const data = notification.request.content.data;
    const kind = data?.kind;

    const categoryEnabled =
      kind === 'call' || kind === 'video_call'
        ? preferences.calls
        : kind === 'social'
          ? preferences.social
          : preferences.messages;

    const show = preferences.enabled && categoryEnabled;
    return {
      shouldPlaySound: show,
      shouldSetBadge: false,
      shouldShowBanner: show,
      shouldShowList: show,
    };
  },
});

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const stored = await AsyncStorage.getItem(SETTINGS_KEY);
  if (!stored) {
    activePreferences = DEFAULT_PREFERENCES;
    return DEFAULT_PREFERENCES;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<NotificationPreferences>;
    const preferences: NotificationPreferences = {
      enabled: parsed.enabled === true,
      messages: parsed.messages !== false,
      calls: parsed.calls !== false,
      social: parsed.social !== false,
    };
    activePreferences = preferences;
    return preferences;
  } catch (error) {
    throw new Error(
      `Notification settings could not be read: ${error instanceof Error ? error.message : 'invalid stored data'}`,
    );
  }
}

export async function saveNotificationPreferences(
  preferences: NotificationPreferences,
): Promise<void> {
  activePreferences = preferences;
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(preferences));
}

async function configureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('messages', {
    name: 'Messages',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#208AEF',
  });
  await Notifications.setNotificationChannelAsync('calls', {
    name: 'Calls',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 400, 200, 400],
    lightColor: '#208AEF',
  });
  await Notifications.setNotificationChannelAsync('social', {
    name: 'Social activity',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: '#208AEF',
  });
}

export async function requestNotificationPermission(): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new Error('Push token registration is supported only on iOS and Android.');
  }

  await configureAndroidChannels();

  const currentPermission = await Notifications.getPermissionsAsync();
  const permission = currentPermission.granted
    ? currentPermission
    : await Notifications.requestPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Notification permission was not granted. Enable it in device settings to continue.');
  }
}

/**
 * Generates an RFC 4122 v4 UUID with crypto fallback.
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generates or retrieves a persistent, random installation UUID for this app
 * installation. Persisted in SecureStore with AsyncStorage fallback.
 *
 * This UUID is unique per physical installation (not based on device model or
 * OS build), preventing collision between identical hardware models and
 * cleanly distinguishing multiple devices owned by the same user account.
 */
export async function getOrCreateInstallationId(): Promise<string> {
  // 1. Try reading from SecureStore
  try {
    const secureId = await SecureStore.getItemAsync(INSTALLATION_ID_KEY);
    if (secureId && /^[A-Za-z0-9_-]{1,160}$/.test(secureId)) {
      return secureId;
    }
  } catch {
    // SecureStore might be unavailable on web or throw unexpectedly
  }

  // 2. Try reading from AsyncStorage as fallback
  try {
    const asyncId = await AsyncStorage.getItem(INSTALLATION_ID_KEY);
    if (asyncId && /^[A-Za-z0-9_-]{1,160}$/.test(asyncId)) {
      try {
        await SecureStore.setItemAsync(INSTALLATION_ID_KEY, asyncId);
      } catch {}
      return asyncId;
    }
  } catch {}

  // 3. Generate a new random installation UUID
  const newInstallationId = generateUUID();

  // 4. Persist securely across sessions and token refreshes
  try {
    await SecureStore.setItemAsync(INSTALLATION_ID_KEY, newInstallationId);
  } catch {}
  try {
    await AsyncStorage.setItem(INSTALLATION_ID_KEY, newInstallationId);
  } catch {}

  return newInstallationId;
}

export async function registerDevicePushToken(uid: string): Promise<StoredDevicePushToken> {
  if (!uid) throw new Error('Sign in before registering a device push token.');
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Notification permission is required before registering a device push token.');
  }
  await configureAndroidChannels();
  const token = await Notifications.getDevicePushTokenAsync();
  const registration: StoredDevicePushToken = {
    type: token.type,
    data: String(token.data),
  };
  await storeDevicePushToken(uid, registration);
  return registration;
}

export async function requestAndRegisterDevicePushToken(
  uid: string,
): Promise<StoredDevicePushToken> {
  await requestNotificationPermission();
  return registerDevicePushToken(uid);
}

/**
 * Stores the FCM push token in Firestore under `users/{uid}/pushTokens/{installationId}`.
 * Using the stable installation UUID allows a user to register multiple active devices
 * without overwriting other devices' tokens.
 */
export async function storeDevicePushToken(
  uid: string,
  token: StoredDevicePushToken,
): Promise<void> {
  if (!uid || !token.data) {
    throw new Error('A signed-in user and a valid device push token are required.');
  }

  // Keep a local copy of the token
  await AsyncStorage.setItem(
    `${TOKEN_KEY_PREFIX}${uid}`,
    JSON.stringify(token),
  );

  const installationId = await getOrCreateInstallationId();
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const preferences = await getNotificationPreferences().catch(() => activePreferences);

  // Save the token to Firestore under the user's pushTokens subcollection
  await setDoc(
    doc(db, 'users', uid, 'pushTokens', installationId),
    {
      token: token.data,
      platform,
      updatedAt: serverTimestamp(),
      preferences: {
        messages: preferences.messages,
        calls: preferences.calls,
        social: preferences.social,
      },
    },
  );
}

/**
 * Syncs updated category preferences to Firestore for this installation's token.
 */
export async function syncPushTokenPreferences(
  uid: string,
  preferences: NotificationPreferences,
): Promise<void> {
  if (!uid) return;
  try {
    const installationId = await getOrCreateInstallationId();
    await updateDoc(doc(db, 'users', uid, 'pushTokens', installationId), {
      'preferences.messages': preferences.messages,
      'preferences.calls': preferences.calls,
      'preferences.social': preferences.social,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    // If the document does not exist yet (e.g. notifications disabled), ignore
  }
}

/**
 * Deletes ONLY the current installation's push-token document from Firestore.
 * Other devices registered under the user account remain untouched.
 *
 * Implements a 4-second timeout and robust error catching so network failures
 * or offline mode will not block or hang sign-out.
 */
export async function deleteDevicePushToken(uid: string): Promise<void> {
  if (!uid) return;
  try {
    const installationId = await getOrCreateInstallationId();
    await Promise.race([
      deleteDoc(doc(db, 'users', uid, 'pushTokens', installationId)),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Push token deletion timed out')), 4000)
      ),
    ]);
  } catch (error) {
    console.warn('[Rocket notifications] could not remove Firestore push token', error);
  }
}

export async function clearLocalDevicePushToken(uid: string): Promise<void> {
  if (!uid) return;
  await AsyncStorage.removeItem(`${TOKEN_KEY_PREFIX}${uid}`);
}

function validDocumentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
}

export function getNotificationRoute(data: Record<string, unknown>): string | null {
  switch (data.kind) {
    case 'message':
      return validDocumentId(data.conversationId)
        ? `/chat/${data.conversationId}`
        : null;
    case 'group_message':
      return validDocumentId(data.groupId) ? `/group/${data.groupId}` : null;
    case 'call':
      return validDocumentId(data.callId) ? `/call/${data.callId}` : null;
    case 'video_call':
      return validDocumentId(data.callId) ? `/video-call/${data.callId}` : null;
    case 'social':
      if (validDocumentId(data.postId)) return `/post/${data.postId}/comments`;
      const targetUserId = data.userId ?? data.uid;
      return validDocumentId(targetUserId) ? `/user/${targetUserId}` : null;
    default:
      return null;
  }
}

export type PushNotificationPayload = {
  recipientUid: string;
  kind: 'message' | 'group_message' | 'call' | 'video_call' | 'social';
  title?: string;
  body?: string;
  data: Record<string, string>;
};

/**
 * Dispatches an FCM push notification request to the external backend service.
 * The backend authenticates the caller via Firebase Auth ID token and sends
 * the message via FCM HTTP v1 without exposing service account credentials to client code.
 *
 * If EXPO_PUBLIC_NOTIFICATION_BACKEND_URL is not set, this cleanly no-ops.
 */
export async function dispatchPushNotification(payload: PushNotificationPayload): Promise<void> {
  const backendUrl = process.env.EXPO_PUBLIC_NOTIFICATION_BACKEND_URL;
  if (!backendUrl) return;

  const currentUser = auth.currentUser;
  if (!currentUser) return;

  try {
    const idToken = await currentUser.getIdToken();
    await fetch(`${backendUrl.replace(/\/$/, '')}/api/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.warn('[Rocket notifications] could not dispatch push notification to backend', error);
  }
}
