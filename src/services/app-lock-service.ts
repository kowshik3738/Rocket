import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type AppLockTimeout = 'immediate' | '1-minute' | '5-minutes';

export type AppLockSettings = {
  enabled: boolean;
  timeout: AppLockTimeout;
};

export type AppLockAuthenticationResult =
  | { success: true }
  | { success: false; cancelled: true };

const SETTINGS_KEY = 'rocket.app-lock.settings.v1';
const DEFAULT_SETTINGS: AppLockSettings = {
  enabled: false,
  timeout: 'immediate',
};
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED,
};

export class AppLockAuthenticationError extends Error {
  readonly kind: 'unavailable' | 'failed';

  constructor(kind: 'unavailable' | 'failed', message: string) {
    super(message);
    this.name = 'AppLockAuthenticationError';
    this.kind = kind;
  }
}

function isTimeout(value: unknown): value is AppLockTimeout {
  return value === 'immediate' || value === '1-minute' || value === '5-minutes';
}

function parseSettings(serialized: string): AppLockSettings {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error('App Lock settings are invalid. Rocket remains locked.');
  }

  if (
    typeof value !== 'object' ||
    value === null ||
    !('enabled' in value) ||
    typeof value.enabled !== 'boolean' ||
    !('timeout' in value) ||
    !isTimeout(value.timeout)
  ) {
    throw new Error('App Lock settings are invalid. Rocket remains locked.');
  }

  return { enabled: value.enabled, timeout: value.timeout };
}

export async function readAppLockSettings(): Promise<AppLockSettings> {
  const stored = await SecureStore.getItemAsync(SETTINGS_KEY, SECURE_STORE_OPTIONS);
  return stored === null ? { ...DEFAULT_SETTINGS } : parseSettings(stored);
}

export async function writeAppLockSettings(settings: AppLockSettings): Promise<void> {
  await SecureStore.setItemAsync(
    SETTINGS_KEY,
    JSON.stringify(settings),
    SECURE_STORE_OPTIONS,
  );
}

export async function authenticateForAppLock(
  promptMessage: string,
): Promise<AppLockAuthenticationResult> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new AppLockAuthenticationError(
      'unavailable',
      'App Lock authentication is available only on iOS and Android.',
    );
  }

  let hasHardware: boolean;
  let isEnrolled: boolean;
  try {
    [hasHardware, isEnrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
  } catch {
    throw new AppLockAuthenticationError(
      'unavailable',
      'Rocket could not check device authentication availability.',
    );
  }

  if (!hasHardware) {
    throw new AppLockAuthenticationError(
      'unavailable',
      'This device does not have supported biometric hardware.',
    );
  }
  if (!isEnrolled) {
    throw new AppLockAuthenticationError(
      'unavailable',
      'Set up a fingerprint or face unlock in your device settings before enabling App Lock.',
    );
  }

  let result: LocalAuthentication.LocalAuthenticationResult;
  try {
    result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Cancel',
      ...(Platform.OS === 'ios' ? { fallbackLabel: 'Use Passcode' } : {}),
      ...(Platform.OS === 'android' ? { biometricsSecurityLevel: 'strong' as const } : {}),
    });
  } catch {
    throw new AppLockAuthenticationError(
      'failed',
      'Device authentication could not be completed. Try again.',
    );
  }

  if (result.success) {
    return { success: true };
  }

  if (
    result.error === 'user_cancel' ||
    result.error === 'app_cancel' ||
    result.error === 'system_cancel' ||
    result.error === 'user_fallback'
  ) {
    return { success: false, cancelled: true };
  }

  if (result.error === 'not_enrolled' || result.error === 'not_available') {
    throw new AppLockAuthenticationError(
      'unavailable',
      'Device biometric authentication is not currently available.',
    );
  }

  throw new AppLockAuthenticationError(
    'failed',
    result.error === 'lockout'
      ? 'Device authentication is temporarily locked. Try again later.'
      : 'Authentication was not successful. Try again.',
  );
}
