import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { useRocketTheme } from '../hooks/useRocketTheme';
import { Radius } from '../tokens/radius';
import { SpacingScale } from '../tokens/spacing';
import { RocketPressable } from './RocketPressable';
import { RocketLoadingIndicator } from './RocketLoadingIndicator';

export type RocketButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'spark'
  | 'emergency'
  | 'accent'; // backward-compatible alias for primary

export type RocketButtonSize = 'sm' | 'md' | 'lg';

export interface RocketButtonProps {
  label: string;
  onPress?: () => void;
  variant?: RocketButtonVariant;
  size?: RocketButtonSize;
  disabled?: boolean;
  loading?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

const SIZE_CONFIG: Record<
  RocketButtonSize,
  {
    minHeight: number;
    paddingHorizontal: number;
    fontSize: number;
    radius: number;
    gap: number;
  }
> = {
  sm: { minHeight: 38, paddingHorizontal: 14, fontSize: 13, radius: Radius.md, gap: 6 },
  md: { minHeight: 48, paddingHorizontal: 18, fontSize: 15, radius: Radius.md, gap: 8 },
  lg: { minHeight: 54, paddingHorizontal: 22, fontSize: 16, radius: Radius.lg, gap: 10 },
};

/**
 * Foundation button component for Rocket.
 * Snappy spring feedback, accessibility support, and orbit loading states.
 */
export function RocketButton({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  disabled = false,
  loading = false,
  iconLeft,
  iconRight,
  fullWidth = true,
  style,
  labelStyle,
  accessibilityLabel,
  accessibilityHint,
}: RocketButtonProps) {
  const { colors } = useRocketTheme();
  const config = SIZE_CONFIG[size];
  const isActionDisabled = disabled || loading;

  const normalizedVariant = variant === 'accent' ? 'primary' : variant;

  const variantColors = (() => {
    switch (normalizedVariant) {
      case 'secondary':
        return {
          bg: colors.surfaceSecondary,
          border: colors.borderSubtle,
          text: colors.secondaryAccent,
          loaderColor: colors.secondaryAccent,
        };
      case 'outline':
        return {
          bg: 'transparent',
          border: colors.border,
          text: colors.primaryText,
          loaderColor: colors.primaryText,
        };
      case 'ghost':
        return {
          bg: 'transparent',
          border: 'transparent',
          text: colors.primaryText,
          loaderColor: colors.primaryText,
        };
      case 'spark':
        return {
          bg: colors.highlight,
          border: colors.highlight,
          text: '#FFFFFF',
          loaderColor: '#FFFFFF',
        };
      case 'emergency':
        return {
          bg: colors.emergency,
          border: colors.emergency,
          text: '#FFFFFF',
          loaderColor: '#FFFFFF',
        };
      case 'primary':
      default:
        return {
          bg: colors.primaryAccent,
          border: colors.primaryAccent,
          text: '#FFFFFF',
          loaderColor: '#FFFFFF',
        };
    }
  })();

  return (
    <RocketPressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel || label}
      accessibilityRole="button"
      accessibilityState={{ disabled: isActionDisabled, busy: loading }}
      disabled={isActionDisabled}
      onPress={onPress}
      style={[
        styles.buttonBase,
        {
          minHeight: config.minHeight,
          paddingHorizontal: config.paddingHorizontal,
          borderRadius: config.radius,
          backgroundColor: variantColors.bg,
          borderColor: variantColors.border,
          borderWidth: 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}>
      {loading ? (
        <View style={styles.loadingContainer}>
          <RocketLoadingIndicator
            accessibilityLabel={`Loading ${label}`}
            color={variantColors.loaderColor}
            size="small"
            sparkColor={variantColors.loaderColor}
          />
        </View>
      ) : (
        <View style={[styles.contentRow, { gap: config.gap }]}>
          {iconLeft ? <View style={styles.iconSlot}>{iconLeft}</View> : null}
          <Text
            style={[
              styles.labelText,
              {
                fontSize: config.fontSize,
                color: variantColors.text,
              },
              labelStyle,
            ]}>
            {label}
          </Text>
          {iconRight ? <View style={styles.iconSlot}>{iconRight}</View> : null}
        </View>
      )}
    </RocketPressable>
  );
}

const styles = StyleSheet.create({
  buttonBase: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSlot: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  labelText: {
    fontWeight: '800',
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  loadingContainer: {
    paddingVertical: SpacingScale.xs,
  },
});
