import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  Radius,
  RocketAvatar,
  RocketButton,
  RocketIconButton,
  RocketLoadingIndicator,
  RocketPressable,
  RocketText,
  SpacingScale,
  useRocketTheme,
} from '@/design-system';
import {
  ForwardableMessagePayload,
  ForwardDestination,
  forwardMessageToDestinations,
  getForwardDestinations,
  MAX_FORWARD_DESTINATIONS,
} from '@/services/forwarding-service';

export interface RocketForwardPickerModalProps {
  visible: boolean;
  onClose: () => void;
  currentUid: string;
  payload: ForwardableMessagePayload | null;
  onSuccess?: (summary: string) => void;
}

export function RocketForwardPickerModal({
  visible,
  onClose,
  currentUid,
  payload,
  onSuccess,
}: RocketForwardPickerModalProps) {
  const { colors } = useRocketTheme();

  const [destinations, setDestinations] = useState<ForwardDestination[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible || !currentUid) {
      setSelectedIds(new Set());
      setSearchQuery('');
      setError('');
      setIsSubmitting(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError('');

    void getForwardDestinations(currentUid)
      .then((items) => {
        if (!active) return;
        setDestinations(items);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Could not load destinations.');
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [visible, currentUid]);

  const filteredDestinations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return destinations;
    return destinations.filter(
      (d) =>
        d.title.toLowerCase().includes(q) || d.subtitle.toLowerCase().includes(q)
    );
  }, [destinations, searchQuery]);

  const toggleSelect = (id: string) => {
    if (isSubmitting) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setError('');
      } else {
        if (next.size >= MAX_FORWARD_DESTINATIONS) {
          setError(`You can forward to at most ${MAX_FORWARD_DESTINATIONS} chats at a time.`);
          return prev;
        }
        next.add(id);
        setError('');
      }
      return next;
    });
  };

  const handleForward = async () => {
    if (!payload || selectedIds.size === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setError('');

    const targetDestinations = destinations.filter((d) => selectedIds.has(d.id));

    try {
      const result = await forwardMessageToDestinations(
        currentUid,
        payload,
        targetDestinations
      );

      if (result.failCount > 0) {
        if (result.successCount === 0) {
          setError(result.errors[0] || 'Failed to forward message.');
          setIsSubmitting(false);
          return;
        } else {
          // Partial success
          onClose();
          onSuccess?.(`Forwarded to ${result.successCount} of ${result.total} chats`);
        }
      } else {
        // Complete success
        onClose();
        onSuccess?.(
          result.total === 1 ? 'Message forwarded' : `Forwarded to ${result.total} chats`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not forward message.');
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={isSubmitting ? undefined : onClose}
      transparent
      visible={visible}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalBackdrop}>
        <Pressable
          onPress={isSubmitting ? undefined : onClose}
          style={styles.modalBackdropInner}>
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceSecondary,
                borderColor: colors.borderSubtle,
              },
            ]}>
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
              <View style={styles.headerTitleWrap}>
                <RocketText style={styles.headerTitle} variant="bodyMedium">
                  Forward message
                </RocketText>
                <RocketText color="muted" variant="caption">
                  {selectedIds.size > 0
                    ? `${selectedIds.size} of ${MAX_FORWARD_DESTINATIONS} selected`
                    : `Select up to ${MAX_FORWARD_DESTINATIONS} chats`}
                </RocketText>
              </View>
              <RocketIconButton
                accessibilityLabel="Close forward picker"
                disabled={isSubmitting}
                glyph="✕"
                glyphStyle={styles.closeGlyph}
                onPress={onClose}
                size="sm"
                variant="ghost"
              />
            </View>

            {/* Search Input */}
            <View
              style={[
                styles.searchWrap,
                {
                  backgroundColor: colors.surface,
                  borderColor: searchQuery.length > 0 ? colors.borderFocus : colors.borderSubtle,
                },
              ]}>
              <Text style={[styles.searchIcon, { color: colors.mutedText }]}>🔍</Text>
              <TextInput
                accessibilityHint="Type to filter chats and friends"
                accessibilityLabel="Search forward destinations"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Search chats and friends…"
                placeholderTextColor={colors.mutedText}
                style={[styles.searchInput, { color: colors.text }]}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 ? (
                <RocketIconButton
                  accessibilityLabel="Clear destination search"
                  glyph="✕"
                  glyphStyle={styles.clearSearchGlyph}
                  onPress={() => setSearchQuery('')}
                  size="sm"
                  variant="ghost"
                />
              ) : null}
            </View>

            {/* Error Banner */}
            {error ? (
              <View style={[styles.errorBanner, { backgroundColor: colors.surfaceTertiary }]}>
                <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
              </View>
            ) : null}

            {/* Content List */}
            {loading ? (
              <View style={styles.loadingWrap}>
                <RocketLoadingIndicator size="normal" />
                <RocketText color="secondary" style={styles.loadingText} variant="caption">
                  Loading chats…
                </RocketText>
              </View>
            ) : filteredDestinations.length === 0 ? (
              <View style={styles.emptyWrap}>
                <RocketText color="muted" variant="bodySecondary">
                  {searchQuery ? 'No matching chats found' : 'No available chats'}
                </RocketText>
              </View>
            ) : (
              <FlatList
                contentContainerStyle={styles.listContent}
                data={filteredDestinations}
                extraData={selectedIds}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => {
                  const isSelected = selectedIds.has(item.id);
                  return (
                    <RocketPressable
                      accessibilityHint="Select or deselect destination"
                      accessibilityLabel={`${item.title}, ${item.subtitle}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isSelected }}
                      disabled={isSubmitting}
                      onPress={() => toggleSelect(item.id)}
                      pressedStyle={{ backgroundColor: colors.surface }}
                      style={[
                        styles.destinationRow,
                        isSelected && {
                          backgroundColor: 'rgba(0, 240, 255, 0.08)',
                        },
                      ]}>
                      {/* Avatar */}
                      <RocketAvatar
                        color={item.color}
                        hasOrbit={false}
                        size={36}
                        source={item.photoUrl}
                        user={{ initials: item.initials, color: item.color }}
                      />

                      {/* Info */}
                      <View style={styles.destinationInfo}>
                        <RocketText
                          numberOfLines={1}
                          style={styles.destinationTitle}
                          variant="bodyMedium">
                          {item.title}
                        </RocketText>
                        <RocketText color="muted" numberOfLines={1} variant="caption">
                          {item.subtitle}
                        </RocketText>
                      </View>

                      {/* Checkbox Badge */}
                      <View
                        style={[
                          styles.checkboxCircle,
                          isSelected
                            ? {
                                backgroundColor: colors.primaryAccent,
                                borderColor: colors.primaryAccent,
                              }
                            : {
                                borderColor: colors.borderSubtle,
                                backgroundColor: 'transparent',
                              },
                        ]}>
                        {isSelected ? <Text style={styles.checkIcon}>✓</Text> : null}
                      </View>
                    </RocketPressable>
                  );
                }}
                style={styles.list}
              />
            )}

            {/* Bottom Actions Bar */}
            <View style={[styles.bottomBar, { borderTopColor: colors.borderSubtle }]}>
              <RocketButton
                disabled={isSubmitting}
                label="Cancel"
                onPress={onClose}
                size="md"
                variant="ghost"
              />
              <RocketButton
                disabled={selectedIds.size === 0 || isSubmitting}
                label={
                  isSubmitting
                    ? 'Forwarding…'
                    : selectedIds.size > 0
                      ? `Forward (${selectedIds.size})`
                      : 'Forward'
                }
                loading={isSubmitting}
                onPress={() => void handleForward()}
                size="md"
                variant="primary"
              />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  modalBackdropInner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SpacingScale.md,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '85%',
    borderRadius: Radius.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SpacingScale.lg,
    paddingVertical: SpacingScale.sm + 2,
    borderBottomWidth: 1,
  },
  headerTitleWrap: {
    gap: 2,
  },
  headerTitle: {
    fontWeight: '700',
  },
  closeGlyph: {
    fontSize: 14,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SpacingScale.md,
    marginTop: SpacingScale.sm,
    marginBottom: SpacingScale.xs,
    paddingHorizontal: SpacingScale.sm + 2,
    borderRadius: Radius.lg,
    borderWidth: 1,
    height: 40,
  },
  searchIcon: {
    fontSize: 13,
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  clearSearchGlyph: {
    fontSize: 12,
  },
  errorBanner: {
    marginHorizontal: SpacingScale.md,
    marginTop: SpacingScale.xs,
    paddingHorizontal: SpacingScale.sm,
    paddingVertical: 6,
    borderRadius: Radius.sm,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  loadingWrap: {
    paddingVertical: SpacingScale.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: SpacingScale.sm,
  },
  emptyWrap: {
    paddingVertical: SpacingScale.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flexGrow: 0,
    maxHeight: 340,
  },
  listContent: {
    paddingVertical: SpacingScale.xs,
  },
  destinationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SpacingScale.lg,
    paddingVertical: SpacingScale.sm,
    gap: SpacingScale.md,
  },
  destinationInfo: {
    flex: 1,
    gap: 1,
  },
  destinationTitle: {
    fontWeight: '600',
  },
  checkboxCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkIcon: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '900',
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SpacingScale.md,
    paddingVertical: SpacingScale.sm + 2,
    borderTopWidth: 1,
  },
});
