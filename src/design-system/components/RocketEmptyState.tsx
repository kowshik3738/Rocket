import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useRocketTheme } from '../hooks/useRocketTheme';
import { Radius } from '../tokens/radius';
import { SpacingScale } from '../tokens/spacing';
import { RocketSpark } from './RocketSpark';
import { RocketText } from './RocketText';

export interface RocketEmptyStateProps {
  title: string;
  body: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Foundation Empty State for Rocket.
 * Features the signature orbit spark badge and clear CTA slot.
 */
export function RocketEmptyState({
  title,
  body,
  action,
  icon,
  style,
}: RocketEmptyStateProps) {
  const { colors } = useRocketTheme();

  return (
    <View style={[styles.container, style]}>
      {/* Signature Orbit Icon Container */}
      <View
        style={[
          styles.iconContainer,
          {
            backgroundColor: colors.surfaceSecondary,
            borderColor: colors.borderSubtle,
          },
        ]}>
        {icon ? (
          icon
        ) : (
          <RocketSpark
            color="secondary"
            size="lg"
          />
        )}
      </View>

      <RocketText
        style={styles.title}
        variant="sectionTitle">
        {title}
      </RocketText>

      <RocketText
        color="secondary"
        style={styles.body}
        variant="bodySecondary">
        {body}
      </RocketText>

      {action ? <View style={styles.actionContainer}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SpacingScale.xxxl,
    paddingVertical: SpacingScale.epic,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: Radius.xl,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SpacingScale.lg,
  },
  title: {
    textAlign: 'center',
    marginBottom: SpacingScale.sm,
  },
  body: {
    textAlign: 'center',
    maxWidth: 300,
    lineHeight: 20,
  },
  actionContainer: {
    marginTop: SpacingScale.xl,
    width: '100%',
    maxWidth: 240,
  },
});
