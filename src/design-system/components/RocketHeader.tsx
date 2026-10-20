import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useRocketTheme } from '../hooks/useRocketTheme';
import { SpacingScale } from '../tokens/spacing';
import { RocketIconButton } from './RocketIconButton';
import { RocketText } from './RocketText';

export interface RocketHeaderProps {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  back?: () => void;
  left?: React.ReactNode;
  right?: React.ReactNode;
  borderBottom?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Foundation top app bar / screen header for Rocket.
 */
export function RocketHeader({
  title,
  subtitle,
  onBack,
  back,
  left,
  right,
  borderBottom = false,
  style,
}: RocketHeaderProps) {
  const { colors } = useRocketTheme();
  const handleBack = onBack || back;

  return (
    <View
      style={[
        styles.header,
        borderBottom && {
          borderBottomWidth: 1,
          borderBottomColor: colors.borderSubtle,
        },
        style,
      ]}>
      {/* Left Slot */}
      <View style={styles.leftSlot}>
        {left ? (
          left
        ) : handleBack ? (
          <RocketIconButton
            accessibilityLabel="Go back"
            glyph="‹"
            glyphStyle={styles.backGlyph}
            onPress={handleBack}
            size="md"
            variant="filled"
          />
        ) : (
          <View style={styles.spacer} />
        )}
      </View>

      {/* Center Title Slot */}
      <View style={styles.centerSlot}>
        {title ? (
          <RocketText
            accessibilityRole="header"
            numberOfLines={1}
            style={styles.titleText}
            variant="sectionTitle">
            {title}
          </RocketText>
        ) : null}
        {subtitle ? (
          <RocketText
            color="secondary"
            numberOfLines={1}
            style={styles.subtitleText}
            variant="caption">
            {subtitle}
          </RocketText>
        ) : null}
      </View>

      {/* Right Slot */}
      <View style={styles.rightSlot}>
        {right || <View style={styles.spacer} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SpacingScale.lg,
    paddingVertical: SpacingScale.sm,
  },
  leftSlot: {
    minWidth: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  centerSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SpacingScale.sm,
  },
  rightSlot: {
    minWidth: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  spacer: {
    width: 44,
  },
  titleText: {
    textAlign: 'center',
  },
  subtitleText: {
    textAlign: 'center',
    marginTop: 2,
  },
  backGlyph: {
    fontSize: 28,
    marginTop: -2,
  },
});
