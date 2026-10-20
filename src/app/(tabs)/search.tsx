import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuth } from '@/providers/auth-provider';
import {
  getSearchUsers,
  SearchUser,
  sendFriendRequest,
} from '@/services/social-service';
import { getProfileColor, getProfileInitials } from '@/services/user-service';
import {
  RocketButton,
  RocketEmptyState,
  RocketInput,
  RocketLoadingIndicator,
  RocketScreen,
  RocketText,
  RocketUserRow,
  useRocketTheme,
} from '@/design-system';
import { SpacingScale } from '@/design-system/tokens/spacing';

export default function SearchScreen() {
  const { user } = useAuth();
  const { colors } = useRocketTheme();

  const [term, setTerm] = useState('');
  const [results, setResults] = useState<SearchUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState('');

  useEffect(() => {
    if (!user || !term.trim()) {
      setResults([]);
      setLoading(false);
      setError('');
      return;
    }

    let active = true;
    setLoading(true);
    setError('');

    const timer = setTimeout(() => {
      void getSearchUsers(term, user.uid)
        .then((nextResults) => {
          if (active) setResults(nextResults);
        })
        .catch(() => {
          if (active) {
            setError(
              'We could not search Rocket right now. Check your connection and try again.'
            );
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [term, user]);

  async function handleSendRequest(target: SearchUser) {
    if (!user || target.relationship !== 'add') return;
    setActionId(target.uid);
    setError('');

    try {
      await sendFriendRequest(user.uid, target.uid);
      setResults((current) =>
        current.map((result) =>
          result.uid === target.uid ? { ...result, relationship: 'sent' } : result
        )
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Could not send friend request.'
      );
    } finally {
      setActionId('');
    }
  }

  function handleNavigateToProfile(targetUid: string) {
    router.push({
      pathname: '/user/[uid]',
      params: { uid: targetUid },
    });
  }

  const renderRelationshipButton = (target: SearchUser) => {
    switch (target.relationship) {
      case 'friends':
        return (
          <RocketButton
            disabled
            label="Friends"
            size="sm"
            variant="ghost"
          />
        );
      case 'sent':
        return (
          <RocketButton
            disabled
            label="Sent"
            size="sm"
            variant="secondary"
          />
        );
      case 'incoming':
        return (
          <RocketButton
            label="Respond"
            onPress={() => router.push('/friends')}
            size="sm"
            variant="secondary"
          />
        );
      case 'blocked':
        return (
          <RocketButton
            disabled
            label="Blocked"
            size="sm"
            variant="ghost"
          />
        );
      case 'add':
      default:
        return (
          <RocketButton
            disabled={actionId !== ''}
            label={actionId === target.uid ? 'Adding...' : 'Add'}
            loading={actionId === target.uid}
            onPress={() => void handleSendRequest(target)}
            size="sm"
            variant="primary"
          />
        );
    }
  };

  return (
    <RocketScreen
      contentContainerStyle={styles.screenContent}
      edges={['top']}
      scroll={false}>
      {/* Top Header */}
      <View style={styles.header}>
        <RocketText style={styles.title} variant="screenTitle">
          Find people
        </RocketText>
        <RocketText color="secondary" style={styles.subtitle} variant="bodySecondary">
          Search Rocket by username to connect.
        </RocketText>

        {/* Search Field */}
        <View style={styles.searchWrap}>
          <RocketInput
            autoCapitalize="none"
            autoCorrect={false}
            containerStyle={styles.searchInputContainer}
            iconLeft={
              <Text style={[styles.searchIcon, { color: colors.secondaryText }]}>
                ⌕
              </Text>
            }
            iconRight={
              term.length > 0 ? (
                <Pressable
                  accessibilityHint="Clear search term"
                  accessibilityLabel="Clear search"
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => setTerm('')}
                  style={styles.clearButton}>
                  <Text style={[styles.clearIcon, { color: colors.secondaryText }]}>
                    ✕
                  </Text>
                </Pressable>
              ) : null
            }
            onChangeText={setTerm}
            placeholder="Search by username..."
            placeholderTextColor={colors.mutedText}
            returnKeyType="search"
            value={term}
          />
        </View>
      </View>

      {/* Error Message */}
      {error ? (
        <View style={styles.errorContainer}>
          <RocketText color="error" style={styles.errorText} variant="caption">
            {error}
          </RocketText>
        </View>
      ) : null}

      {/* Main Results / State Area */}
      {loading ? (
        <View style={styles.centerContainer}>
          <RocketLoadingIndicator size="normal" />
          <RocketText color="secondary" style={styles.loadingText} variant="caption">
            Searching Rocket...
          </RocketText>
        </View>
      ) : !term.trim() ? (
        <View style={styles.emptyPromptContainer}>
          <RocketEmptyState
            body="Type a username above to find friends and add them to your orbit."
            title="Search for people"
          />
        </View>
      ) : results.length === 0 ? (
        <View style={styles.emptyPromptContainer}>
          <RocketEmptyState
            body={`We could not find anyone matching "@${term.trim()}". Try another username.`}
            title="No people found"
          />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={results}
          keyExtractor={(item) => item.uid}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.resultsHeader}>
              <RocketText color="primary" variant="sectionTitle">
                Results
              </RocketText>
              <RocketText color="secondary" variant="caption">
                {results.length} {results.length === 1 ? 'user' : 'users'}
              </RocketText>
            </View>
          }
          renderItem={({ item }) => {
            const avatar = {
              initials: getProfileInitials(item.displayName),
              color: getProfileColor(item.uid),
            };

            return (
              <RocketUserRow
                avatarUser={avatar}
                avatarSource={item.photoUrl}
                displayName={item.displayName}
                id={item.uid}
                onPress={() => handleNavigateToProfile(item.uid)}
                trailingAction={renderRelationshipButton(item)}
                username={item.username}
              />
            );
          }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </RocketScreen>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingHorizontal: 0,
    flex: 1,
  },
  header: {
    paddingHorizontal: SpacingScale.xl,
    paddingTop: SpacingScale.sm,
    paddingBottom: SpacingScale.sm,
  },
  title: {
    fontSize: 26,
    letterSpacing: -0.6,
  },
  subtitle: {
    marginTop: 4,
    marginBottom: SpacingScale.lg,
  },
  searchWrap: {
    marginBottom: SpacingScale.sm,
  },
  searchInputContainer: {
    marginBottom: 0,
  },
  searchIcon: {
    fontSize: 20,
    fontWeight: '700',
    marginRight: 4,
  },
  clearButton: {
    padding: 4,
  },
  clearIcon: {
    fontSize: 14,
    fontWeight: '700',
  },
  errorContainer: {
    paddingHorizontal: SpacingScale.xl,
    marginBottom: SpacingScale.sm,
  },
  errorText: {
    textAlign: 'center',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SpacingScale.xl,
  },
  loadingText: {
    marginTop: SpacingScale.md,
  },
  emptyPromptContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: SpacingScale.xl,
    paddingBottom: SpacingScale.huge,
  },
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SpacingScale.sm,
    marginBottom: SpacingScale.md,
    paddingHorizontal: 2,
  },
});
