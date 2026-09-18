import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Brand, Field, PrimaryButton, Screen, colors } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';

export default function EditProfileScreen() {
  const { profile, updateProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.displayName);
    setUsername(profile.username);
    setBio(profile.bio);
  }, [profile]);

  async function handleSave() {
    setError('');
    setSaving(true);
    try {
      await updateProfile(displayName, username, bio);
      router.back();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  }

  if (!profile) {
    return <Screen scroll={false}><View style={page.state}><Text style={page.stateTitle}>Profile setup required</Text><Text style={page.stateText}>Your Rocket profile could not be loaded.</Text></View></Screen>;
  }

  return <Screen><View style={page.header}><Pressable onPress={() => router.back()}><Text style={page.back}>‹</Text></Pressable><Brand compact /><View style={page.spacer} /></View><Text style={page.title}>Edit profile</Text><Text style={page.subtitle}>Keep your Rocket profile up to date.</Text><View style={page.form}><Field label="Display name" onChangeText={setDisplayName} placeholder="Your full name" value={displayName} /><Field autoCapitalize="none" label="Username" onChangeText={setUsername} placeholder="your.username" value={username} /><View style={page.bioField}><Text style={page.label}>BIO</Text><Text style={page.counter}>{bio.length}/150</Text><Field autoCapitalize="sentences" label="" multiline onChangeText={(value) => setBio(value.slice(0, 150))} placeholder="Tell people a little about you" value={bio} /></View>{error ? <Text style={page.error}>{error}</Text> : null}<PrimaryButton disabled={saving} label={saving ? 'Saving...' : 'Save changes'} onPress={() => void handleSave()} /></View></Screen>;
}

const page = StyleSheet.create({ header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }, back: { color: colors.text, fontSize: 31, lineHeight: 31 }, spacer: { width: 25 }, title: { color: colors.text, fontSize: 30, fontWeight: '900', marginTop: 52 }, subtitle: { color: colors.textSecondary, fontSize: 15, marginTop: 8 }, form: { marginTop: 34 }, bioField: { marginBottom: 5 }, label: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.7, marginBottom: 8 }, counter: { position: 'absolute', right: 0, top: 0, color: colors.textSecondary, fontSize: 11 }, error: { color: colors.accent, fontSize: 13, lineHeight: 19, marginBottom: 15 }, state: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }, stateTitle: { color: colors.text, fontSize: 20, fontWeight: '800' }, stateText: { color: colors.textSecondary, marginTop: 8 } });
