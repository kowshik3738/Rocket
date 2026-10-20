import { DarkTheme, Href, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Brand, PrimaryButton, colors } from '@/components/rocket-ui';
import { AuthProvider, useAuth } from '@/providers/auth-provider';
import { CallProvider } from '@/providers/call-provider';
import { AppLockProvider } from '@/providers/app-lock-provider';
import { VideoCallProvider } from '@/providers/video-call-provider';
import {
  getNotificationPreferences,
  getNotificationRoute,
  requestAndRegisterDevicePushToken,
  storeDevicePushToken,
} from '@/services/notification-service';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={DarkTheme}>
        <AuthProvider>
          <CallProvider>
            <VideoCallProvider>
              <AppLockProvider>
                <AppNavigator />
              </AppLockProvider>
            </VideoCallProvider>
          </CallProvider>
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function AppNavigator() {
  const { loading, profileError, profileMissing, signOut, user, verificationUser } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const handledNotificationIds = useRef(new Set<string>());

  useEffect(() => {
    if (loading || !user || profileMissing || profileError) return;
    let active = true;
    // Flag is set to true before registration starts so any token refresh that
    // arrives during or after registration is captured correctly.
    let notificationsEnabled = false;

    const openNotificationTarget = (notification: Notifications.Notification) => {
      const id = notification.request.identifier;
      if (!active || handledNotificationIds.current.has(id)) return;
      const route = getNotificationRoute(notification.request.content.data ?? {});
      if (!route) return;
      handledNotificationIds.current.add(id);
      router.push(route as Href);
    };

    const responseSubscription = Notifications.addNotificationResponseReceivedListener(
      (response) => openNotificationTarget(response.notification),
    );

    // Save refreshed FCM token to Firestore whenever notifications are enabled.
    // Checks preferences dynamically so settings changes are always respected.
    const tokenSubscription = Notifications.addPushTokenListener((token) => {
      if (!active) return;
      void getNotificationPreferences()
        .then((preferences) => {
          if (!active || !preferences.enabled) return;
          return storeDevicePushToken(user.uid, {
            type: token.type,
            data: String(token.data),
          });
        })
        .catch((tokenError) => {
          console.warn('[Rocket notifications] could not save refreshed device token', tokenError);
        });
    });

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (active && response) openNotificationTarget(response.notification);
      })
      .catch((notificationError) => {
        console.warn('[Rocket notifications] could not read the launch response', notificationError);
      });

    void getNotificationPreferences()
      .then(async (preferences) => {
        if (!active || !preferences.enabled) return;
        const permission = await Notifications.getPermissionsAsync();
        if (!permission.granted) return;
        await requestAndRegisterDevicePushToken(user.uid);
      })
      .catch((registrationError) => {
        console.warn('[Rocket notifications] device registration is unavailable', registrationError);
      });

    return () => {
      active = false;
      responseSubscription.remove();
      tokenSubscription.remove();
    };
  }, [loading, profileError, profileMissing, router, user]);

  useEffect(() => {
    if (loading) {
      return;
    }

    const firstSegment = segments[0] as string | undefined;
    const publicRoutes = ['welcome', 'sign-in', 'forgot-password'];
    const isVerificationRoute = firstSegment === 'verify-email';
    const isAccountSetupRoute = firstSegment === 'complete-account';

    if (verificationUser) {
      if (!isVerificationRoute && firstSegment !== 'forgot-password') {
        router.replace('/verify-email' as Href);
      }
    } else if (user && profileMissing) {
      if (!isAccountSetupRoute) {
        router.replace('/complete-account' as Href);
      }
    } else if (user && (publicRoutes.includes(firstSegment ?? '') || isVerificationRoute || isAccountSetupRoute)) {
      router.replace('/(tabs)');
    } else if (!user && isVerificationRoute) {
      router.replace('/sign-in');
    } else if (!user && firstSegment && !publicRoutes.includes(firstSegment)) {
      router.replace('/sign-in');
    }
  }, [loading, profileMissing, router, segments, user, verificationUser]);

  if (loading) {
    return <AuthLoadingScreen />;
  }

  if (user && profileError) {
    return <ProfileErrorScreen message={profileError} onSignOut={signOut} />;
  }

  const firstSegment = segments[0] as string | undefined;
  if (user && profileMissing && firstSegment !== 'complete-account') {
    return <AuthLoadingScreen />;
  }

  if (user && profileMissing) {
    return (
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="complete-account" />
      </Stack>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="complete-account" />
      <Stack.Screen name="verify-email" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="friends" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="edit-profile" />
      <Stack.Screen name="chat/[conversationId]" />
      <Stack.Screen name="call/[callId]" />
      <Stack.Screen name="video-call/[callId]" />
      <Stack.Screen name="group/create" />
      <Stack.Screen name="group/[groupId]" />
      <Stack.Screen name="group/[groupId]/info" />
      <Stack.Screen name="post/[postId]/comments" />
      <Stack.Screen name="about" />
      <Stack.Screen name="archived" />
      <Stack.Screen name="story-create" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="story-privacy" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="story/[authorUid]" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
    </Stack>
  );
}

function AuthLoadingScreen() {
  return <View style={loadingStyles.container}><Brand /><ActivityIndicator color={colors.accent} size="large" /><Text style={loadingStyles.text}>Checking your orbit...</Text></View>;
}

function ProfileErrorScreen({ message, onSignOut }: { message: string; onSignOut: () => Promise<void> }) {
  return <View style={loadingStyles.container}><Brand /><Text style={loadingStyles.title}>We could not load your profile</Text><Text style={loadingStyles.text}>{message}</Text><PrimaryButton label="Sign out" onPress={() => void onSignOut()} /></View>;
}

const loadingStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 20 },
  text: { color: colors.textSecondary, fontSize: 13 },
  title: { color: colors.text, fontSize: 19, fontWeight: '800', textAlign: 'center' },
});
