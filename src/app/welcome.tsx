import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Brand, PrimaryButton, Screen, colors } from '@/components/rocket-ui';

export default function WelcomeScreen() {
  return <Screen scroll={false}><View style={page.wrap}><View style={page.hero}><Brand /><View style={page.orbit}><Text style={page.orbitText}>R</Text></View><Text style={page.title}>Your people.{`\n`}Your orbit.</Text><Text style={page.body}>A quieter place to share what matters and stay close to the people who matter.</Text></View><View style={page.actions}><PrimaryButton label="Create an account" onPress={() => router.push('/create-account')} /><PrimaryButton label="I already have an account" variant="outline" onPress={() => router.push('/sign-in')} /><Text style={page.note}>Private by design · Built for real connections</Text></View></View></Screen>;
}

const page = StyleSheet.create({ wrap: { flex: 1, justifyContent: 'space-between', paddingVertical: 24 }, hero: { alignItems: 'center', paddingTop: 52 }, orbit: { width: 164, height: 164, borderRadius: 82, backgroundColor: colors.backgroundSelected, alignItems: 'center', justifyContent: 'center', marginTop: 74, marginBottom: 34, borderWidth: 1, borderColor: colors.border }, orbitText: { color: colors.accent, fontSize: 76, fontWeight: '900', transform: [{ rotate: '-8deg' }] }, title: { color: colors.text, fontSize: 42, lineHeight: 44, fontWeight: '900', textAlign: 'center', letterSpacing: -1.2 }, body: { color: colors.textSecondary, fontSize: 15, lineHeight: 23, textAlign: 'center', maxWidth: 290, marginTop: 18 }, actions: { gap: 12 }, note: { color: colors.textSecondary, textAlign: 'center', fontSize: 12, marginTop: 8 } });
