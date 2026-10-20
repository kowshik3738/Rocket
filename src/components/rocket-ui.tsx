import React, { PropsWithChildren, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { Colors } from '@/constants/theme';
import {
  RocketAvatar,
  RocketBrand,
  RocketButton,
  RocketCard,
  RocketEmptyState,
  RocketHeader,
  RocketInput,
  RocketScreen,
} from '@/design-system';

// Re-export complete design system
export * from '@/design-system';

// Default dark theme colors
export const colors = Colors.dark;

/**
 * Screen wrapper (Backward compatible)
 */
export function Screen({ children, scroll = true }: PropsWithChildren<{ scroll?: boolean }>) {
  return (
    <RocketScreen
      edges={['top']}
      scroll={scroll}>
      {children}
    </RocketScreen>
  );
}

/**
 * Brand Mark (Backward compatible)
 */
export function Brand({ compact = false }: { compact?: boolean }) {
  return <RocketBrand compact={compact} />;
}

/**
 * Avatar (Backward compatible with { user: { initials, color }, size })
 */
export function Avatar({
  user,
  size = 48,
  source,
}: {
  user: { initials: string; color: string };
  size?: number;
  source?: string;
}) {
  return <RocketAvatar size={size} source={source} user={user} />;
}

/**
 * TopBar (Backward compatible)
 */
export function TopBar({
  title,
  right,
  back,
}: {
  title: string;
  right?: ReactNode;
  back?: () => void;
}) {
  return <RocketHeader back={back} right={right} title={title} />;
}

/**
 * PrimaryButton (Backward compatible)
 */
export function PrimaryButton({
  label,
  onPress,
  variant = 'accent',
  disabled = false,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'accent' | 'outline';
  disabled?: boolean;
}) {
  return (
    <RocketButton
      disabled={disabled}
      label={label}
      onPress={onPress}
      variant={variant === 'outline' ? 'outline' : 'primary'}
    />
  );
}

/**
 * SectionTitle (Backward compatible)
 */
export function SectionTitle({ title, action }: { title: string; action?: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.sectionHeading}>{title}</Text>
      {action ? <Text style={styles.sectionAction}>{action}</Text> : null}
    </View>
  );
}

/**
 * Field (Backward compatible)
 */
export function Field({
  label,
  placeholder,
  secureTextEntry = false,
  showPasswordToggle = false,
  value,
  onChangeText,
  keyboardType,
  autoCapitalize = 'sentences',
  multiline = false,
}: {
  label: string;
  placeholder: string;
  secureTextEntry?: boolean;
  showPasswordToggle?: boolean;
  value?: string;
  onChangeText?: (value: string) => void;
  keyboardType?: 'default' | 'email-address';
  autoCapitalize?: 'none' | 'sentences';
  multiline?: boolean;
}) {
  const [isPasswordVisible, setIsPasswordVisible] = React.useState(false);
  const isSecureField = secureTextEntry && !multiline;
  const shouldShowToggle = showPasswordToggle && isSecureField;

  return (
    <RocketInput
      autoCapitalize={autoCapitalize}
      autoCorrect={false}
      iconRight={
        shouldShowToggle ? (
          <Pressable
            accessibilityLabel={isPasswordVisible ? `Hide ${label}` : `Show ${label}`}
            hitSlop={8}
            onPress={() => setIsPasswordVisible((current) => !current)}>
            <Text style={styles.passwordToggleText}>
              {isPasswordVisible ? 'Hide' : 'Show'}
            </Text>
          </Pressable>
        ) : undefined
      }
      keyboardType={keyboardType}
      label={label}
      multiline={multiline}
      onChangeText={onChangeText}
      placeholder={placeholder}
      secureTextEntry={isSecureField ? !isPasswordVisible : secureTextEntry}
      value={value}
    />
  );
}

/**
 * EmptyState (Backward compatible)
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return <RocketEmptyState action={action} body={body} title={title} />;
}

/**
 * Card (Backward compatible)
 */
export function Card({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  return <RocketCard style={style}>{children}</RocketCard>;
}

/**
 * Styles object for backward compatibility
 */
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 36 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
  },
  brandMarkText: { color: '#FFF', fontSize: 20, fontWeight: '900' },
  brandText: { color: colors.text, fontSize: 25, fontWeight: '800', letterSpacing: -0.8 },
  brandTextCompact: { fontSize: 20 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFF', fontWeight: '800' },
  topBar: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topBarSpacer: { width: 36 },
  topBarRight: { minWidth: 36, alignItems: 'flex-end' },
  screenTitle: { color: colors.text, fontSize: 19, fontWeight: '800' },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.backgroundElement,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { color: colors.text, fontSize: 30, lineHeight: 30, marginTop: -3 },
  primaryButton: {
    minHeight: 54,
    borderRadius: 17,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  primaryButtonText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  outlineButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  outlineButtonText: { color: colors.text },
  pressed: { opacity: 0.75, transform: [{ scale: 0.985 }] },
  disabledButton: { opacity: 0.55 },
  passwordToggleText: { color: colors.accentSecondary, fontSize: 12, fontWeight: '700' },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sectionHeading: { color: colors.text, fontSize: 18, fontWeight: '800' },
  sectionAction: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  field: { gap: 8, marginBottom: 18 },
  fieldLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
  input: {
    height: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundElement,
    color: colors.text,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  multilineInput: { height: 110, paddingTop: 14 },
  card: { backgroundColor: colors.backgroundElement, borderRadius: 22, borderWidth: 1, borderColor: colors.border },
  emptyState: { alignItems: 'center', paddingHorizontal: 30, paddingVertical: 52 },
  emptyIcon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: colors.backgroundSelected,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  emptyIconText: { color: colors.accentSecondary, fontSize: 25 },
  emptyTitle: { color: colors.text, fontSize: 19, fontWeight: '800', marginBottom: 8 },
  emptyBody: { color: colors.textSecondary, textAlign: 'center', lineHeight: 21, fontSize: 14 },
});
