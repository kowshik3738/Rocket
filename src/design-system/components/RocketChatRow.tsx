import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { ImageSource } from 'expo-image';
import { useRocketTheme } from '../hooks/useRocketTheme';
import { Radius } from '../tokens/radius';
import { SpacingScale } from '../tokens/spacing';
import { RocketAvatar, RocketAvatarStatus } from './RocketAvatar';
import { RocketBadge } from './RocketBadge';
import { RocketPressable } from './RocketPressable';
import { RocketText } from './RocketText';

export type DeliveryStatus = 'sending' | 'sent' | 'delivered' | 'seen';

export interface RocketChatRowProps {
  id: string;
  title: string;
  subtitle?: string;
  preview?: string;
  time?: string;
  avatarUser?: { initials: string; color: string };
  avatarSource?: string | ImageSource;
  avatarColor?: string;
  isGroup?: boolean;
  onPress: () => void;
  onLongPress?: () => void;

  // Prepared future states (only rendered when real data is provided)
  status?: RocketAvatarStatus;
  unreadCount?: number;
  isTyping?: boolean;
  typingText?: string;
  isPinned?: boolean;
  isMuted?: boolean;
  deliveryStatus?: DeliveryStatus;
  showSeparator?: boolean;

  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

/**
 * Premium Rocket Orbit Chat Row
 *
 * Designed with high contrast, spacious typography, subtle separators,
 * and snappy native press feedback without clunky outer card borders.
 */
export function RocketChatRow({
  id: _id,
  title,
  subtitle,
  preview,
  time,
  avatarUser,
  avatarSource,
  avatarColor,
  isGroup = false,
  onPress,
  onLongPress,
  status,
  unreadCount,
  isTyping = false,
  typingText = 'typing...',
  isPinned = false,
  isMuted = false,
  deliveryStatus,
  showSeparator = true,
  style,
  accessibilityLabel,
  accessibilityHint,
}: RocketChatRowProps) {
  const { colors } = useRocketTheme();

  const resolvedAccessibilityLabel =
    accessibilityLabel ||
    `${title}${subtitle ? `, ${subtitle}` : ''}${preview ? `, ${preview}` : ''}${time ? `, ${time}` : ''}`;

  return (
    <View style={styles.container}>
      <RocketPressable
        accessibilityHint={
          accessibilityHint || (isGroup ? 'Open group conversation' : 'Open direct conversation')
        }
        accessibilityLabel={resolvedAccessibilityLabel}
        accessibilityRole="button"
        contentContainerStyle={styles.pressableContent}
        onLongPress={onLongPress}
        onPress={onPress}
        pressScale={0.985}
        pressedStyle={{ backgroundColor: colors.surfaceSecondary }}
        style={[styles.row, style]}>
        {/* Avatar */}
        <View style={styles.avatarWrap}>
          <RocketAvatar
            color={avatarColor}
            size={50}
            source={avatarSource}
            status={status}
            user={avatarUser}
          />
          {isGroup ? (
            <View
              style={[
                styles.groupIndicatorBadge,
                {
                  backgroundColor: colors.surfaceSecondary,
                  borderColor: colors.background,
                },
              ]}>
              <Text style={[styles.groupIndicatorGlyph, { color: colors.secondaryAccent }]}>
                👥
              </Text>
            </View>
          ) : null}
        </View>

        {/* Info Column */}
        <View style={styles.infoCol}>
          {/* Top Line: Title + Subtitle + Timestamp */}
          <View style={styles.topLine}>
            <View style={styles.titleWrap}>
              <RocketText
                color="primary"
                numberOfLines={1}
                style={styles.titleText}
                variant="bodyMedium">
                {title}
              </RocketText>

              {subtitle ? (
                <RocketText
                  color="muted"
                  numberOfLines={1}
                  style={styles.subtitleText}
                  variant="caption">
                  {subtitle}
                </RocketText>
              ) : null}

              {isPinned ? (
                <Text style={[styles.statusGlyph, { color: colors.primaryAccent }]}>📌</Text>
              ) : null}

              {isMuted ? (
                <Text style={[styles.statusGlyph, { color: colors.mutedText }]}>🔇</Text>
              ) : null}
            </View>

            {time ? (
              <RocketText
                color={unreadCount && unreadCount > 0 ? 'accent' : 'muted'}
                style={styles.timeText}
                variant="caption">
                {time}
              </RocketText>
            ) : null}
          </View>

          {/* Bottom Line: Preview / Typing + Unread Badge */}
          <View style={styles.bottomLine}>
            <View style={styles.previewWrap}>
              {deliveryStatus ? (
                <Text
                  style={[
                    styles.deliveryGlyph,
                    {
                      color:
                        deliveryStatus === 'seen'
                          ? colors.secondaryAccent
                          : colors.mutedText,
                    },
                  ]}>
                  {deliveryStatus === 'seen' || deliveryStatus === 'delivered' ? '✓✓' : '✓'}
                </Text>
              ) : null}

              {isTyping ? (
                <RocketText
                  color="accent"
                  numberOfLines={1}
                  style={styles.typingText}
                  variant="bodySecondary">
                  {typingText}
                </RocketText>
              ) : (
                <RocketText
                  color={unreadCount && unreadCount > 0 ? 'primary' : 'secondary'}
                  numberOfLines={1}
                  style={[
                    styles.previewText,
                    unreadCount != null && unreadCount > 0 ? styles.unreadPreviewText : null,
                  ]}
                  variant="bodySecondary">
                  {preview}
                </RocketText>
              )}
            </View>

            {unreadCount && unreadCount > 0 ? (
              <RocketBadge
                label={unreadCount > 99 ? '99+' : unreadCount}
                size="sm"
                variant="primary"
              />
            ) : null}
          </View>
        </View>
      </RocketPressable>

      {/* Subtle Inset Separator */}
      {showSeparator ? (
        <View
          style={[
            styles.separator,
            { backgroundColor: colors.borderSubtle },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    position: 'relative',
  },
  row: {
    width: '100%',
    minHeight: 72,
    paddingHorizontal: SpacingScale.lg,
    paddingVertical: SpacingScale.md,
    justifyContent: 'center',
  },
  pressableContent: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  avatarWrap: {
    position: 'relative',
    width: 50,
    height: 50,
    marginRight: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupIndicatorBadge: {
    position: 'absolute',
    bottom: -2,
    right: -4,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    paddingHorizontal: 3,
    paddingVertical: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupIndicatorGlyph: {
    fontSize: 10,
    includeFontPadding: false,
  },
  infoCol: {
    flex: 1,
    justifyContent: 'center',
  },
  topLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: SpacingScale.sm,
    gap: 6,
  },
  titleText: {
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: -0.2,
  },
  subtitleText: {
    fontSize: 12,
    letterSpacing: 0,
  },
  statusGlyph: {
    fontSize: 11,
  },
  timeText: {
    fontSize: 11,
    letterSpacing: 0.1,
  },
  bottomLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: SpacingScale.sm,
    gap: 4,
  },
  previewText: {
    fontSize: 13,
    lineHeight: 18,
  },
  unreadPreviewText: {
    fontWeight: '600',
  },
  typingText: {
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  deliveryGlyph: {
    fontSize: 12,
    fontWeight: '700',
  },
  separator: {
    position: 'absolute',
    bottom: 0,
    left: 80,
    right: SpacingScale.lg,
    height: 1,
  },
});
