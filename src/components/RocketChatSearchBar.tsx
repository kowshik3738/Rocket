import React from 'react';
import {
  Keyboard,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {
  Radius,
  RocketIconButton,
  RocketPressable,
  RocketText,
  SpacingScale,
  useRocketTheme,
} from '@/design-system';

export interface RocketChatSearchBarProps {
  query: string;
  onChangeQuery: (text: string) => void;
  onClose: () => void;
  matchCount: number;
  currentMatchIndex: number;
  onPrevMatch: () => void;
  onNextMatch: () => void;
  placeholder?: string;
  isSearchingOlder?: boolean;
  hasReachedBeginning?: boolean;
  onSearchOlder?: () => void;
  totalLoadedCount?: number;
}

export function RocketChatSearchBar({
  query,
  onChangeQuery,
  onClose,
  matchCount,
  currentMatchIndex,
  onPrevMatch,
  onNextMatch,
  placeholder = 'Search in conversation…',
  isSearchingOlder = false,
  hasReachedBeginning = true,
  onSearchOlder,
  totalLoadedCount = 0,
}: RocketChatSearchBarProps) {
  const { colors } = useRocketTheme();

  const hasQuery = query.trim().length > 0;
  const safeCurrentIndex = matchCount > 0 ? Math.min(Math.max(0, currentMatchIndex), matchCount - 1) : 0;
  const displayIndex = matchCount > 0 ? safeCurrentIndex + 1 : 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Top Search Header Bar */}
      <View
        style={[
          styles.container,
          {
            borderBottomColor: colors.borderSubtle,
            backgroundColor: colors.background,
          },
        ]}>
        {/* Back / Close search mode */}
        <RocketIconButton
          accessibilityHint="Close search mode"
          accessibilityLabel="Close search"
          glyph="‹"
          glyphStyle={styles.backGlyph}
          onPress={() => {
            Keyboard.dismiss();
            onClose();
          }}
          size="sm"
          variant="ghost"
        />

        {/* Input Field */}
        <View
          style={[
            styles.inputWrap,
            {
              backgroundColor: colors.surfaceSecondary,
              borderColor: hasQuery ? colors.borderFocus : colors.borderSubtle,
            },
          ]}>
          <TextInput
            accessibilityHint="Type to search messages"
            accessibilityLabel="Search messages in chat"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            placeholder={placeholder}
            placeholderTextColor={colors.mutedText}
            returnKeyType="search"
            selectionColor={colors.primaryAccent}
            style={[styles.input, { color: colors.text }]}
            value={query}
            onChangeText={onChangeQuery}
          />
          {query.length > 0 ? (
            <RocketIconButton
              accessibilityHint="Clear search text"
              accessibilityLabel="Clear search"
              glyph="✕"
              glyphStyle={styles.clearGlyph}
              onPress={() => onChangeQuery('')}
              size="sm"
              variant="ghost"
            />
          ) : null}
        </View>

        {/* Results counter & navigation */}
        <View style={styles.resultsWrap}>
          {hasQuery ? (
            <RocketText color="muted" style={styles.counterText} variant="caption">
              {matchCount > 0 ? `${displayIndex}/${matchCount}` : '0/0'}
            </RocketText>
          ) : null}

          <View style={styles.arrowsWrap}>
            <RocketIconButton
              accessibilityHint="Go to previous matching message"
              accessibilityLabel="Previous match"
              disabled={matchCount === 0}
              glyph="▲"
              glyphStyle={styles.arrowGlyph}
              onPress={onPrevMatch}
              size="sm"
              variant="ghost"
            />
            <RocketIconButton
              accessibilityHint="Go to next matching message"
              accessibilityLabel="Next match"
              disabled={matchCount === 0}
              glyph="▼"
              glyphStyle={styles.arrowGlyph}
              onPress={onNextMatch}
              size="sm"
              variant="ghost"
            />
          </View>
        </View>
      </View>

      {/* Scope / Older History Helper Strip */}
      {hasQuery ? (
        <View
          style={[
            styles.scopeBar,
            {
              backgroundColor: colors.surface,
              borderBottomColor: colors.borderSubtle,
            },
          ]}>
          <RocketText color="muted" style={styles.scopeText} variant="caption">
            {hasReachedBeginning
              ? `Entire chat history searched (${totalLoadedCount} messages)`
              : isSearchingOlder
                ? 'Searching older messages in history…'
                : `Searched recent ${totalLoadedCount} messages`}
          </RocketText>
          {!hasReachedBeginning && !isSearchingOlder && onSearchOlder ? (
            <RocketPressable
              accessibilityHint="Retrieve the previous batch of older messages from history"
              accessibilityLabel="Search older messages"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onSearchOlder}
              style={styles.searchOlderButton}>
              <RocketText color="accent" style={styles.searchOlderText} variant="caption">
                Search older ✦
              </RocketText>
            </RocketPressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    zIndex: 10,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SpacingScale.sm,
    paddingVertical: SpacingScale.xs,
    borderBottomWidth: 1,
    gap: SpacingScale.xs,
    minHeight: 52,
  },
  backGlyph: {
    fontSize: 26,
    fontWeight: '300',
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
    paddingHorizontal: SpacingScale.sm,
    height: 38,
  },
  input: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
    includeFontPadding: false,
  },
  clearGlyph: {
    fontSize: 12,
  },
  resultsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  counterText: {
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 4,
    minWidth: 32,
    textAlign: 'center',
  },
  arrowsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  arrowGlyph: {
    fontSize: 11,
  },
  scopeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SpacingScale.md,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  scopeText: {
    fontSize: 11,
  },
  searchOlderButton: {
    paddingHorizontal: SpacingScale.xs,
    paddingVertical: 2,
  },
  searchOlderText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
