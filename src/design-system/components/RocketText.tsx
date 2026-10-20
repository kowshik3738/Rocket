import React from 'react';
import { StyleProp, Text, TextProps, TextStyle } from 'react-native';
import { useRocketTheme } from '../hooks/useRocketTheme';
import { Typography, TypographyVariant } from '../tokens/typography';

export type TextColorVariant =
  | 'primary'
  | 'secondary'
  | 'muted'
  | 'accent'
  | 'secondaryAccent'
  | 'highlight'
  | 'success'
  | 'warning'
  | 'error'
  | 'inverse';

export interface RocketTextProps extends TextProps {
  variant?: TypographyVariant;
  color?: TextColorVariant | string;
  style?: StyleProp<TextStyle>;
  children?: React.ReactNode;
}

/**
 * Rocket Typography Component
 *
 * Enforces brand typography hierarchy with high-contrast, readable text defaults.
 */
export function RocketText({
  variant = 'body',
  color = 'primary',
  style,
  children,
  ...rest
}: RocketTextProps) {
  const { colors } = useRocketTheme();

  const resolvedColor = (() => {
    switch (color) {
      case 'primary':
        return colors.primaryText;
      case 'secondary':
        return colors.secondaryText;
      case 'muted':
        return colors.mutedText;
      case 'accent':
        return colors.primaryAccent;
      case 'secondaryAccent':
        return colors.secondaryAccent;
      case 'highlight':
        return colors.highlight;
      case 'success':
        return colors.success;
      case 'warning':
        return colors.warning;
      case 'error':
        return colors.error;
      case 'inverse':
        return colors.textInverse;
      default:
        return color;
    }
  })();

  const variantStyle = Typography[variant] || Typography.body;

  return (
    <Text
      style={[
        variantStyle,
        { color: resolvedColor },
        style,
      ]}
      {...rest}>
      {children}
    </Text>
  );
}
