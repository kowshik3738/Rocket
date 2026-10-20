import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { useRocketTheme } from '../hooks/useRocketTheme';
import { Radius } from '../tokens/radius';
import { SpacingScale } from '../tokens/spacing';

export type RocketBadgeVariant =
  | 'primary'
  | 'secondary'
  | 'highlight'
  | 'success'
  | 'warning'
  | 'emergency'
  | 'neutral';

export type RocketBadgeType = 'pill' | 'dot';
export type RocketBadgeSize = 'sm' | 'md';

export interface RocketBadgeProps {
  label?: string | number;
  variant?: RocketBadgeVariant;
  type?: RocketBadgeType;
  size?: RocketBadgeSize;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}

/**
 * Reusable Badge component for notifications, tags, counts, and status indicators.
 */
export function RocketBadge({
  label,
  variant = 'primary',
  type = 'pill',
  size = 'md',
  style,
  labelStyle,
  accessibilityLabel,
}: RocketBadgeProps) {
  const { colors } = useRocketTheme();

  const variantColors = (() => {
    switch (variant) {
      case 'secondary':
        return { bg: colors.secondaryAccent, text: '#080A11' };
      case 'highlight':
        return { bg: colors.highlight, text: '#FFFFFF' };
      case 'success':
        return { bg: colors.success, text: '#FFFFFF' };
      case 'warning':
        return { bg: colors.warning, text: '#080A11' };
      case 'emergency':
        return { bg: colors.emergency, text: '#FFFFFF' };
      case 'neutral':
        return { bg: colors.surfaceSecondary, text: colors.secondaryText };
      case 'primary':
      default:
        return { bg: colors.primaryAccent, text: '#FFFFFF' };
    }
  })();

  if (type === 'dot') {
    const dotDimension = size === 'sm' ? 6 : 8;
    return (
      <View
        accessibilityLabel={accessibilityLabel || 'Status indicator'}
        accessibilityRole="image"
        style={[
          styles.dot,
          {
            width: dotDimension,
            height: dotDimension,
            borderRadius: dotDimension / 2,
            backgroundColor: variantColors.bg,
          },
          style,
        ]}
      />
    );
  }

  const isSmall = size === 'sm';
  const paddingH = isSmall ? SpacingScale.xs : SpacingScale.sm;
  const paddingV = isSmall ? 2 : 3;
  const fontSize = isSmall ? 10 : 12;

  return (
    <View
      accessibilityLabel={accessibilityLabel || (typeof label === 'string' ? label : undefined)}
      accessibilityRole="text"
      style={[
        styles.pill,
        {
          paddingHorizontal: paddingH,
          paddingVertical: paddingV,
          backgroundColor: variantColors.bg,
        },
        style,
      ]}>
      <Text
        style={[
          styles.labelText,
          {
            fontSize,
            color: variantColors.text,
          },
          labelStyle,
        ]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: Radius.full,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    alignSelf: 'center',
  },
  labelText: {
    fontWeight: '800',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
});
