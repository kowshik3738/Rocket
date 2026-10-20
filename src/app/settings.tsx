import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { useAuth } from '@/providers/auth-provider';
import { useAppLock } from '@/providers/app-lock-provider';
import { AppLockTimeout } from '@/services/app-lock-service';
import {
  clearLocalDevicePushToken,
  deleteDevicePushToken,
  getNotificationPreferences,
  NotificationPreferences,
  registerDevicePushToken,
  requestNotificationPermission,
  saveNotificationPreferences,
  syncPushTokenPreferences,
} from '@/services/notification-service';
import {
  RocketButton,
  RocketCard,
  RocketIconButton,
  RocketPressable,
  RocketScreen,
  RocketText,
  useRocketTheme,
} from '@/design-system';
import { Radius } from '@/design-system/tokens/radius';
import { SpacingScale } from '@/design-system/tokens/spacing';

interface SettingsRowProps {
  title: string;
  detail: string;
  icon: string;
  onPress: () => void;
}

function SettingsRow({ title, detail, icon, onPress }: SettingsRowProps) {
  const { colors } = useRocketTheme();

  return (
    <RocketPressable
      accessibilityHint={`Open ${title}`}
      accessibilityLabel={`${title}, ${detail}`}
      accessibilityRole="button"
      onPress={onPress}
      pressScale={0.985}
      pressedStyle={{ backgroundColor: colors.surfaceSecondary }}
      style={styles.row}>
      <View style={styles.rowLeft}>
        <View
          style={[
            styles.iconContainer,
            { backgroundColor: colors.surfaceSecondary },
          ]}>
          <Text style={styles.rowIcon}>{icon}</Text>
        </View>
        <View style={styles.rowInfo}>
          <RocketText style={styles.rowTitle} variant="bodyMedium">
            {title}
          </RocketText>
          <RocketText color="secondary" variant="caption">
            {detail}
          </RocketText>
        </View>
      </View>
      <RocketText color="muted" style={styles.rowChevron}>
        ›
      </RocketText>
    </RocketPressable>
  );
}

export default function SettingsScreen() {
  const { signOut, user } = useAuth();
  const {
    settings: appLockSettings,
    loadingSettings: appLockLoading,
    authenticating: appLockAuthenticating,
    authenticationError: appLockError,
    enableAppLock,
    disableAppLock,
    setLockTimeout,
  } = useAppLock();
  const { colors } = useRocketTheme();
  const [error, setError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [appLockWorking, setAppLockWorking] = useState(false);
  const [appLockSettingsError, setAppLockSettingsError] = useState('');
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>({
    enabled: false,
    messages: true,
    calls: true,
    social: true,
  });
  const [notificationSettingsLoading, setNotificationSettingsLoading] = useState(true);
  const [notificationWorking, setNotificationWorking] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState('');

  useEffect(() => {
    let active = true;
    void getNotificationPreferences()
      .then((preferences) => {
        if (active) setNotificationPreferences(preferences);
      })
      .catch((settingsError) => {
        if (active) {
          setNotificationStatus(
            settingsError instanceof Error
              ? settingsError.message
              : 'Notification settings could not be loaded.',
          );
        }
      })
      .finally(() => {
        if (active) setNotificationSettingsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user?.uid]);

  async function handleNotificationsEnabled(enabled: boolean) {
    if (!user || notificationWorking || notificationSettingsLoading) return;
    setNotificationWorking(true);
    setNotificationStatus('');
    try {
      if (enabled) {
        await requestNotificationPermission();
        const next = { ...notificationPreferences, enabled: true };
        await saveNotificationPreferences(next);
        setNotificationPreferences(next);
        try {
          await registerDevicePushToken(user.uid);
          setNotificationStatus('Permission granted. The device token is saved locally on this device.');
        } catch (tokenError) {
          setNotificationStatus(
            `Local notifications are enabled, but this build could not register a native push token. ${tokenError instanceof Error ? tokenError.message : ''}`,
          );
        }
      } else {
        const next = { ...notificationPreferences, enabled: false };
        await saveNotificationPreferences(next);
        await deleteDevicePushToken(user.uid);
        await clearLocalDevicePushToken(user.uid);
        setNotificationPreferences(next);
        setNotificationStatus('Notifications are disabled on this device.');
      }
    } catch (notificationError) {
      setNotificationStatus(
        notificationError instanceof Error
          ? notificationError.message
          : 'Notification settings could not be updated.',
      );
    } finally {
      setNotificationWorking(false);
    }
  }

  async function handleNotificationCategoryChange(
    category: 'messages' | 'calls' | 'social',
    enabled: boolean,
  ) {
    if (notificationWorking || notificationSettingsLoading) return;
    const next = { ...notificationPreferences, [category]: enabled };
    setNotificationWorking(true);
    setNotificationStatus('');
    try {
      await saveNotificationPreferences(next);
      setNotificationPreferences(next);
      if (user && next.enabled) {
        await syncPushTokenPreferences(user.uid, next);
      }
    } catch (notificationError) {
      setNotificationStatus(
        notificationError instanceof Error
          ? notificationError.message
          : 'Notification settings could not be saved.',
      );
    } finally {
      setNotificationWorking(false);
    }
  }

  async function handleAppLockChange(enabled: boolean) {
    if (appLockWorking || appLockLoading || appLockAuthenticating) return;
    setAppLockSettingsError('');
    setAppLockWorking(true);
    try {
      const updated = enabled
        ? await enableAppLock(appLockSettings.timeout)
        : await disableAppLock();
      if (!updated) {
        setAppLockSettingsError(appLockError || 'Device authentication is required to change App Lock.');
      }
    } catch (lockError) {
      setAppLockSettingsError(
        lockError instanceof Error ? lockError.message : 'App Lock could not be updated.',
      );
    } finally {
      setAppLockWorking(false);
    }
  }

  async function handleLockTimeoutChange(timeout: AppLockTimeout) {
    if (appLockWorking || appLockLoading || timeout === appLockSettings.timeout) return;
    setAppLockSettingsError('');
    setAppLockWorking(true);
    try {
      await setLockTimeout(timeout);
    } catch (lockError) {
      setAppLockSettingsError(
        lockError instanceof Error ? lockError.message : 'The lock timeout could not be saved.',
      );
    } finally {
      setAppLockWorking(false);
    }
  }

  async function executeSignOut() {
    setError('');
    setSigningOut(true);
    try {
      await signOut();
      router.replace('/welcome');
    } catch (signOutError) {
      setError(
        signOutError instanceof Error
          ? signOutError.message
          : 'Unable to sign out. Please try again.'
      );
    } finally {
      setSigningOut(false);
    }
  }

  function confirmSignOut() {
    if (signingOut) return;
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out of your Rocket account on this device?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: () => void executeSignOut(),
        },
      ]
    );
  }

  return (
    <RocketScreen
      contentContainerStyle={styles.screenContent}
      edges={['top']}
      scroll={false}>
      {/* Top Header Bar */}
      <View style={styles.header}>
        <RocketIconButton
          accessibilityHint="Go back"
          accessibilityLabel="Back"
          glyph="‹"
          glyphStyle={styles.backGlyph}
          onPress={() => router.back()}
          size="md"
          variant="ghost"
        />
        <RocketText style={styles.headerTitle} variant="sectionTitle">
          Settings
        </RocketText>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <View style={styles.greetingHeader}>
          <RocketText style={styles.mainTitle} variant="screenTitle">
            Settings
          </RocketText>
          <RocketText color="secondary" variant="bodySecondary">
            Manage your account and preferences.
          </RocketText>
        </View>

        {/* APP LOCK SECTION */}
        <View style={styles.section}>
          <RocketText
            color="secondary"
            style={styles.sectionHeader}
            variant="captionBold">
            SECURITY
          </RocketText>
          <RocketCard padding="md" style={styles.appLockCard} variant="default">
            <View style={styles.appLockHeader}>
              <View style={styles.appLockCopy}>
                <RocketText style={styles.rowTitle} variant="bodyMedium">
                  App Lock
                </RocketText>
                <RocketText color="secondary" style={styles.appLockDescription} variant="caption">
                  {appLockSettings.enabled
                    ? 'Rocket requires device authentication when you return after the selected timeout.'
                    : 'Require device authentication before opening Rocket.'}
                </RocketText>
              </View>
              <Switch
                accessibilityLabel="App Lock"
                accessibilityRole="switch"
                accessibilityState={{
                  checked: appLockSettings.enabled,
                  disabled: appLockLoading || appLockWorking || appLockAuthenticating,
                }}
                disabled={appLockLoading || appLockWorking || appLockAuthenticating}
                onValueChange={(enabled) => void handleAppLockChange(enabled)}
                trackColor={{ false: colors.border, true: colors.primaryAccent }}
                value={appLockSettings.enabled}
                thumbColor={appLockSettings.enabled ? colors.primaryText : colors.mutedText}
              />
            </View>
            {appLockSettings.enabled ? (
              <View style={styles.timeoutOptions}>
                <RocketText color="secondary" variant="captionBold">
                  LOCK WHEN ROCKET RETURNS
                </RocketText>
                {([
                  ['immediate', 'Immediately'],
                  ['1-minute', 'After 1 minute'],
                  ['5-minutes', 'After 5 minutes'],
                ] as const).map(([timeout, label]) => {
                  const selected = appLockSettings.timeout === timeout;
                  return (
                    <RocketPressable
                      accessibilityLabel={`${label}${selected ? ', selected' : ''}`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected, disabled: appLockWorking }}
                      disabled={appLockWorking}
                      key={timeout}
                      onPress={() => void handleLockTimeoutChange(timeout)}
                      style={styles.timeoutOption}>
                      <RocketText color="primary" variant="bodySecondary">
                        {label}
                      </RocketText>
                      <View
                        style={[
                          styles.radioOuter,
                          { borderColor: selected ? colors.primaryAccent : colors.border },
                        ]}>
                        {selected ? (
                          <View style={[styles.radioInner, { backgroundColor: colors.primaryAccent }]} />
                        ) : null}
                      </View>
                    </RocketPressable>
                  );
                })}
              </View>
            ) : null}
            <RocketText color="muted" style={styles.appLockNote} variant="caption">
              {Platform.OS === 'ios'
                ? 'Uses enrolled Face ID or Touch ID. iOS may offer the device passcode after biometric failures.'
                : Platform.OS === 'android'
                  ? 'Uses enrolled strong biometrics. This API does not expose a separate Android device-PIN fallback.'
                  : 'Device authentication is supported only on iOS and Android.'}
              {' Rocket never accesses or stores biometric data or device credentials.'}
            </RocketText>
            {appLockSettingsError || appLockError ? (
              <RocketText
                accessibilityRole="alert"
                color="error"
                style={styles.appLockError}
                variant="caption">
                {appLockSettingsError || appLockError}
              </RocketText>
            ) : null}
          </RocketCard>
        </View>

        {/* NOTIFICATION SETTINGS */}
        <View style={styles.section}>
          <RocketText
            color="secondary"
            style={styles.sectionHeader}
            variant="captionBold">
            NOTIFICATIONS
          </RocketText>
          <RocketCard padding="md" style={styles.appLockCard} variant="default">
            <View style={styles.appLockHeader}>
              <View style={styles.appLockCopy}>
                <RocketText style={styles.rowTitle} variant="bodyMedium">
                  Enable notifications
                </RocketText>
                <RocketText color="secondary" style={styles.appLockDescription} variant="caption">
                  Ask the operating system for permission and save this device's push token locally.
                </RocketText>
              </View>
              <Switch
                accessibilityLabel="Enable notifications"
                accessibilityRole="switch"
                accessibilityState={{
                  checked: notificationPreferences.enabled,
                  disabled: notificationSettingsLoading || notificationWorking,
                }}
                disabled={notificationSettingsLoading || notificationWorking}
                onValueChange={(enabled) => void handleNotificationsEnabled(enabled)}
                trackColor={{ false: colors.border, true: colors.primaryAccent }}
                value={notificationPreferences.enabled}
                thumbColor={notificationPreferences.enabled ? colors.primaryText : colors.mutedText}
              />
            </View>
            {([
              ['messages', 'Messages'],
              ['calls', 'Calls'],
              ['social', 'Social activity'],
            ] as const).map(([category, label]) => (
              <View key={category} style={styles.notificationCategoryRow}>
                <RocketText color="primary" variant="bodySecondary">
                  {label}
                </RocketText>
                <Switch
                  accessibilityLabel={`${label} notifications`}
                  accessibilityRole="switch"
                  accessibilityState={{
                    checked: notificationPreferences[category],
                    disabled:
                      !notificationPreferences.enabled ||
                      notificationSettingsLoading ||
                      notificationWorking,
                  }}
                  disabled={
                    !notificationPreferences.enabled ||
                    notificationSettingsLoading ||
                    notificationWorking
                  }
                  onValueChange={(enabled) => void handleNotificationCategoryChange(category, enabled)}
                  trackColor={{ false: colors.border, true: colors.primaryAccent }}
                  value={notificationPreferences[category]}
                  thumbColor={notificationPreferences[category] ? colors.primaryText : colors.mutedText}
                />
              </View>
            ))}
            {notificationStatus ? (
              <RocketText
                accessibilityRole="alert"
                color={notificationStatus.includes('could not') || notificationStatus.includes('not granted') ? 'error' : 'muted'}
                style={styles.notificationStatus}
                variant="caption">
                {notificationStatus}
              </RocketText>
            ) : null}
            <RocketText color="muted" style={styles.appLockNote} variant="caption">
              Push notifications use Firebase Cloud Messaging (FCM). Device tokens are saved
              securely to your account so a trusted backend service can deliver alerts for
              messages, calls, and social activity without keeping the app active in the background.
            </RocketText>
          </RocketCard>
        </View>

        {/* ACCOUNT SECTION */}
        <View style={styles.section}>
          <RocketText
            color="secondary"
            style={styles.sectionHeader}
            variant="captionBold">
            Account
          </RocketText>
          <RocketCard padding="none" style={styles.sectionCard} variant="default">
            <SettingsRow
              detail="Name, username, bio"
              icon="👤"
              onPress={() => router.push('/edit-profile')}
              title="Edit profile"
            />
            <View
              style={[styles.rowDivider, { backgroundColor: colors.borderSubtle }]}
            />
            <SettingsRow
              detail="Close Friends and hide your stories"
              icon="◉"
              onPress={() => router.push('/story-privacy' as any)}
              title="Story privacy"
            />
            <View
              style={[styles.rowDivider, { backgroundColor: colors.borderSubtle }]}
            />
            <SettingsRow
              detail="Your connections and requests"
              icon="👥"
              onPress={() => router.push('/friends')}
              title="Friends & connections"
            />
          </RocketCard>
        </View>

        {/* ABOUT SECTION */}
        <View style={styles.section}>
          <RocketText
            color="secondary"
            style={styles.sectionHeader}
            variant="captionBold">
            About
          </RocketText>
          <RocketCard padding="none" style={styles.sectionCard} variant="default">
            <SettingsRow
              detail="Mission, principles, and credits"
              icon="✦"
              onPress={() => router.push('/about' as any)}
              title="About Rocket"
            />
          </RocketCard>
        </View>

        {/* SESSION SECTION */}
        <View style={styles.section}>
          <RocketText
            color="secondary"
            style={styles.sectionHeader}
            variant="captionBold">
            Session
          </RocketText>
          <RocketCard padding="md" style={styles.signOutCard} variant="default">
            <RocketButton
              accessibilityHint="Sign out of your account on this device"
              accessibilityLabel="Sign out"
              disabled={signingOut}
              label={signingOut ? 'Signing out...' : 'Sign out'}
              loading={signingOut}
              onPress={confirmSignOut}
              size="lg"
              variant="emergency"
            />
          </RocketCard>
        </View>

        {/* Inline Error Notice */}
        {error ? (
          <View style={styles.errorBox}>
            <RocketText color="error" style={styles.errorText} variant="caption">
              {error}
            </RocketText>
          </View>
        ) : null}
      </ScrollView>
    </RocketScreen>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingHorizontal: 0,
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SpacingScale.xl,
    paddingTop: SpacingScale.sm,
    paddingBottom: SpacingScale.sm,
  },
  backGlyph: {
    fontSize: 28,
    fontWeight: '300',
  },
  headerTitle: {
    letterSpacing: -0.3,
  },
  headerSpacer: {
    width: 44,
  },
  scrollContent: {
    paddingHorizontal: SpacingScale.xl,
    paddingBottom: SpacingScale.huge,
  },
  greetingHeader: {
    marginTop: SpacingScale.sm,
    marginBottom: SpacingScale.xl,
  },
  mainTitle: {
    fontSize: 26,
    letterSpacing: -0.6,
    marginBottom: 4,
  },
  section: {
    marginBottom: SpacingScale.xl,
  },
  appLockCard: {
    borderRadius: Radius.lg,
  },
  appLockHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SpacingScale.md,
  },
  notificationCategoryRow: {
    alignItems: 'center',
    borderTopColor: 'rgba(255,255,255,0.08)',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: SpacingScale.sm,
    minHeight: 44,
    paddingTop: SpacingScale.xs,
  },
  notificationStatus: {
    lineHeight: 18,
    marginTop: SpacingScale.sm,
  },
  appLockCopy: {
    flex: 1,
  },
  appLockDescription: {
    marginTop: SpacingScale.xs,
  },
  timeoutOptions: {
    borderTopColor: 'rgba(255,255,255,0.08)',
    borderTopWidth: 1,
    gap: SpacingScale.xs,
    marginTop: SpacingScale.md,
    paddingTop: SpacingScale.md,
  },
  timeoutOption: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingVertical: SpacingScale.xs,
  },
  radioOuter: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 2,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  radioInner: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  appLockNote: {
    lineHeight: 18,
    marginTop: SpacingScale.md,
  },
  appLockError: {
    marginTop: SpacingScale.sm,
  },
  sectionHeader: {
    marginBottom: SpacingScale.xs,
    paddingHorizontal: 2,
    letterSpacing: 0.8,
  },
  sectionCard: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SpacingScale.md,
    paddingHorizontal: SpacingScale.lg,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.md,
    flex: 1,
  },
  iconContainer: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIcon: {
    fontSize: 18,
  },
  rowInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  rowTitle: {
    fontWeight: '700',
  },
  rowChevron: {
    fontSize: 22,
    lineHeight: 22,
    marginLeft: SpacingScale.sm,
  },
  rowDivider: {
    height: 1,
    marginLeft: SpacingScale.lg + 38 + SpacingScale.md,
  },
  signOutCard: {
    borderRadius: Radius.lg,
  },
  errorBox: {
    marginTop: SpacingScale.sm,
  },
  errorText: {
    textAlign: 'center',
  },
});
