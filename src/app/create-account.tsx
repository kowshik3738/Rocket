import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Brand, Field, PrimaryButton, Screen, colors } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';

export default function CreateAccountScreen() {
  const { signUp } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleCreateAccount() {
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await signUp(displayName, username, email, password);
      router.replace('/(tabs)');
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Unable to create your account. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return <Screen><View style={page.container}><Brand /><Text style={page.title}>Make your orbit.</Text><Text style={page.subtitle}>Create a space that feels like yours.</Text><View style={page.form}><Field label="Full name" onChangeText={setDisplayName} placeholder="Your full name" value={displayName} /><Field autoCapitalize="none" label="Username" onChangeText={setUsername} placeholder="your.username" value={username} /><Field autoCapitalize="none" keyboardType="email-address" label="Email" onChangeText={setEmail} placeholder="you@example.com" value={email} /><Field autoCapitalize="none" label="Password" onChangeText={setPassword} placeholder="At least 6 characters" secureTextEntry value={password} /><Field autoCapitalize="none" label="Confirm password" onChangeText={setConfirmPassword} placeholder="Re-enter your password" secureTextEntry value={confirmPassword} />{error ? <Text style={page.error}>{error}</Text> : null}<PrimaryButton disabled={submitting} label={submitting ? 'Creating account...' : 'Create account'} onPress={handleCreateAccount} /></View><View style={page.footer}><Text style={page.footerText}>Already on Rocket?</Text><Pressable onPress={() => router.push('/sign-in')}><Text style={page.link}> Sign in</Text></Pressable></View></View></Screen>;
}
const page = StyleSheet.create({ container: { paddingTop: 30 }, title: { color: colors.text, fontSize: 32, fontWeight: '900', marginTop: 58 }, subtitle: { color: colors.textSecondary, fontSize: 16, marginTop: 8 }, form: { marginTop: 34 }, error: { color: colors.accent, fontSize: 13, lineHeight: 19, marginBottom: 15 }, footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 }, footerText: { color: colors.textSecondary, fontSize: 14 }, link: { color: colors.accent, fontSize: 14, fontWeight: '800' } });
