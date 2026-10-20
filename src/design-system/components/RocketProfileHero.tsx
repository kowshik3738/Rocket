import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useRocketTheme } from '../hooks/useRocketTheme';
import { Radius } from '../tokens/radius';
import { SpacingScale } from '../tokens/spacing';
import { RocketAvatar } from './RocketAvatar';
import { RocketPressable } from './RocketPressable';
import { RocketText } from './RocketText';

export interface ProfileStatItem {
  label: string;
  value: number | string;
  onPress?: () => void;
  accessibilityLabel?: string;
}

export interface RocketProfileHeroProps {
  avatar: {
    initials: string;
    color: string;
    source?: string;
  };
  displayName: string;
  username: string;
  bio?: string | null;
  stats?: ProfileStatItem[];
  actions?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function RocketProfileHero({
  avatar,
  displayName,
  username,
  bio,
  stats,
  actions,
  style,
}: RocketProfileHeroProps) {
  const { colors: _colors } = useRocketTheme();

  return (
    <View style={[styles.heroContainer, style]}>
      {/* Avatar with subtle Rocket Orbit treatment */}
      <View style={styles.avatarWrap}>
        <RocketAvatar
          hasOrbit={true}
          size={88}
          source={avatar.source}
          user={{
            initials: avatar.initials,
            color: avatar.color,
          }}
          accessibilityLabel={`${displayName} profile picture`}
        />
      </View>

      {/* Identity block */}
      <RocketText
        numberOfLines={2}
        style={styles.displayName}
        variant="screenTitle">
        {displayName}
      </RocketText>

      <RocketText
        color="secondary"
        numberOfLines={1}
        style={styles.username}
        variant="bodySecondary">
        @{username}
      </RocketText>

      {/* Bio if exists */}
      {bio ? (
        <RocketText
          color="primary"
          style={styles.bio}
          variant="body">
          {bio}
        </RocketText>
      ) : null}

      {/* Real Stats Row */}
      {stats && stats.length > 0 ? (
        <View style={styles.statsRow}>
          {stats.map((stat, index) => {
            const content = (
              <View style={styles.statContent}>
                <RocketText
                  style={styles.statNumber}
                  variant="sectionTitle">
                  {stat.value}
                </RocketText>
                <RocketText
                  color="secondary"
                  style={styles.statLabel}
                  variant="caption">
                  {stat.label}
                </RocketText>
              </View>
            );

            if (stat.onPress) {
              return (
                <RocketPressable
                  accessibilityHint={`View ${stat.label}`}
                  accessibilityLabel={stat.accessibilityLabel || `${stat.value} ${stat.label}`}
                  accessibilityRole="button"
                  hitSlop={8}
                  key={`${stat.label}-${index}`}
                  onPress={stat.onPress}
                  style={styles.statButton}>
                  {content}
                </RocketPressable>
              );
            }

            return (
              <View key={`${stat.label}-${index}`} style={styles.statItem}>
                {content}
              </View>
            );
          })}
        </View>
      ) : null}

      {/* Actions container */}
      {actions ? <View style={styles.actionsSlot}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  heroContainer: {
    alignItems: 'center',
    paddingTop: SpacingScale.sm,
    paddingBottom: SpacingScale.md,
  },
  avatarWrap: {
    marginBottom: SpacingScale.md,
  },
  displayName: {
    textAlign: 'center',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  username: {
    textAlign: 'center',
    marginTop: 2,
    letterSpacing: 0,
  },
  bio: {
    textAlign: 'center',
    maxWidth: 290,
    marginTop: SpacingScale.md,
    lineHeight: 21,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SpacingScale.xxxl,
    marginTop: SpacingScale.lg,
    paddingVertical: SpacingScale.xs,
  },
  statItem: {
    alignItems: 'center',
    minWidth: 64,
  },
  statButton: {
    alignItems: 'center',
    minWidth: 64,
    borderRadius: Radius.md,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  statContent: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  statLabel: {
    marginTop: 2,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  actionsSlot: {
    width: '100%',
    marginTop: SpacingScale.xl,
  },
});
