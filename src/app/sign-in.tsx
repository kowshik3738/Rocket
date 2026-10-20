import { Href, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Brand, Field, PrimaryButton, Screen, colors } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';

export default function SignInScreen() {
  const { resendVerificationEmail, signIn, signInWithGoogle } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [verificationMessage, setVerificationMessage] = useState('');
  const [verificationNeeded, setVerificationNeeded] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSignIn() {
    setError('');
    setVerificationMessage('');
    setVerificationNeeded(false);
    setSubmitting(true);
    try {
      await signIn(identifier, password);
      router.replace('/(tabs)');
    } catch (authError) {
      const message = authError instanceof Error ? authError.message : 'Unable to sign in. Please try again.';
      setError(message);
      setVerificationNeeded(/verify your email/i.test(message));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResendVerification() {
    if (resendingVerification) return;
    if (!identifier.trim() || !password) {
      setError('Enter your email and password to resend the verification link.');
      return;
    }
    setResendingVerification(true);
    setVerificationMessage('');
    try {
      await resendVerificationEmail(identifier, password);
      setVerificationMessage('A new verification link was sent. Check your inbox and spam folder.');
    } catch (resendError) {
      const message = resendError instanceof Error ? resendError.message : 'The verification email could not be sent.';
      if (/already verified/i.test(message)) {
        setVerificationMessage(message);
        setVerificationNeeded(false);
      } else {
        setError(message);
      }
    } finally {
      setResendingVerification(false);
    }
  }

  async function handleGoogleSignIn() {
    setError('');
    setSubmitting(true);
    try {
      const result = await signInWithGoogle();
      if (result === 'cancelled') return;
      router.replace(result === 'profile-missing' ? '/complete-account' as Href : '/(tabs)');
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Unable to sign in with Google. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return <Screen><View style={page.container}><Brand /><Text style={page.title}>Welcome back.</Text><Text style={page.subtitle}>Your orbit has been waiting.</Text><View style={page.form}><PrimaryButton disabled={submitting} label={submitting ? 'Connecting...' : 'Continue with Google'} onPress={() => void handleGoogleSignIn()} variant="outline" /><View style={page.separator}><View style={page.separatorLine} /><Text style={page.separatorText}>or sign in with email</Text><View style={page.separatorLine} /></View><Field autoCapitalize="none" keyboardType="email-address" label="Username or Email" onChangeText={setIdentifier} placeholder="you@example.com or username" value={identifier} /><Field autoCapitalize="none" label="Password" onChangeText={setPassword} placeholder="Enter your password" secureTextEntry showPasswordToggle value={password} />{error ? <Text accessibilityRole="alert" style={page.error}>{error}</Text> : null}{verificationMessage ? <Text accessibilityRole="alert" style={page.success}>{verificationMessage}</Text> : null}{verificationNeeded ? <Pressable disabled={resendingVerification} onPress={() => void handleResendVerification()}><Text style={page.link}>{resendingVerification ? 'Sending verification link...' : 'Resend verification email'}</Text></Pressable> : null}<Pressable onPress={() => router.push({ pathname: './forgot-password', params: identifier.includes('@') ? { email: identifier.trim() } : {} })}><Text style={page.forgot}>Forgot password?</Text></Pressable><PrimaryButton disabled={submitting} label={submitting ? 'Signing in...' : 'Sign in'} onPress={() => void handleSignIn()} /></View></View></Screen>;
}
const page = StyleSheet.create({ container: { paddingTop: 30 }, title: { color: colors.text, fontSize: 32, fontWeight: '900', marginTop: 70 }, subtitle: { color: colors.textSecondary, fontSize: 16, marginTop: 8 }, form: { marginTop: 42 }, separator: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 22 }, separatorLine: { flex: 1, height: 1, backgroundColor: colors.border }, separatorText: { color: colors.textSecondary, fontSize: 12 }, error: { color: colors.accent, fontSize: 13, lineHeight: 19, marginTop: -4, marginBottom: 15 }, success: { color: '#73D6A4', fontSize: 13, lineHeight: 19, marginTop: -4, marginBottom: 15 }, forgot: { color: colors.accentSecondary, fontSize: 13, fontWeight: '700', textAlign: 'right', marginBottom: 24 }, link: { color: colors.accent, fontSize: 14, fontWeight: '800' } });
