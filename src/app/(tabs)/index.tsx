import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';

import { useAuth } from '@/providers/auth-provider';
import { getFriends } from '@/services/social-service';
import { Post, subscribeToFeed } from '@/services/posts-service';
import { RocketStoryRail } from '@/components/RocketStoryRail';
import { getProfileColor, getProfileInitials } from '@/services/user-service';
import {
  RocketAvatar,
  RocketBrand,
  RocketButton,
  RocketEmptyState,
  RocketIconButton,
  RocketLoadingIndicator,
  RocketPostCard,
  RocketPressable,
  RocketScreen,
  RocketText,
  useRocketTheme,
} from '@/design-system';
import { SpacingScale } from '@/design-system/tokens/spacing';

export default function FeedScreen() {
  const { profile, user } = useAuth();
  const { colors } = useRocketTheme();

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Date and dynamic greeting
  const todayFormatted = useMemo(() => {
    return new Date()
      .toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
      .toUpperCase();
  }, []);

  const greetingTitle = useMemo(() => {
    const hour = new Date().getHours();
    const greeting =
      hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    return `${greeting}, ${profile?.displayName ?? 'Traveler'}`;
  }, [profile?.displayName]);

  const loadFeed = (showRefreshIndicator = false) => {
    if (!user) return () => undefined;
    if (showRefreshIndicator) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError('');

    let unsubscribePosts: () => void = () => undefined;

    void getFriends(user.uid)
      .then((friends) => {
        unsubscribePosts = subscribeToFeed(
          user.uid,
          [user.uid, ...friends.map((friend) => friend.uid)],
          (nextPosts) => {
            setPosts(nextPosts);
            setLoading(false);
            setRefreshing(false);
          },
          (feedError) => {
            setError(feedError.message || 'We could not load your feed.');
            setLoading(false);
            setRefreshing(false);
          }
        );
        setLoading(false);
        setRefreshing(false);
      })
      .catch(() => {
        setError('We could not load your orbit. Check your connection and try again.');
        setLoading(false);
        setRefreshing(false);
      });

    return () => unsubscribePosts();
  };

  useEffect(() => {
    const unsub = loadFeed(false);
    return () => unsub();
  }, [user]);

  const handleRefresh = () => {
    loadFeed(true);
  };

  if (!profile) {
    return (
      <RocketScreen scroll={false}>
        <RocketEmptyState
          action={
            <RocketButton
              label="Sign in again"
              onPress={() => router.push('/sign-in')}
              size="md"
              variant="primary"
            />
          }
          body="Your Rocket profile could not be found. Please check your account setup."
          title="Profile setup required"
        />
      </RocketScreen>
    );
  }

  const userAvatar = {
    initials: getProfileInitials(profile.displayName),
    color: user ? getProfileColor(user.uid) : colors.primaryAccent,
  };

  return (
    <RocketScreen
      contentContainerStyle={styles.screenContent}
      edges={['top']}
      scroll={false}>
      <FlatList
        data={posts}
        keyExtractor={(item) => item.postId}
        renderItem={({ item }) => <RocketPostCard post={item} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            colors={[colors.primaryAccent]}
            onRefresh={handleRefresh}
            refreshing={refreshing}
            tintColor={colors.primaryAccent}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerContainer}>
            {/* Top Brand & Actions Bar */}
            <View style={styles.topBar}>
              <RocketBrand compact showSpark />
              <View style={styles.headerActions}>
                <RocketIconButton
                  accessibilityHint="Create a new post"
                  accessibilityLabel="Create post"
                  glyph="＋"
                  glyphStyle={styles.createGlyph}
                  onPress={() => router.push('/create-post')}
                  size="sm"
                  variant="filled"
                />
                <RocketPressable
                  accessibilityHint="View your profile"
                  accessibilityLabel={`Profile, ${profile.displayName}`}
                  accessibilityRole="button"
                  hitSlop={6}
                  onPress={() => router.push('/(tabs)/profile')}
                  style={styles.avatarPressable}>
                  <RocketAvatar
                    hasOrbit={false}
                    size={36}
                    source={profile.photoUrl}
                    user={userAvatar}
                  />
                </RocketPressable>
              </View>
            </View>

            {/* Greeting & Date */}
            <View style={styles.greetingSection}>
              <RocketText
                color="accent"
                style={styles.dateEyebrow}
                variant="captionBold">
                {todayFormatted}
              </RocketText>
              <RocketText
                color="primary"
                style={styles.greetingTitle}
                variant="screenTitle">
                {greetingTitle}
              </RocketText>
              <RocketText
                color="secondary"
                style={styles.greetingSubtitle}
                variant="bodySecondary">
                Here is what is happening in your orbit.
              </RocketText>
            </View>

            {/* Future Stories Slot */}
            <RocketStoryRail />

            {/* Section Header */}
            <View style={styles.sectionHeaderRow}>
              <RocketText
                color="primary"
                style={styles.sectionTitle}
                variant="sectionTitle">
                Latest from your orbit
              </RocketText>
            </View>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.stateContainer}>
              <RocketLoadingIndicator size="normal" />
              <RocketText color="secondary" style={styles.stateText} variant="caption">
                Loading your feed...
              </RocketText>
            </View>
          ) : error ? (
            <View style={styles.stateContainer}>
              <RocketText color="error" style={styles.errorText} variant="bodyMedium">
                {error}
              </RocketText>
              <RocketButton
                label="Retry"
                onPress={() => loadFeed(false)}
                size="sm"
                style={styles.retryButton}
                variant="outline"
              />
            </View>
          ) : (
            <RocketEmptyState
              action={
                <View style={styles.emptyActions}>
                  <RocketButton
                    label="Share a post"
                    onPress={() => router.push('/create-post')}
                    size="md"
                    variant="primary"
                  />
                  <RocketButton
                    label="Find friends"
                    onPress={() => router.push('/friends')}
                    size="md"
                    style={styles.secondaryCta}
                    variant="ghost"
                  />
                </View>
              }
              body="Share a photo or thought, or connect with friends to see their updates here."
              title="Your orbit is quiet"
            />
          )
        }
      />
    </RocketScreen>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingHorizontal: 0,
    flex: 1,
  },
  listContent: {
    paddingHorizontal: SpacingScale.xl,
    paddingBottom: SpacingScale.huge,
  },
  headerContainer: {
    paddingTop: SpacingScale.sm,
    marginBottom: SpacingScale.lg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SpacingScale.xl,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.md,
  },
  createGlyph: {
    fontSize: 20,
    fontWeight: '700',
  },
  avatarPressable: {
    borderRadius: 999,
  },
  greetingSection: {
    marginBottom: SpacingScale.xl,
  },
  dateEyebrow: {
    marginBottom: SpacingScale.xs,
    letterSpacing: 1.2,
  },
  greetingTitle: {
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.6,
  },
  greetingSubtitle: {
    marginTop: SpacingScale.xs,
    lineHeight: 20,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: SpacingScale.xs,
  },
  sectionTitle: {
    letterSpacing: -0.3,
  },
  stateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SpacingScale.epic,
  },
  stateText: {
    marginTop: SpacingScale.sm,
  },
  errorText: {
    textAlign: 'center',
    marginBottom: SpacingScale.md,
  },
  retryButton: {
    alignSelf: 'center',
    minWidth: 120,
  },
  emptyActions: {
    gap: SpacingScale.sm,
    width: '100%',
  },
  secondaryCta: {
    marginTop: SpacingScale.xs,
  },
});
