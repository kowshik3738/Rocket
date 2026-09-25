import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Brand, Field, PrimaryButton, Screen, colors } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';

export default function SignInScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSignIn() {
    setError('');
    setSubmitting(true);
    try {
      await signIn(email, password);
      router.replace('/(tabs)');
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Unable to sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return <Screen><View style={page.container}><Brand /><Text style={page.title}>Welcome back.</Text><Text style={page.subtitle}>Your orbit has been waiting.</Text><View style={page.form}><Field autoCapitalize="none" keyboardType="email-address" label="Email" onChangeText={setEmail} placeholder="you@example.com" value={email} /><Field autoCapitalize="none" label="Password" onChangeText={setPassword} placeholder="Enter your password" secureTextEntry value={password} />{error ? <Text style={page.error}>{error}</Text> : null}<Pressable onPress={() => router.push({ pathname: './forgot-password', params: email.trim() ? { email: email.trim() } : {} })}><Text style={page.forgot}>Forgot password?</Text></Pressable><PrimaryButton disabled={submitting} label={submitting ? 'Signing in...' : 'Sign in'} onPress={handleSignIn} /></View><View style={page.footer}><Text style={page.footerText}>New to Rocket?</Text><Pressable onPress={() => router.push('/create-account')}><Text style={page.link}> Create an account</Text></Pressable></View></View></Screen>;
}
const page = StyleSheet.create({ container: { paddingTop: 30 }, title: { color: colors.text, fontSize: 32, fontWeight: '900', marginTop: 70 }, subtitle: { color: colors.textSecondary, fontSize: 16, marginTop: 8 }, form: { marginTop: 42 }, error: { color: colors.accent, fontSize: 13, lineHeight: 19, marginTop: -4, marginBottom: 15 }, forgot: { color: colors.accentSecondary, fontSize: 13, fontWeight: '700', textAlign: 'right', marginBottom: 24 }, footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 28 }, footerText: { color: colors.textSecondary, fontSize: 14 }, link: { color: colors.accent, fontSize: 14, fontWeight: '800' } });
