import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Radius, RocketPressable, RocketText, SpacingScale, useRocketTheme } from '@/design-system';

export interface RocketChatActionSheetProps {
  visible: boolean;
  onClose: () => void;
  chatTitle: string;
  isPinned: boolean;
  isArchived: boolean;
  isMuted: boolean;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onToggleMute: () => void;
  onDeleteChat: () => void;
}

export function RocketChatActionSheet({
  visible,
  onClose,
  chatTitle,
  isPinned,
  isArchived,
  isMuted,
  onTogglePin,
  onToggleArchive,
  onToggleMute,
  onDeleteChat,
}: RocketChatActionSheetProps) {
  const { colors } = useRocketTheme();

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}>
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceSecondary,
              borderColor: colors.borderSubtle,
            },
          ]}>
          {/* Header with target chat title */}
          <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
            <RocketText
              color="muted"
              numberOfLines={1}
              style={styles.headerTitle}
              variant="caption">
              {chatTitle}
            </RocketText>
          </View>

          {/* Action List */}
          <View style={styles.actionsCol}>
            {/* Pin / Unpin */}
            <RocketPressable
              accessibilityLabel={isPinned ? 'Unpin chat' : 'Pin chat'}
              accessibilityRole="button"
              onPress={() => {
                onClose();
                onTogglePin();
              }}
              pressedStyle={{ backgroundColor: colors.surface }}
              style={styles.actionRow}>
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: colors.surface, borderColor: colors.borderSubtle },
                ]}>
                <Text style={styles.actionGlyph}>📌</Text>
              </View>
              <View style={styles.actionTextWrap}>
                <RocketText color="primary" variant="bodyMedium">
                  {isPinned ? 'Unpin chat' : 'Pin chat'}
                </RocketText>
                <RocketText color="muted" variant="caption">
                  {isPinned
                    ? 'Return to normal chronological list'
                    : 'Keep this chat at the top of your inbox'}
                </RocketText>
              </View>
            </RocketPressable>

            {/* Mute / Unmute */}
            <RocketPressable
              accessibilityLabel={isMuted ? 'Unmute chat' : 'Mute chat'}
              accessibilityRole="button"
              onPress={() => {
                onClose();
                onToggleMute();
              }}
              pressedStyle={{ backgroundColor: colors.surface }}
              style={styles.actionRow}>
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: colors.surface, borderColor: colors.borderSubtle },
                ]}>
                <Text style={styles.actionGlyph}>{isMuted ? '🔔' : '🔇'}</Text>
              </View>
              <View style={styles.actionTextWrap}>
                <RocketText color="primary" variant="bodyMedium">
                  {isMuted ? 'Unmute chat' : 'Mute chat'}
                </RocketText>
                <RocketText color="muted" variant="caption">
                  {isMuted
                    ? 'Restore sound and banner notifications'
                    : 'Silence alerts from this conversation'}
                </RocketText>
              </View>
            </RocketPressable>

            {/* Archive / Unarchive */}
            <RocketPressable
              accessibilityLabel={isArchived ? 'Unarchive chat' : 'Archive chat'}
              accessibilityRole="button"
              onPress={() => {
                onClose();
                onToggleArchive();
              }}
              pressedStyle={{ backgroundColor: colors.surface }}
              style={styles.actionRow}>
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: colors.surface, borderColor: colors.borderSubtle },
                ]}>
                <Text style={styles.actionGlyph}>{isArchived ? '📥' : '📦'}</Text>
              </View>
              <View style={styles.actionTextWrap}>
                <RocketText color="primary" variant="bodyMedium">
                  {isArchived ? 'Unarchive chat' : 'Archive chat'}
                </RocketText>
                <RocketText color="muted" variant="caption">
                  {isArchived
                    ? 'Move back to your active messages'
                    : 'Hide from inbox without deleting messages'}
                </RocketText>
              </View>
            </RocketPressable>

            {/* Delete chat */}
            <RocketPressable
              accessibilityLabel="Delete chat"
              accessibilityRole="button"
              onPress={() => {
                onClose();
                onDeleteChat();
              }}
              pressedStyle={{ backgroundColor: colors.surface }}
              style={[styles.actionRow, styles.deleteActionRow]}>
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: colors.surface, borderColor: colors.borderSubtle },
                ]}>
                <Text style={styles.actionGlyph}>🗑️</Text>
              </View>
              <View style={styles.actionTextWrap}>
                <RocketText color="primary" variant="bodyMedium">
                  Delete chat
                </RocketText>
                <RocketText color="muted" variant="caption">
                  Remove this chat from your view. Other people&apos;s messages stay intact.
                </RocketText>
              </View>
            </RocketPressable>
          </View>

          {/* Cancel button */}
          <RocketPressable
            accessibilityLabel="Cancel"
            accessibilityRole="button"
            onPress={onClose}
            pressedStyle={{ backgroundColor: colors.surfaceSecondary }}
            style={[
              styles.cancelRow,
              { borderTopColor: colors.borderSubtle, backgroundColor: colors.surface },
            ]}>
            <RocketText color="muted" variant="buttonSmall">
              Cancel
            </RocketText>
          </RocketPressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
    padding: SpacingScale.md,
    paddingBottom: 34,
  },
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    paddingHorizontal: SpacingScale.lg,
    paddingVertical: SpacingScale.sm,
    borderBottomWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontWeight: '600',
    textAlign: 'center',
  },
  actionsCol: {
    paddingVertical: SpacingScale.xs,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SpacingScale.lg,
    paddingVertical: SpacingScale.sm + 2,
    gap: SpacingScale.md,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionGlyph: {
    fontSize: 18,
  },
  actionTextWrap: {
    flex: 1,
    gap: 2,
  },
  deleteActionRow: {
    borderTopWidth: 0,
  },
  cancelRow: {
    paddingVertical: SpacingScale.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
  },
});
