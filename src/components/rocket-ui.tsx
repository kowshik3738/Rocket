import { PropsWithChildren, ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';

export const colors = Colors.dark;

export function Screen({ children, scroll = true }: PropsWithChildren<{ scroll?: boolean }>) {
  const content = scroll ? <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>{children}</ScrollView> : children;
  return <SafeAreaView edges={['top']} style={styles.screen}>{content}</SafeAreaView>;
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return <View style={styles.brand}><View style={styles.brandMark}><Text style={styles.brandMarkText}>R</Text></View><Text style={[styles.brandText, compact && styles.brandTextCompact]}>rocket</Text></View>;
}

export function Avatar({ user, size = 48 }: { user: { initials: string; color: string }; size?: number }) {
  return <View style={[styles.avatar, { backgroundColor: user.color, width: size, height: size, borderRadius: size / 2 }]}><Text style={[styles.avatarText, { fontSize: size * 0.3 }]}>{user.initials}</Text></View>;
}

export function TopBar({ title, right, back }: { title: string; right?: ReactNode; back?: () => void }) {
  return <View style={styles.topBar}>{back ? <Pressable onPress={back} style={styles.backButton}><Text style={styles.backText}>‹</Text></Pressable> : <View style={styles.topBarSpacer} />}<Text style={styles.screenTitle}>{title}</Text><View style={styles.topBarRight}>{right}</View></View>;
}

export function PrimaryButton({ label, onPress, variant = 'accent', disabled = false }: { label: string; onPress?: () => void; variant?: 'accent' | 'outline'; disabled?: boolean }) {
  return <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryButton, variant === 'outline' && styles.outlineButton, disabled && styles.disabledButton, pressed && styles.pressed]}><Text style={[styles.primaryButtonText, variant === 'outline' && styles.outlineButtonText]}>{label}</Text></Pressable>;
}

export function SectionTitle({ title, action }: { title: string; action?: string }) {
  return <View style={styles.sectionTitle}><Text style={styles.sectionHeading}>{title}</Text>{action && <Text style={styles.sectionAction}>{action}</Text>}</View>;
}

export function Field({ label, placeholder, secureTextEntry = false, value, onChangeText, keyboardType, autoCapitalize = 'sentences', multiline = false }: { label: string; placeholder: string; secureTextEntry?: boolean; value?: string; onChangeText?: (value: string) => void; keyboardType?: 'default' | 'email-address'; autoCapitalize?: 'none' | 'sentences'; multiline?: boolean }) {
  return <View style={styles.field}>{label ? <Text style={styles.fieldLabel}>{label}</Text> : null}<TextInput autoCapitalize={autoCapitalize} autoCorrect={false} keyboardType={keyboardType} multiline={multiline} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.textSecondary} secureTextEntry={secureTextEntry} style={[styles.input, multiline && styles.multilineInput]} textAlignVertical={multiline ? 'top' : 'center'} value={value} /></View>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <View style={styles.emptyState}><View style={styles.emptyIcon}><Text style={styles.emptyIconText}>✦</Text></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyBody}>{body}</Text>{action}</View>;
}

export function Card({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 36 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandMark: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-8deg' }] },
  brandMarkText: { color: '#FFF', fontSize: 20, fontWeight: '900' },
  brandText: { color: colors.text, fontSize: 25, fontWeight: '800', letterSpacing: -0.8 },
  brandTextCompact: { fontSize: 20 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFF', fontWeight: '800' },
  topBar: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topBarSpacer: { width: 36 },
  topBarRight: { minWidth: 36, alignItems: 'flex-end' },
  screenTitle: { color: colors.text, fontSize: 19, fontWeight: '800' },
  backButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.backgroundElement, alignItems: 'center', justifyContent: 'center' },
  backText: { color: colors.text, fontSize: 30, lineHeight: 30, marginTop: -3 },
  primaryButton: { minHeight: 54, borderRadius: 17, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  primaryButtonText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  outlineButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  outlineButtonText: { color: colors.text },
  pressed: { opacity: 0.75, transform: [{ scale: 0.985 }] },
  disabledButton: { opacity: 0.55 },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sectionHeading: { color: colors.text, fontSize: 18, fontWeight: '800' },
  sectionAction: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  field: { gap: 8, marginBottom: 18 },
  fieldLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
  input: { height: 54, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.backgroundElement, color: colors.text, paddingHorizontal: 16, fontSize: 16 },
  multilineInput: { height: 110, paddingTop: 14 },
  card: { backgroundColor: colors.backgroundElement, borderRadius: 22, borderWidth: 1, borderColor: colors.border },
  emptyState: { alignItems: 'center', paddingHorizontal: 30, paddingVertical: 52 },
  emptyIcon: { width: 58, height: 58, borderRadius: 20, backgroundColor: colors.backgroundSelected, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  emptyIconText: { color: colors.accentSecondary, fontSize: 25 },
  emptyTitle: { color: colors.text, fontSize: 19, fontWeight: '800', marginBottom: 8 },
  emptyBody: { color: colors.textSecondary, textAlign: 'center', lineHeight: 21, fontSize: 14 },
});
