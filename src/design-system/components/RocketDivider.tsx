import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { useRocketTheme } from '../hooks/useRocketTheme';
import { SpacingScale } from '../tokens/spacing';

export type RocketDividerSpacing = 'none' | 'sm' | 'md' | 'lg';

export interface RocketDividerProps {
  label?: string;
  spacing?: RocketDividerSpacing;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}

const SPACING_MAP: Record<RocketDividerSpacing, number> = {
  none: 0,
  sm: SpacingScale.sm,
  md: SpacingScale.lg,
  lg: SpacingScale.xxl,
};

/**
 * Reusable Divider component with optional centered text.
 */
export function RocketDivider({
  label,
  spacing = 'md',
  style,
  labelStyle,
}: RocketDividerProps) {
  const { colors } = useRocketTheme();
  const marginV = SPACING_MAP[spacing];

  if (label) {
    return (
      <View
        accessibilityRole="none"
        style={[
          styles.containerWithLabel,
          { marginVertical: marginV },
          style,
        ]}>
        <View
          style={[
            styles.line,
            { backgroundColor: colors.borderSubtle },
          ]}
        />
        <Text
          style={[
            styles.label,
            { color: colors.secondaryText },
            labelStyle,
          ]}>
          {label}
        </Text>
        <View
          style={[
            styles.line,
            { backgroundColor: colors.borderSubtle },
          ]}
        />
      </View>
    );
  }

  return (
    <View
      accessibilityRole="none"
      style={[
        styles.simpleLine,
        {
          backgroundColor: colors.borderSubtle,
          marginVertical: marginV,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  simpleLine: {
    height: 1,
    width: '100%',
  },
  containerWithLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  line: {
    flex: 1,
    height: 1,
  },
  label: {
    paddingHorizontal: SpacingScale.md,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});
