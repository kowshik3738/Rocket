import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useRocketTheme } from '../hooks/useRocketTheme';
import { Radius } from '../tokens/radius';
import { SpacingScale } from '../tokens/spacing';
import { RocketAvatar, RocketAvatarStatus } from './RocketAvatar';
import { RocketPressable } from './RocketPressable';
import { RocketText } from './RocketText';

export interface RocketUserRowProps {
  id: string;
  displayName: string;
  username: string;
  avatarUser?: { initials: string; color: string };
  avatarSource?: string;
  avatarColor?: string;
  subtitle?: string;
  status?: RocketAvatarStatus; // Prepared future presence (not faked)
  onPress?: () => void;
  trailingAction?: React.ReactNode;
  showSeparator?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export function RocketUserRow({
  id: _id,
  displayName,
  username,
  avatarUser,
  avatarSource,
  avatarColor,
  subtitle,
  status,
  onPress,
  trailingAction,
  showSeparator = false,
  disabled = false,
  style,
  accessibilityLabel,
  accessibilityHint,
}: RocketUserRowProps) {
  const { colors } = useRocketTheme();

  const userContent = (
    <View style={styles.mainContent}>
      {/* Avatar */}
      <View style={styles.avatarWrap}>
        <RocketAvatar
          color={avatarColor}
          hasOrbit={false}
          size={48}
          source={avatarSource}
          status={status}
          user={avatarUser}
        />
      </View>

      {/* Info Column */}
      <View style={styles.infoCol}>
        <RocketText
          color="primary"
          numberOfLines={1}
          style={styles.nameText}
          variant="bodyMedium">
          {displayName}
        </RocketText>
        {username ? (
          <RocketText
            color="secondary"
            numberOfLines={1}
            style={styles.usernameText}
            variant="caption">
            @{username}
          </RocketText>
        ) : null}
        {subtitle ? (
          <RocketText
            color="muted"
            numberOfLines={1}
            style={styles.subtitleText}
            variant="caption">
            {subtitle}
          </RocketText>
        ) : null}
      </View>
    </View>
  );

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderColor: colors.borderSubtle,
        },
        showSeparator && {
          borderBottomWidth: 1,
          borderBottomColor: colors.borderSubtle,
        },
        style,
      ]}>
      {onPress ? (
        <RocketPressable
          accessibilityHint={accessibilityHint || `View @${username}'s profile`}
          accessibilityLabel={accessibilityLabel || `${displayName}, @${username}`}
          accessibilityRole="button"
          disabled={disabled}
          hitSlop={4}
          onPress={onPress}
          pressScale={0.985}
          pressedStyle={{ backgroundColor: colors.surfaceSecondary }}
          style={styles.pressableArea}>
          {userContent}
        </RocketPressable>
      ) : (
        <View style={styles.pressableArea}>{userContent}</View>
      )}

      {trailingAction ? (
        <View style={styles.trailingActionContainer}>{trailingAction}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SpacingScale.sm + 2,
    paddingHorizontal: SpacingScale.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    marginBottom: SpacingScale.sm,
  },
  pressableArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: SpacingScale.sm,
    borderRadius: Radius.md,
  },
  mainContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.md,
  },
  avatarWrap: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoCol: {
    flex: 1,
    justifyContent: 'center',
  },
  nameText: {
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  usernameText: {
    marginTop: 2,
  },
  subtitleText: {
    marginTop: 2,
  },
  trailingActionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.xs,
  },
});
