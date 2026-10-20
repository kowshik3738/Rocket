import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useRocketTheme } from '../hooks/useRocketTheme';
import { Radius } from '../tokens/radius';
import { SpacingScale } from '../tokens/spacing';

export interface RocketBrandProps {
  compact?: boolean;
  showSpark?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Rocket Brand Mark and Logotype
 */
export function RocketBrand({
  compact = false,
  showSpark = false,
  style,
}: RocketBrandProps) {
  const { colors } = useRocketTheme();

  return (
    <View style={[styles.brand, style]}>
      <View
        style={[
          styles.brandMark,
          {
            backgroundColor: colors.primaryAccent,
          },
        ]}>
        <Text style={styles.brandMarkText}>R</Text>
      </View>
      <View style={styles.textWrap}>
        <Text
          style={[
            styles.brandText,
            { color: colors.primaryText },
            compact && styles.brandTextCompact,
          ]}>
          rocket
        </Text>
        {showSpark ? (
          <Text
            style={[
              styles.sparkMark,
              { color: colors.highlight },
            ]}>
            ✦
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.sm + 1,
  },
  brandMark: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
  },
  brandMarkText: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '900',
  },
  textWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },
  brandText: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  brandTextCompact: {
    fontSize: 20,
  },
  sparkMark: {
    fontSize: 12,
  },
});
