import React, {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as ScreenCapture from 'expo-screen-capture';
import { AppState, AppStateStatus, Platform, StyleSheet, View } from 'react-native';

import {
  RocketBrand,
  RocketButton,
  RocketLoadingIndicator,
  RocketScreen,
  RocketText,
  useRocketTheme,
} from '@/design-system';
import { useAuth } from '@/providers/auth-provider';
import {
  AppLockAuthenticationError,
  AppLockSettings,
  AppLockTimeout,
  authenticateForAppLock,
  readAppLockSettings,
  writeAppLockSettings,
} from '@/services/app-lock-service';
import { SpacingScale } from '@/design-system/tokens/spacing';

type AppLockContextValue = {
  settings: AppLockSettings;
  locked: boolean;
  loadingSettings: boolean;
  authenticating: boolean;
  settingsError: string | null;
  authenticationError: string | null;
  enableAppLock: (timeout: AppLockTimeout) => Promise<boolean>;
  disableAppLock: () => Promise<boolean>;
  setLockTimeout: (timeout: AppLockTimeout) => Promise<void>;
  unlock: () => Promise<void>;
  retrySettings: () => Promise<void>;
};

const DEFAULT_SETTINGS: AppLockSettings = {
  enabled: false,
  timeout: 'immediate',
};

const AppLockContext = createContext<AppLockContextValue | undefined>(undefined);
const APP_LOCK_SCREEN_CAPTURE_KEY = 'rocket-app-lock';

function timeoutMilliseconds(timeout: AppLockTimeout): number {
  if (timeout === '1-minute') return 60_000;
  if (timeout === '5-minutes') return 5 * 60_000;
  return 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'App Lock could not be updated. Try again.';
}

async function enableNativeAppSwitcherProtection(): Promise<void> {
  if (Platform.OS === 'ios') {
    await ScreenCapture.enableAppSwitcherProtectionAsync();
    return;
  }
  if (Platform.OS === 'android') {
    await ScreenCapture.preventScreenCaptureAsync(APP_LOCK_SCREEN_CAPTURE_KEY);
    return;
  }
  throw new Error('Native app-switcher protection is not available on this platform.');
}

async function disableNativeAppSwitcherProtection(): Promise<void> {
  if (Platform.OS === 'ios') {
    await ScreenCapture.disableAppSwitcherProtectionAsync();
    return;
  }
  if (Platform.OS === 'android') {
    await ScreenCapture.allowScreenCaptureAsync(APP_LOCK_SCREEN_CAPTURE_KEY);
  }
}

export function AppLockProvider({ children }: PropsWithChildren) {
  const { loading: authLoading, user } = useAuth();
  const [settings, setSettings] = useState<AppLockSettings>(DEFAULT_SETTINGS);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [locked, setLocked] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [authenticationError, setAuthenticationError] = useState<string | null>(null);
  const [privacyProtectionReady, setPrivacyProtectionReady] = useState(false);
  const [appInactive, setAppInactive] = useState(false);
  const settingsRef = useRef(settings);
  const authenticationInProgress = useRef(false);
  const settingsOperationInProgress = useRef(false);
  const backgroundedAt = useRef<number | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const hasInitialIdentity = useRef(false);
  const previousUid = useRef<string | null>(null);
  const appStateTransitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitSettings = useCallback((nextSettings: AppLockSettings) => {
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
  }, []);

  const retrySettings = useCallback(async () => {
    setLoadingSettings(true);
    setSettingsError(null);
    setPrivacyProtectionReady(false);
    try {
      const storedSettings = await readAppLockSettings();
      if (storedSettings.enabled) {
        await enableNativeAppSwitcherProtection();
      } else {
        await disableNativeAppSwitcherProtection();
      }
      commitSettings(storedSettings);
      setLocked(storedSettings.enabled);
      setAuthenticationError(null);
      setPrivacyProtectionReady(true);
    } catch (error) {
      setSettingsError(
        error instanceof Error
          ? `App Lock privacy protection could not be verified. Rocket remains locked. ${error.message}`
          : 'App Lock privacy protection could not be verified. Rocket remains locked.',
      );
      setLocked(true);
    } finally {
      setLoadingSettings(false);
    }
  }, [commitSettings]);

  useEffect(() => {
    void retrySettings();
  }, [retrySettings]);

  useEffect(() => {
    if (authLoading) return;
    const currentUid = user?.uid ?? null;
    if (!hasInitialIdentity.current) {
      hasInitialIdentity.current = true;
      previousUid.current = currentUid;
      return;
    }
    if (previousUid.current !== currentUid && settingsRef.current.enabled) {
      setLocked(true);
      setAuthenticationError(null);
    }
    previousUid.current = currentUid;
  }, [authLoading, user?.uid]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appState.current;
      appState.current = nextState;

      if (appStateTransitionTimer.current) {
        clearTimeout(appStateTransitionTimer.current);
        appStateTransitionTimer.current = null;
      }

      if (nextState !== 'active') {
        if (previousState === 'active' && backgroundedAt.current === null) {
          backgroundedAt.current = Date.now();
        }

        if (settingsRef.current.enabled) {
          appStateTransitionTimer.current = setTimeout(() => {
            if (AppState.currentState !== 'active' && settingsRef.current.enabled) {
              setAppInactive(true);
              if (!authenticationInProgress.current && settingsRef.current.timeout === 'immediate') {
                setLocked(true);
                setAuthenticationError(null);
              }
            }
          }, 1200);
        }
        return;
      }

      const backgrounded = backgroundedAt.current;
      backgroundedAt.current = null;
      if (settingsRef.current.enabled && !authenticationInProgress.current && backgrounded !== null) {
        const elapsed = Date.now() - backgrounded;
        if (elapsed >= timeoutMilliseconds(settingsRef.current.timeout)) {
          setLocked(true);
          setAuthenticationError(null);
        }
      }
      setAppInactive(false);
    });

    return () => {
      if (appStateTransitionTimer.current) {
        clearTimeout(appStateTransitionTimer.current);
      }
      subscription.remove();
    };
  }, []);

  const runAuthentication = useCallback(async (prompt: string): Promise<boolean> => {
    if (authenticationInProgress.current) return false;
    authenticationInProgress.current = true;
    setAuthenticating(true);
    setAuthenticationError(null);
    try {
      const result = await authenticateForAppLock(prompt);
      if (!result.success) {
        setAuthenticationError('Authentication was canceled. Try again when you are ready.');
        return false;
      }
      return result.success;
    } catch (error) {
      if (error instanceof AppLockAuthenticationError) {
        setAuthenticationError(error.message);
      } else {
        setAuthenticationError('Device authentication could not be completed. Try again.');
      }
      return false;
    } finally {
      authenticationInProgress.current = false;
      setAuthenticating(false);
    }
  }, []);

  const enableAppLock = useCallback(async (timeout: AppLockTimeout) => {
    if (settingsOperationInProgress.current || loadingSettings || settingsError) return false;
    settingsOperationInProgress.current = true;
    setAuthenticationError(null);
    try {
      const authenticated = await runAuthentication('Authenticate to enable Rocket App Lock');
      if (!authenticated) return false;
      await enableNativeAppSwitcherProtection();
      const nextSettings = { enabled: true, timeout };
      await writeAppLockSettings(nextSettings);
      commitSettings(nextSettings);
      setPrivacyProtectionReady(true);
      return true;
    } catch (error) {
      let message = errorMessage(error);
      try {
        if (!settingsRef.current.enabled) {
          await disableNativeAppSwitcherProtection();
        }
      } catch (cleanupError) {
        setPrivacyProtectionReady(false);
        setSettingsError(
          'Native app-switcher privacy protection could not be reset. Rocket remains locked.',
        );
        message = `${message} ${errorMessage(cleanupError)}`;
      }
      setAuthenticationError(message);
      return false;
    } finally {
      settingsOperationInProgress.current = false;
    }
  }, [commitSettings, loadingSettings, runAuthentication, settingsError]);

  const disableAppLock = useCallback(async () => {
    if (settingsOperationInProgress.current || loadingSettings || settingsError) return false;
    settingsOperationInProgress.current = true;
    setAuthenticationError(null);
    try {
      const authenticated = await runAuthentication('Authenticate to disable Rocket App Lock');
      if (!authenticated) return false;
      const nextSettings = { ...settingsRef.current, enabled: false };
      await writeAppLockSettings(nextSettings);
      commitSettings(nextSettings);
      setLocked(true);
      await disableNativeAppSwitcherProtection();
      setPrivacyProtectionReady(true);
      setLocked(false);
      return true;
    } catch (error) {
      setPrivacyProtectionReady(false);
      setLocked(true);
      setSettingsError(
        'Native app-switcher privacy protection could not be verified. Rocket remains locked.',
      );
      setAuthenticationError(errorMessage(error));
      return false;
    } finally {
      settingsOperationInProgress.current = false;
    }
  }, [commitSettings, loadingSettings, runAuthentication, settingsError]);

  const setLockTimeout = useCallback(async (timeout: AppLockTimeout) => {
    if (settingsOperationInProgress.current || loadingSettings || settingsError) {
      throw new Error('App Lock settings are not ready.');
    }
    settingsOperationInProgress.current = true;
    setAuthenticationError(null);
    try {
      const nextSettings = { ...settingsRef.current, timeout };
      await writeAppLockSettings(nextSettings);
      commitSettings(nextSettings);
    } finally {
      settingsOperationInProgress.current = false;
    }
  }, [commitSettings, loadingSettings, settingsError]);

  const unlock = useCallback(async () => {
    if (!locked || loadingSettings || settingsError) return;
    const authenticated = await runAuthentication('Authenticate to unlock Rocket');
    if (authenticated) {
      setAuthenticationError(null);
      setLocked(false);
    }
  }, [loadingSettings, locked, runAuthentication, settingsError]);

  const value = useMemo<AppLockContextValue>(() => ({
    settings,
    locked,
    loadingSettings,
    authenticating,
    settingsError,
    authenticationError,
    enableAppLock,
    disableAppLock,
    setLockTimeout,
    unlock,
    retrySettings,
  }), [
    settings,
    locked,
    loadingSettings,
    authenticating,
    settingsError,
    authenticationError,
    enableAppLock,
    disableAppLock,
    setLockTimeout,
    unlock,
    retrySettings,
  ]);

  if (
    authLoading ||
    loadingSettings ||
    settingsError ||
    (settings.enabled && !privacyProtectionReady) ||
    (locked && user !== null)
  ) {
    return (
      <AppLockContext.Provider value={value}>
        <AppLockScreen
          busy={loadingSettings || authenticating}
          error={settingsError ?? authenticationError}
          locked={locked}
          onRetry={() => void retrySettings()}
          onUnlock={() => void unlock()}
          settingsError={settingsError !== null}
        />
      </AppLockContext.Provider>
    );
  }

  return (
    <AppLockContext.Provider value={value}>
      <View style={styles.appContainer}>
        {children}
        {appInactive && settings.enabled ? <PrivacyShield /> : null}
      </View>
    </AppLockContext.Provider>
  );
}

function AppLockScreen({
  busy,
  error,
  locked,
  onRetry,
  onUnlock,
  settingsError,
}: {
  busy: boolean;
  error: string | null;
  locked: boolean;
  onRetry: () => void;
  onUnlock: () => void;
  settingsError: boolean;
}) {
  const { colors } = useRocketTheme();
  return (
    <RocketScreen
      contentContainerStyle={styles.lockScreen}
      edges={['top', 'bottom']}
      scroll={false}>
      <RocketBrand showSpark />
      <View style={[styles.lockIcon, { backgroundColor: colors.surfaceSecondary }]}>
        <RocketText color="accent" style={styles.lockGlyph}>◆</RocketText>
      </View>
      <RocketText style={styles.lockTitle} variant="screenTitle">
        {settingsError ? 'Rocket is locked' : locked ? 'App Locked' : 'Starting Rocket'}
      </RocketText>
      <RocketText color="secondary" style={styles.lockDescription} variant="bodySecondary">
        {settingsError
          ? 'Your secure lock settings could not be verified. Private content is unavailable.'
          : locked
            ? 'Authenticate with your device to continue.'
            : 'Checking secure app settings…'}
      </RocketText>
      {busy && !settingsError ? (
        <RocketLoadingIndicator accessibilityLabel="Checking App Lock" size="normal" />
      ) : null}
      {error ? (
        <RocketText accessibilityRole="alert" color="error" style={styles.lockError} variant="bodySecondary">
          {error}
        </RocketText>
      ) : null}
      {settingsError ? (
        <RocketButton
          label="Retry secure settings"
          onPress={onRetry}
          size="lg"
          style={styles.lockAction}
          variant="secondary"
        />
      ) : locked ? (
        <RocketButton
          accessibilityHint="Authenticate with your device to open Rocket"
          label={busy ? 'Authenticating…' : 'Unlock Rocket'}
          loading={busy}
          onPress={onUnlock}
          size="lg"
          style={styles.lockAction}
          variant="primary"
        />
      ) : null}
    </RocketScreen>
  );
}

function PrivacyShield() {
  const { colors } = useRocketTheme();
  return (
    <View
      accessibilityLabel="Rocket content hidden while app is in the background"
      accessibilityRole="alert"
      style={[styles.privacyShield, { backgroundColor: colors.background }]}>
      <RocketBrand showSpark />
      <RocketText style={styles.shieldTitle} variant="sectionTitle">Rocket is hidden</RocketText>
    </View>
  );
}

export function useAppLock(): AppLockContextValue {
  const context = useContext(AppLockContext);
  if (!context) {
    throw new Error('useAppLock must be used inside AppLockProvider');
  }
  return context;
}

const styles = StyleSheet.create({
  appContainer: { flex: 1 },
  lockScreen: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: SpacingScale.xl,
    gap: SpacingScale.lg,
  },
  lockIcon: {
    alignItems: 'center',
    borderRadius: 36,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  lockGlyph: { fontSize: 30, fontWeight: '800' },
  lockTitle: { textAlign: 'center' },
  lockDescription: { maxWidth: 320, textAlign: 'center' },
  lockError: { maxWidth: 340, textAlign: 'center' },
  lockAction: { marginTop: SpacingScale.sm, maxWidth: 320, width: '100%' },
  privacyShield: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    gap: SpacingScale.xl,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 1000,
  },
  shieldTitle: { textAlign: 'center' },
});
