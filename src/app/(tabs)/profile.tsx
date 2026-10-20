import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuth } from '@/providers/auth-provider';
import { getPostCount, Post, subscribeToFeed } from '@/services/posts-service';
import { getFriends } from '@/services/social-service';
import { getProfileColor, getProfileInitials } from '@/services/user-service';
import {
  RocketButton,
  RocketCard,
  RocketEmptyState,
  RocketIconButton,
  RocketLoadingIndicator,
  RocketPostCard,
  RocketPressable,
  RocketProfileHero,
  RocketScreen,
  RocketText,
  useRocketTheme,
} from '@/design-system';
import { Radius } from '@/design-system/tokens/radius';
import { SpacingScale } from '@/design-system/tokens/spacing';

export default function ProfileScreen() {
  const { profile, user } = useAuth();
  const { colors } = useRocketTheme();

  const [friendCount, setFriendCount] = useState(0);
  const [postCount, setPostCount] = useState(0);
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = (isRefresh = false) => {
    if (!user) return () => undefined;

    if (isRefresh) {
      setRefreshing(true);
    } else {
      setPostsLoading(true);
    }

    void Promise.all([getFriends(user.uid), getPostCount(user.uid)])
      .then(([friends, postsTotal]) => {
        setFriendCount(friends.length);
        setPostCount(postsTotal);
      })
      .catch(() => {
        setFriendCount(0);
        setPostCount(0);
      });

    const unsubscribe = subscribeToFeed(
      user.uid,
      [user.uid],
      (nextPosts) => {
        setPosts(nextPosts);
        setPostsLoading(false);
        setRefreshing(false);
      },
      () => {
        setPosts([]);
        setPostsLoading(false);
        setRefreshing(false);
      }
    );

    return unsubscribe;
  };

  useEffect(() => {
    const unsub = loadData(false);
    return () => unsub();
  }, [user]);

  const handleRefresh = () => {
    loadData(true);
  };

  if (!profile) {
    return (
      <RocketScreen scroll={false}>
        <RocketEmptyState
          action={
            <RocketButton
              label="Sign in"
              onPress={() => router.push('/sign-in')}
              size="md"
              variant="primary"
            />
          }
          body="Your Rocket profile could not be found."
          title="Profile setup required"
        />
      </RocketScreen>
    );
  }

  const avatar = {
    initials: getProfileInitials(profile.displayName),
    color: getProfileColor(profile.uid),
    source: profile.photoUrl,
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
            {/* Top Bar with Screen Title & Settings Navigation */}
            <View style={styles.topBar}>
              <RocketText style={styles.screenTitle} variant="screenTitle">
                Profile
              </RocketText>
              <RocketIconButton
                accessibilityHint="Open settings"
                accessibilityLabel="Settings"
                glyph="⚙"
                glyphStyle={styles.settingsGlyph}
                onPress={() => router.push('/settings')}
                size="md"
                variant="ghost"
              />
            </View>

            {/* Profile Hero with Orbit Avatar, Identity, Stats, and Edit CTA */}
            <RocketProfileHero
              avatar={avatar}
              bio={profile.bio}
              displayName={profile.displayName}
              stats={[
                {
                  label: 'Posts',
                  value: postCount,
                },
                {
                  label: 'Friends',
                  value: friendCount,
                  onPress: () => router.push('/friends'),
                  accessibilityLabel: `${friendCount} friends, tap to view friends`,
                },
              ]}
              actions={
                <RocketButton
                  label="Edit profile"
                  onPress={() => router.push('/edit-profile')}
                  size="md"
                  variant="secondary"
                />
              }
              username={profile.username}
            />

            {/* Quick Link to Friends & Connections */}
            <RocketPressable
              accessibilityHint="View your friends and pending requests"
              accessibilityLabel="Friends & connections"
              accessibilityRole="button"
              onPress={() => router.push('/friends')}
              style={[
                styles.friendsCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderSubtle,
                },
              ]}>
              <View style={styles.friendsCardLeft}>
                <Text style={styles.friendsCardIcon}>👥</Text>
                <View>
                  <RocketText style={styles.friendsCardTitle} variant="bodyMedium">
                    Friends & connections
                  </RocketText>
                  <RocketText color="secondary" variant="caption">
                    Manage your orbit and requests
                  </RocketText>
                </View>
              </View>
              <RocketText color="muted" style={styles.friendsCardArrow}>
                ›
              </RocketText>
            </RocketPressable>

            {/* Starter Suggestion Card if zero posts */}
            {postCount === 0 && !postsLoading ? (
              <RocketCard
                padding="md"
                style={styles.starterCard}
                variant="default">
                <RocketText style={styles.starterTitle} variant="bodyMedium">
                  Your profile is just getting started
                </RocketText>
                <RocketText
                  color="secondary"
                  style={styles.starterBody}
                  variant="bodySecondary">
                  Add a bio and share your first post to make this space yours.
                </RocketText>
                <RocketButton
                  label="Share your first post"
                  onPress={() => router.push('/create-post')}
                  size="sm"
                  style={styles.starterButton}
                  variant="primary"
                />
              </RocketCard>
            ) : null}

            {/* Posts Section Transition */}
            <View style={styles.sectionHeaderRow}>
              <RocketText
                color="primary"
                style={styles.sectionTitle}
                variant="sectionTitle">
                Your posts
              </RocketText>
              {postCount > 0 ? (
                <RocketText color="secondary" variant="caption">
                  {postCount} {postCount === 1 ? 'post' : 'posts'}
                </RocketText>
              ) : null}
            </View>
          </View>
        }
        ListEmptyComponent={
          postsLoading ? (
            <View style={styles.stateContainer}>
              <RocketLoadingIndicator size="normal" />
              <RocketText color="secondary" style={styles.stateText} variant="caption">
                Loading posts...
              </RocketText>
            </View>
          ) : (
            <RocketEmptyState
              action={
                <RocketButton
                  label="Create a post"
                  onPress={() => router.push('/create-post')}
                  size="md"
                  variant="primary"
                />
              }
              body="Share your thoughts or photos with your orbit."
              title="No posts yet"
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
    marginBottom: SpacingScale.md,
  },
  screenTitle: {
    fontSize: 26,
    letterSpacing: -0.6,
  },
  settingsGlyph: {
    fontSize: 20,
  },
  friendsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SpacingScale.md,
    paddingHorizontal: SpacingScale.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    marginTop: SpacingScale.md,
    marginBottom: SpacingScale.md,
  },
  friendsCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.md,
  },
  friendsCardIcon: {
    fontSize: 22,
  },
  friendsCardTitle: {
    fontWeight: '700',
  },
  friendsCardArrow: {
    fontSize: 24,
    lineHeight: 24,
  },
  starterCard: {
    marginTop: SpacingScale.xs,
    marginBottom: SpacingScale.md,
  },
  starterTitle: {
    fontWeight: '700',
    marginBottom: 4,
  },
  starterBody: {
    lineHeight: 19,
    marginBottom: SpacingScale.md,
  },
  starterButton: {
    alignSelf: 'flex-start',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SpacingScale.lg,
    marginBottom: SpacingScale.sm,
    paddingHorizontal: 2,
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
});
