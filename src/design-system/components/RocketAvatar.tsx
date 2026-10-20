import React, { useEffect, useState } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Image, ImageSource } from 'expo-image';
import { useRocketTheme } from '../hooks/useRocketTheme';
import { Radius } from '../tokens/radius';

export type RocketAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
export type RocketAvatarStatus = 'online' | 'offline' | 'busy' | 'in-call';

export interface RocketAvatarProps {
  // Backward-compatible prop object
  user?: {
    initials: string;
    color: string;
  };
  source?: string | ImageSource;
  initials?: string;
  name?: string;
  color?: string;
  size?: RocketAvatarSize | number;
  status?: RocketAvatarStatus;
  hasOrbit?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

const AVATAR_SIZES: Record<RocketAvatarSize, number> = {
  xs: 28,
  sm: 36,
  md: 48,
  lg: 56,
  xl: 72,
  xxl: 96,
};

/**
 * Reusable Avatar component for Rocket.
 * Supports image avatars, initials fallback, status badges, and orbit rings.
 */
export function RocketAvatar({
  user,
  source,
  initials,
  name,
  color,
  size = 'md',
  status,
  hasOrbit = false,
  style,
  accessibilityLabel,
}: RocketAvatarProps) {
  const { colors } = useRocketTheme();
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [source]);

  const numericSize =
    typeof size === 'number' ? size : AVATAR_SIZES[size] || AVATAR_SIZES.md;

  // Resolve initials
  const resolvedInitials =
    user?.initials ||
    initials ||
    (name
      ? name
          .split(' ')
          .map((n) => n[0])
          .slice(0, 2)
          .join('')
          .toUpperCase()
      : 'R');

  // Resolve background color
  const resolvedBgColor =
    user?.color || color || colors.surfaceSecondary;

  const statusDotSize = Math.max(10, Math.round(numericSize * 0.28));
  const statusBorderWidth = Math.max(2, Math.round(numericSize * 0.05));

  const statusColor = (() => {
    switch (status) {
      case 'online':
        return colors.online;
      case 'busy':
        return colors.warning;
      case 'in-call':
        return colors.primaryAccent;
      case 'offline':
        return colors.mutedText;
      default:
        return undefined;
    }
  })();

  const orbitPadding = hasOrbit ? Math.max(3, Math.round(numericSize * 0.06)) : 0;
  const orbitSize = numericSize + orbitPadding * 2 + 4;

  const content = (
    <View
      style={[
        styles.avatarContainer,
        {
          width: numericSize,
          height: numericSize,
          borderRadius: numericSize / 2,
          backgroundColor: resolvedBgColor,
        },
      ]}>
      {source && !imageFailed ? (
        <Image
          contentFit="cover"
          onError={() => setImageFailed(true)}
          source={source}
          style={[
            styles.image,
            {
              width: numericSize,
              height: numericSize,
              borderRadius: numericSize / 2,
            },
          ]}
        />
      ) : null}
      {!source || imageFailed ? (
        <Text
          style={[
            styles.initialsText,
            {
              fontSize: numericSize * 0.36,
              lineHeight: numericSize * 0.36,
            },
          ]}>
          {resolvedInitials}
        </Text>
      ) : null}

      {/* Online / Status Dot */}
      {statusColor ? (
        <View
          style={[
            styles.statusDot,
            {
              width: statusDotSize,
              height: statusDotSize,
              borderRadius: statusDotSize / 2,
              backgroundColor: statusColor,
              borderWidth: statusBorderWidth,
              borderColor: colors.background,
              bottom: 0,
              right: 0,
            },
          ]}
        />
      ) : null}
    </View>
  );

  if (hasOrbit) {
    return (
      <View
        accessibilityLabel={accessibilityLabel || name || `Avatar ${resolvedInitials}`}
        accessibilityRole="image"
        style={[
          styles.orbitWrapper,
          {
            width: orbitSize,
            height: orbitSize,
            borderRadius: orbitSize / 2,
            borderColor: colors.primaryAccent,
          },
          style,
        ]}>
        {content}
      </View>
    );
  }

  return (
    <View
      accessibilityLabel={accessibilityLabel || name || `Avatar ${resolvedInitials}`}
      accessibilityRole="image"
      style={style}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  orbitWrapper: {
    borderWidth: 2,
    borderStyle: 'solid',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
    position: 'relative',
  },
  image: {
    position: 'absolute',
  },
  initialsText: {
    color: '#FFFFFF',
    fontWeight: '800',
    textAlign: 'center',
    includeFontPadding: false,
  },
  statusDot: {
    position: 'absolute',
  },
});
