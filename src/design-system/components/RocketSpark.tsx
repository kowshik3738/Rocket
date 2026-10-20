import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { useRocketTheme } from '../hooks/useRocketTheme';

export interface RocketSparkProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;
  color?: 'accent' | 'secondary' | 'highlight' | 'white' | 'text' | 'textSecondary' | string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

const SparkSizes: Record<string, number> = {
  xs: 12,
  sm: 16,
  md: 22,
  lg: 32,
  xl: 48,
};

/**
 * Rocket Spark Mark - The central celestial spark in the Rocket Orbit visual language.
 */
export function RocketSpark({
  size = 'md',
  color = 'accent',
  style,
  textStyle,
}: RocketSparkProps) {
  const { colors } = useRocketTheme();

  const numericSize = typeof size === 'number' ? size : SparkSizes[size] || 22;

  const resolvedColor = (() => {
    switch (color) {
      case 'accent':
        return colors.primaryAccent;
      case 'secondary':
        return colors.secondaryAccent;
      case 'highlight':
        return colors.highlight;
      case 'white':
        return '#FFFFFF';
      case 'text':
        return colors.primaryText;
      case 'textSecondary':
        return colors.secondaryText;
      default:
        return color;
    }
  })();

  return (
    <View
      style={[
        styles.container,
        { width: numericSize, height: numericSize },
        style,
      ]}
      accessibilityRole="image"
      accessibilityLabel="Rocket spark">
      <Text
        style={[
          styles.sparkText,
          {
            fontSize: numericSize,
            lineHeight: numericSize,
            color: resolvedColor,
          },
          textStyle,
        ]}>
        ✦
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  sparkText: {
    textAlign: 'center',
    includeFontPadding: false,
  },
});
