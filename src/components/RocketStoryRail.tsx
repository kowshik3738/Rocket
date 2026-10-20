import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@/providers/auth-provider';
import {
  fetchOwnActiveStories,
  fetchStoryDiscoveryRail,
  getStoryViewerReceipt,
} from '@/services/stories-service';
import { subscribeToChatPreferences } from '@/services/chat-management-service';
import { getProfileInitials, getProfileColor, getUserProfile } from '@/services/user-service';
import { RocketAvatar, RocketPressable, RocketText, useRocketTheme } from '@/design-system';
import { SpacingScale } from '@/design-system/tokens/spacing';

export function RocketStoryRail() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const { colors } = useRocketTheme();
  
  const [hasOwnStory, setHasOwnStory] = useState(false);
  const [friendStories, setFriendStories] = useState<{
    uid: string;
    storyState: 'unseen' | 'seen' | 'unknown';
    name: string;
    photoUrl?: string;
  }[]>([]);
  const [mutedUids, setMutedUids] = useState<Set<string>>(new Set());

  useFocusEffect(useCallback(() => {
    if (!user) return;
    let active = true;
    setFriendStories((current) => current.map((story) => ({ ...story, storyState: 'unknown' })));
    void Promise.all([
      fetchOwnActiveStories(user.uid),
      fetchStoryDiscoveryRail(user.uid),
    ])
      .then(async ([ownStories, discoveryDocs]) => {
        const storiesByAuthor = new Map<string, typeof discoveryDocs>();
        for (const story of discoveryDocs) {
          const authorStories = storiesByAuthor.get(story.authorUid) ?? [];
          authorStories.push(story);
          storiesByAuthor.set(story.authorUid, authorStories);
        }

        const friendEntries = await Promise.all(
          Array.from(storiesByAuthor, async ([uid, authorStories]) => {
            const receipts = await Promise.allSettled(
              authorStories.map((story) => getStoryViewerReceipt(story.id, user.uid)),
            );
            const failedReceiptReads = receipts.filter((result) => result.status === 'rejected');
            if (failedReceiptReads.length > 0) {
              console.warn('[Rocket stories] some own viewer receipts could not be read', {
                authorUid: uid,
                failedCount: failedReceiptReads.length,
              });
            }
            const allViewed = receipts.every(
              (result) => result.status === 'fulfilled' && result.value,
            );
            const hasUnseen = receipts.some(
              (result) => result.status === 'fulfilled' && !result.value,
            );
            const profile = await getUserProfile(uid).catch((error) => {
              console.warn('[Rocket stories] failed to load story author profile', { authorUid: uid, error });
              return null;
            });
            return {
              uid,
              storyState: failedReceiptReads.length > 0
                ? 'unknown' as const
                : allViewed
                  ? 'seen' as const
                  : hasUnseen
                    ? 'unseen' as const
                    : 'unknown' as const,
              name: profile?.displayName?.split(' ')[0] || 'Friend',
              photoUrl: profile?.photoUrl,
            };
          }),
        );

        if (active) {
          setHasOwnStory(ownStories.length > 0);
          setFriendStories(friendEntries);
        }
      })
      .catch((error) => {
        console.warn('[Rocket stories] failed to refresh story rail', error);
        if (active) {
          setFriendStories((current) => current.map((story) => ({ ...story, storyState: 'unknown' })));
        }
      });
    return () => {
      active = false;
    };
  }, [user]));

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToChatPreferences(user.uid, (prefs) => {
      const muted = new Set<string>();
      Object.values(prefs).forEach(p => {
        if (p.mutedStories && p.chatId) muted.add(p.chatId);
      });
      setMutedUids(muted);
    });
    return () => unsub();
  }, [user]);

  if (!user || !profile) return null;

  const renderYourStory = () => (
    <RocketPressable
      style={styles.itemContainer}
      onPress={() => {
        if (hasOwnStory) {
          router.push(`/story/${user.uid}` as any);
        } else {
          router.push('/story-create' as any);
        }
      }}
    >
      <View style={styles.avatarWrapper}>
        <RocketAvatar
          hasOrbit={hasOwnStory}
          size={56}
          source={profile.photoUrl}
          initials={getProfileInitials(profile.displayName)}
          color={getProfileColor(user.uid)}
          style={hasOwnStory ? {} : { borderColor: 'transparent', borderWidth: 2 }}
        />
        {!hasOwnStory && (
          <View style={[styles.addBadge, { backgroundColor: colors.primaryAccent, borderColor: colors.background }]}>
            <RocketText style={styles.addGlyph} variant="captionBold">+</RocketText>
          </View>
        )}
      </View>
      <RocketText variant="caption" color="secondary" style={styles.nameLabel} numberOfLines={1}>
        Your story
      </RocketText>
    </RocketPressable>
  );

  const renderFriendStory = ({ item }: { item: { uid: string; storyState: 'unseen' | 'seen' | 'unknown'; name: string; photoUrl?: string } }) => (
    <RocketPressable
      accessibilityLabel={`${item.name}'s story${item.storyState === 'unseen' ? ', unseen' : item.storyState === 'seen' ? ', viewed' : ', view status unavailable'}`}
      accessibilityRole="button"
      style={styles.itemContainer}
      onPress={() => router.push(`/story/${item.uid}` as any)}
    >
      <RocketAvatar
        hasOrbit={true}
        size={56}
        source={item.photoUrl}
        initials={getProfileInitials(item.name)}
        color={getProfileColor(item.uid)}
        style={{
          borderColor: item.storyState === 'unseen'
            ? colors.primaryAccent
            : item.storyState === 'seen'
              ? colors.border
              : colors.secondaryAccent,
        }}
      />
      <RocketText variant="caption" color="primary" style={styles.nameLabel} numberOfLines={1}>
        {item.name}
      </RocketText>
    </RocketPressable>
  );

  return (
    <View style={styles.railContainer}>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        data={friendStories.filter(s => !mutedUids.has(s.uid))}
        keyExtractor={item => item.uid}
        renderItem={renderFriendStory}
        ListHeaderComponent={renderYourStory}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  railContainer: {
    paddingVertical: SpacingScale.sm,
    marginBottom: SpacingScale.md,
  },
  listContent: {
    paddingHorizontal: SpacingScale.xl,
    gap: SpacingScale.md,
  },
  itemContainer: {
    alignItems: 'center',
    width: 72,
    gap: SpacingScale.xs,
  },
  avatarWrapper: {
    position: 'relative',
  },
  addBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addGlyph: {
    color: '#FFF',
    fontSize: 14,
    lineHeight: 14,
    marginTop: -1, // optical adjustment
  },
  nameLabel: {
    textAlign: 'center',
    fontSize: 11,
  },
});
