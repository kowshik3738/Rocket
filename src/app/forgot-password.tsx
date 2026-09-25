import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Brand, Field, PrimaryButton, Screen, colors } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordScreen() {
  const { email: initialEmail } = useLocalSearchParams<{ email?: string }>();
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState(typeof initialEmail === 'string' ? initialEmail : '');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSend() {
    const normalizedEmail = email.trim();
    setError('');
    if (!normalizedEmail) {
      setError('Enter your email address.');
      return;
    }
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }

    setSending(true);
    try {
      await sendPasswordReset(normalizedEmail);
      setSent(true);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'We could not send reset instructions. Please try again.');
    } finally {
      setSending(false);
    }
  }

  return <Screen><View style={page.container}><Brand /><Text style={page.title}>Reset your password.</Text><Text style={page.subtitle}>Enter your email and we’ll send reset instructions.</Text>{sent ? <View style={page.form}><Text style={page.success}>If an account exists for that email, we’ve sent password reset instructions.</Text><PrimaryButton label="Return to sign in" onPress={() => router.replace('/sign-in')} /></View> : <View style={page.form}><Field autoCapitalize="none" keyboardType="email-address" label="Email" onChangeText={setEmail} placeholder="you@example.com" value={email} />{error ? <Text style={page.error}>{error}</Text> : null}<PrimaryButton disabled={sending} label={sending ? 'Sending instructions...' : 'Send reset instructions'} onPress={() => void handleSend()} /></View>}<View style={page.footer}><Text style={page.footerText}>Remembered your password?</Text><Pressable disabled={sending} onPress={() => router.replace('/sign-in')}><Text style={page.link}> Sign in</Text></Pressable></View></View></Screen>;
}

const page = StyleSheet.create({
  container: { paddingTop: 30 },
  title: { color: colors.text, fontSize: 32, fontWeight: '900', marginTop: 70 },
  subtitle: { color: colors.textSecondary, fontSize: 16, lineHeight: 23, marginTop: 8 },
  form: { marginTop: 42 },
  error: { color: colors.accent, fontSize: 13, lineHeight: 19, marginTop: -4, marginBottom: 15 },
  success: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, marginBottom: 24 },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 28 },
  footerText: { color: colors.textSecondary, fontSize: 14 },
  link: { color: colors.accent, fontSize: 14, fontWeight: '800' },
});
