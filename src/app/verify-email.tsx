import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Brand, Field, PrimaryButton, Screen, colors } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';

export default function VerifyEmailScreen() {
  const {
    changeVerificationEmail,
    getVerificationResendCooldown,
    refreshVerificationStatus,
    resendVerificationEmail,
    signOut,
    verificationError,
    verificationUser,
  } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setEmail(verificationUser?.email ?? '');
    void getVerificationResendCooldown().then(setCooldown).catch((cooldownError) => {
      console.warn('[Rocket auth] could not load verification resend cooldown', cooldownError);
    });
  }, [getVerificationResendCooldown, verificationUser?.email]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((remaining) => Math.max(0, remaining - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown > 0]);

  async function handleVerified() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const verified = await refreshVerificationStatus();
      if (!verified) {
        setError('Your email is not verified yet. Open the link in your inbox, then try again.');
      }
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'We could not confirm your email status.');
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await resendVerificationEmail();
      setCooldown(60);
      setMessage('Verification email sent. Check your inbox and spam folder.');
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : 'We could not send the verification email.');
      void getVerificationResendCooldown().then(setCooldown).catch((cooldownError) => {
        console.warn('[Rocket auth] could not refresh verification resend cooldown', cooldownError);
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleChangeEmail() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await changeVerificationEmail(email, password);
      setPassword('');
      setMessage(`A confirmation link was sent to ${email.trim()}. Your account email will change after you verify it.`);
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : 'We could not start the email change.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut();
      router.replace('/sign-in');
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : 'Unable to sign out. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const displayedError = error || verificationError;

  return (
    <Screen>
      <View style={page.container}>
        <Brand />
        <Text style={page.title}>Verify Your Email</Text>
        <Text style={page.subtitle}>
          We&apos;ve sent a verification link to your email address. Open your inbox and click the link to verify your email.
        </Text>
        <Text style={page.hint}>If the link has expired or no longer works, request a fresh one below.</Text>
        <Text style={page.email}>{verificationUser?.email ?? email}</Text>
        {displayedError ? <Text accessibilityRole="alert" style={page.error}>{displayedError}</Text> : null}
        {message ? <Text accessibilityRole="alert" style={page.success}>{message}</Text> : null}
        <View style={page.actions}>
          <PrimaryButton disabled={busy} label="I've Verified My Email" onPress={() => void handleVerified()} />
          <PrimaryButton
            disabled={busy || cooldown > 0 || !verificationUser}
            label={cooldown > 0 ? `Resend Verification Email (${cooldown}s)` : 'Resend Verification Email'}
            onPress={() => void handleResend()}
          />
          <Text style={page.sectionTitle}>Change Email</Text>
          <Field
            autoCapitalize="none"
            keyboardType="email-address"
            label="New email address"
            onChangeText={setEmail}
            placeholder="you@example.com"
            value={email}
          />
          <Field
            autoCapitalize="none"
            label="Password"
            onChangeText={setPassword}
            placeholder="Confirm your password"
            secureTextEntry
            showPasswordToggle
            value={password}
          />
          <PrimaryButton disabled={busy || !verificationUser} label="Change Email" onPress={() => void handleChangeEmail()} />
          <Pressable
            disabled={busy}
            onPress={() => router.push({
              pathname: '/forgot-password',
              params: verificationUser?.email ? { email: verificationUser.email } : {},
            })}
            style={page.signOut}
          >
            <Text style={page.link}>Forgot Password?</Text>
          </Pressable>
          <Pressable disabled={busy} onPress={() => void handleSignOut()} style={page.signOut}>
            <Text style={page.link}>Sign Out</Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

const page = StyleSheet.create({
  container: { paddingTop: 30, paddingBottom: 32 },
  title: { color: colors.text, fontSize: 30, fontWeight: '900', marginTop: 58 },
  subtitle: { color: colors.textSecondary, fontSize: 15, lineHeight: 23, marginTop: 12 },
  hint: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 10 },
  email: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: 18 },
  actions: { gap: 16, marginTop: 28 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: 12 },
  error: { color: colors.accent, fontSize: 13, lineHeight: 19, marginTop: 14 },
  success: { color: '#73D6A4', fontSize: 13, lineHeight: 19, marginTop: 14 },
  signOut: { alignItems: 'center', padding: 12 },
  link: { color: colors.accent, fontSize: 14, fontWeight: '800' },
});
