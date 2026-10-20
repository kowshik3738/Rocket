import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useRocketTheme } from '../hooks/useRocketTheme';
import { Radius } from '../tokens/radius';
import { SpacingScale } from '../tokens/spacing';
import { Elevation } from '../tokens/elevation';
import { AnimationScales } from '../tokens/animation';
import { RocketPressable } from './RocketPressable';

export type RocketCardVariant = 'default' | 'elevated' | 'glow' | 'outline' | 'interactive';
export type RocketCardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface RocketCardProps {
  children?: React.ReactNode;
  variant?: RocketCardVariant;
  padding?: RocketCardPadding;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

const PADDING_MAP: Record<RocketCardPadding, number> = {
  none: 0,
  sm: SpacingScale.sm,
  md: SpacingScale.lg,
  lg: SpacingScale.xxl,
};

/**
 * Foundation Card component for Rocket.
 * Rounded cosmic surface with Android-optimized elevation.
 */
export function RocketCard({
  children,
  variant = 'default',
  padding = 'md',
  onPress,
  style,
  accessibilityLabel,
  accessibilityHint,
}: RocketCardProps) {
  const { colors } = useRocketTheme();
  const paddingValue = PADDING_MAP[padding];

  const cardStyle = [
    styles.card,
    {
      padding: paddingValue,
      backgroundColor: colors.surface,
      borderColor: colors.border,
    },
    variant === 'elevated' && [
      Elevation.low,
      { backgroundColor: colors.surfaceElevated },
    ],
    variant === 'glow' && {
      borderColor: colors.primaryAccent,
      borderWidth: 1.5,
    },
    variant === 'outline' && {
      backgroundColor: 'transparent',
      borderColor: colors.border,
    },
    style,
  ];

  if (onPress || variant === 'interactive') {
    return (
      <RocketPressable
        accessibilityHint={accessibilityHint}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        onPress={onPress}
        pressScale={AnimationScales.pressedCard}
        style={cardStyle}>
        {children}
      </RocketPressable>
    );
  }

  return <View style={cardStyle}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
});
