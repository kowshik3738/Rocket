import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Screen, colors } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';

const rows = [{ title: 'Account', detail: 'Username, email, password' }, { title: 'Privacy', detail: 'Who can see your orbit' }, { title: 'Notifications', detail: 'Mentions, messages, friend requests' }, { title: 'Appearance', detail: 'Dark mode' }, { title: 'Help & support', detail: 'Questions or feedback' }];

export default function SettingsScreen() {
  const { signOut } = useAuth();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSignOut() {
    setError('');
    setSubmitting(true);
    try {
      await signOut();
      router.replace('/welcome');
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : 'Unable to sign out. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return <Screen><View style={page.header}><Pressable onPress={() => router.back()}><Text style={page.back}>‹</Text></Pressable><Text style={page.title}>Settings</Text><View style={page.spacer} /></View><Text style={page.subtitle}>Make Rocket work your way.</Text><Card style={page.card}>{rows.map(row => <Pressable key={row.title} style={page.row}><View><Text style={page.rowTitle}>{row.title}</Text><Text style={page.detail}>{row.detail}</Text></View><Text style={page.arrow}>›</Text></Pressable>)}</Card>{error ? <Text style={page.error}>{error}</Text> : null}<Pressable disabled={submitting} style={page.signOut} onPress={handleSignOut}><Text style={page.signOutText}>{submitting ? 'Signing out...' : 'Sign out'}</Text></Pressable><Text style={page.version}>Rocket preview · v0.1</Text></Screen>;
}
const page = StyleSheet.create({ header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }, back: { color: colors.text, fontSize: 31, lineHeight: 31 }, spacer: { width: 25 }, title: { color: colors.text, fontSize: 19, fontWeight: '800' }, subtitle: { color: colors.textSecondary, marginTop: 12, marginBottom: 27 }, card: { paddingHorizontal: 17 }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: colors.border }, rowTitle: { color: colors.text, fontSize: 15, fontWeight: '700' }, detail: { color: colors.textSecondary, fontSize: 12, marginTop: 4 }, arrow: { color: colors.textSecondary, fontSize: 25 }, error: { color: colors.accent, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 18 }, signOut: { paddingVertical: 20, alignItems: 'center' }, signOutText: { color: colors.accent, fontSize: 14, fontWeight: '800' }, version: { color: colors.textSecondary, textAlign: 'center', fontSize: 11, marginTop: 15 } });
