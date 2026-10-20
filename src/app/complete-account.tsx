import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Brand, Field, PrimaryButton, Screen, colors } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';
import { validateUsername } from '@/services/user-service';

export default function CompleteAccountScreen() {
  const { completeGoogleAccount, signOut, user } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleAccount, setGoogleAccount] = useState(true);

  async function handleCreateAccount() {
    setError('');
    const usernameError = validateUsername(username);
    if (usernameError) {
      setError(usernameError);
      return;
    }
    if (!password || !confirmPassword) {
      setError('Enter and confirm a password.');
      return;
    }
    if (password.length < 8) {
      setError('Choose a password with at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await completeGoogleAccount(username, password);
      setPassword('');
      setConfirmPassword('');
      router.replace('/(tabs)');
    } catch (setupError) {
      const message = setupError instanceof Error ? setupError.message : 'Unable to complete your account. Please try again.';
      if (/must be completed with the Google account/i.test(message)) {
        setGoogleAccount(false);
      }
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    setSubmitting(true);
    try {
      await signOut();
      router.replace('/sign-in');
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : 'Unable to sign out. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <View style={page.container}>
        <Brand />
        <Text style={page.title}>Complete Your Account</Text>
        <Text style={page.subtitle}>Choose a username and password to finish setting up Rocket.</Text>
        {!googleAccount ? (
          <View style={page.form}>
            <Text accessibilityRole="alert" style={page.error}>{error}</Text>
          </View>
        ) : (
          <View style={page.form}>
            <Text style={page.label}>Google email</Text>
            <Text accessibilityLabel="Google email, read only" style={page.email}>{user?.email ?? ''}</Text>
            <Field autoCapitalize="none" label="Choose Username" onChangeText={(value) => setUsername(value.toLowerCase())} placeholder="your.username" value={username} />
            <Field autoCapitalize="none" label="Create Password" onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry showPasswordToggle value={password} />
            <Field autoCapitalize="none" label="Confirm Password" onChangeText={setConfirmPassword} placeholder="Re-enter your password" secureTextEntry showPasswordToggle value={confirmPassword} />
            {error ? <Text accessibilityRole="alert" style={page.error}>{error}</Text> : null}
            <PrimaryButton disabled={submitting} label={submitting ? 'Creating your account...' : 'Create My Account'} onPress={() => void handleCreateAccount()} />
          </View>
        )}
        <Pressable disabled={submitting} onPress={() => void handleSignOut()} style={page.signOut}>
          <Text style={page.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const page = StyleSheet.create({
  container: { paddingTop: 30, paddingBottom: 32 },
  title: { color: colors.text, fontSize: 30, fontWeight: '900', marginTop: 58 },
  subtitle: { color: colors.textSecondary, fontSize: 15, lineHeight: 23, marginTop: 12 },
  form: { gap: 16, marginTop: 30 },
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  email: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: -10, marginBottom: 4 },
  error: { color: colors.accent, fontSize: 13, lineHeight: 19 },
  signOut: { alignItems: 'center', padding: 14, marginTop: 12 },
  signOutText: { color: colors.accent, fontSize: 14, fontWeight: '800' },
});
