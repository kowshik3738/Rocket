import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, ViewStyle } from 'react-native';
import { useRocketTheme } from '../hooks/useRocketTheme';
import { Radius } from '../tokens/radius';
import { RocketPressable } from './RocketPressable';

export type RocketIconButtonVariant = 'ghost' | 'filled' | 'outline' | 'accent' | 'spark';
export type RocketIconButtonSize = 'sm' | 'md' | 'lg';

export interface RocketIconButtonProps {
  onPress?: () => void;
  icon?: React.ReactNode;
  glyph?: string;
  variant?: RocketIconButtonVariant;
  size?: RocketIconButtonSize;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  glyphStyle?: StyleProp<TextStyle>;
  accessibilityLabel: string;
  accessibilityHint?: string;
}

const SIZE_MAP: Record<RocketIconButtonSize, { containerSize: number; fontSize: number; radius: number; hitSlop: number }> = {
  sm: { containerSize: 36, fontSize: 18, radius: Radius.sm, hitSlop: 6 },
  md: { containerSize: 44, fontSize: 24, radius: Radius.md, hitSlop: 4 },
  lg: { containerSize: 52, fontSize: 28, radius: Radius.lg, hitSlop: 0 },
};

/**
 * Reusable Icon Button with guaranteed 44dp+ touch targets and spring interaction.
 */
export function RocketIconButton({
  onPress,
  icon,
  glyph,
  variant = 'filled',
  size = 'md',
  disabled = false,
  style,
  glyphStyle,
  accessibilityLabel,
  accessibilityHint,
}: RocketIconButtonProps) {
  const { colors } = useRocketTheme();
  const config = SIZE_MAP[size];

  const variantStyles = (() => {
    switch (variant) {
      case 'ghost':
        return {
          backgroundColor: 'transparent',
          borderWidth: 0,
          color: colors.primaryText,
        };
      case 'outline':
        return {
          backgroundColor: 'transparent',
          borderWidth: 1,
          borderColor: colors.border,
          color: colors.primaryText,
        };
      case 'accent':
        return {
          backgroundColor: colors.primaryAccent,
          borderWidth: 0,
          color: '#FFFFFF',
        };
      case 'spark':
        return {
          backgroundColor: colors.highlight,
          borderWidth: 0,
          color: '#FFFFFF',
        };
      case 'filled':
      default:
        return {
          backgroundColor: colors.surfaceSecondary,
          borderWidth: 1,
          borderColor: colors.borderSubtle,
          color: colors.primaryText,
        };
    }
  })();

  return (
    <RocketPressable
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={config.hitSlop}
      onPress={onPress}
      style={[
        styles.button,
        {
          width: config.containerSize,
          height: config.containerSize,
          borderRadius: config.radius,
          backgroundColor: variantStyles.backgroundColor,
          borderWidth: variantStyles.borderWidth,
          borderColor: variantStyles.borderColor,
        },
        style,
      ]}>
      {icon ? (
        icon
      ) : glyph ? (
        <Text
          style={[
            styles.glyphText,
            {
              fontSize: config.fontSize,
              lineHeight: config.fontSize,
              color: variantStyles.color,
            },
            glyphStyle,
          ]}>
          {glyph}
        </Text>
      ) : null}
    </RocketPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  glyphText: {
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
  },
});
