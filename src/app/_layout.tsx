import { DarkTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Brand, PrimaryButton, colors } from '@/components/rocket-ui';
import { AuthProvider, useAuth } from '@/providers/auth-provider';

export default function RootLayout() {
  return (
    <ThemeProvider value={DarkTheme}>
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </ThemeProvider>
  );
}

function AppNavigator() {
  const { loading, profileError, profileMissing, signOut, user } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (loading) {
      return;
    }

    const firstSegment = segments[0] as string | undefined;
    const publicRoute = firstSegment === 'welcome' || firstSegment === 'sign-in' || firstSegment === 'create-account';
    const protectedRoute = firstSegment === '(tabs)' || firstSegment === 'friends' || firstSegment === 'settings' || firstSegment === 'edit-profile' || firstSegment === 'chat';

    if (user && publicRoute) {
      router.replace('/(tabs)');
    } else if (!user && protectedRoute) {
      router.replace('/welcome');
    }
  }, [loading, router, segments, user]);

  if (loading) {
    return <AuthLoadingScreen />;
  }

  if (user && profileError) {
    return <ProfileErrorScreen message={profileError} onSignOut={signOut} />;
  }

  if (user && profileMissing) {
    return <ProfileMissingScreen onSignOut={signOut} />;
  }

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="create-account" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="friends" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="edit-profile" />
      <Stack.Screen name="chat/[conversationId]" />
      <Stack.Screen name="post/[postId]/comments" />
    </Stack>
  );
}

function AuthLoadingScreen() {
  return <View style={loadingStyles.container}><Brand /><ActivityIndicator color={colors.accent} size="large" /><Text style={loadingStyles.text}>Checking your orbit...</Text></View>;
}

function ProfileErrorScreen({ message, onSignOut }: { message: string; onSignOut: () => Promise<void> }) {
  return <View style={loadingStyles.container}><Brand /><Text style={loadingStyles.title}>We could not load your profile</Text><Text style={loadingStyles.text}>{message}</Text><PrimaryButton label="Sign out" onPress={() => void onSignOut()} /></View>;
}

function ProfileMissingScreen({ onSignOut }: { onSignOut: () => Promise<void> }) {
  return <View style={loadingStyles.container}><Brand /><Text style={loadingStyles.title}>Profile setup is incomplete</Text><Text style={loadingStyles.text}>This account does not have a Rocket profile yet. Sign out and create a new account to continue.</Text><PrimaryButton label="Sign out" onPress={() => void onSignOut()} /></View>;
}

const loadingStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 20 },
  text: { color: colors.textSecondary, fontSize: 13 },
  title: { color: colors.text, fontSize: 19, fontWeight: '800', textAlign: 'center' },
});
