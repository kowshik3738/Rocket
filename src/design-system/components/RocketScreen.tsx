import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ScrollViewProps,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { Edge, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRocketTheme } from '../hooks/useRocketTheme';
import { SpacingScale } from '../tokens/spacing';

export interface RocketScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  keyboardAvoiding?: boolean;
  statusBarStyle?: 'light' | 'dark' | 'auto';
  scrollViewProps?: Omit<ScrollViewProps, 'contentContainerStyle' | 'children'>;
}

/**
 * Foundation screen wrapper for Rocket.
 * Applies the dark cosmic background, safe-area insets, and consistent padding.
 */
export function RocketScreen({
  children,
  scroll = true,
  header,
  footer,
  edges = ['top'],
  style,
  contentContainerStyle,
  keyboardAvoiding = Platform.OS === 'ios',
  statusBarStyle = 'light',
  scrollViewProps,
}: RocketScreenProps) {
  const { colors } = useRocketTheme();

  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[
        styles.scrollContent,
        contentContainerStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      {...scrollViewProps}>
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fixedContent, contentContainerStyle]}>{children}</View>
  );

  return (
    <SafeAreaView
      edges={edges}
      style={[
        styles.screen,
        { backgroundColor: colors.background },
        style,
      ]}>
      <StatusBar style={statusBarStyle} />

      {header ? <View style={styles.headerContainer}>{header}</View> : null}

      {keyboardAvoiding ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardAvoiding}>
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}

      {footer ? <View style={styles.footerContainer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  headerContainer: {
    zIndex: 10,
  },
  keyboardAvoiding: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SpacingScale.xl,
    paddingBottom: SpacingScale.huge,
  },
  fixedContent: {
    flex: 1,
    paddingHorizontal: SpacingScale.xl,
  },
  footerContainer: {
    zIndex: 10,
  },
});
