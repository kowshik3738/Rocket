import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {
  RocketAvatar,
  RocketIconButton,
  RocketPressable,
  RocketScreen,
  RocketText,
  useRocketTheme,
} from '@/design-system';
import { SpacingScale } from '@/design-system/tokens/spacing';
import { useAuth } from '@/providers/auth-provider';
import { Friend, getFriends } from '@/services/social-service';
import {
  addCloseFriend,
  getPrivacyList,
  PrivacyList,
  removeCloseFriend,
  setHiddenFrom,
} from '@/services/stories-service';
import { getProfileColor, getProfileInitials } from '@/services/user-service';

export default function StoryPrivacyScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useRocketTheme();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [privacy, setPrivacy] = useState<PrivacyList | null>(null);
  const [loading, setLoading] = useState(true);
  const [workingUid, setWorkingUid] = useState<string | null>(null);
  const [error, setError] = useState('');

  const closeFriendIds = useMemo(() => new Set(privacy?.closeFriends ?? []), [privacy]);
  const hiddenIds = useMemo(() => new Set(privacy?.hiddenFrom ?? []), [privacy]);

  useEffect(() => {
    if (!user) return;
    let active = true;

    void Promise.all([getFriends(user.uid), getPrivacyList(user.uid)])
      .then(([nextFriends, nextPrivacy]) => {
        if (!active) return;
        setFriends(nextFriends);
        setPrivacy({
          ...nextPrivacy,
          closeFriends: nextPrivacy.closeFriends ?? [],
          hiddenFrom: nextPrivacy.hiddenFrom ?? [],
        });
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load story privacy settings.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  async function toggleCloseFriend(friend: Friend) {
    if (!user || !privacy || workingUid) return;
    const isCloseFriend = closeFriendIds.has(friend.uid);
    if (!isCloseFriend && privacy.closeFriends.length >= 200) {
      setError('Your Close Friends list is full (maximum 200).');
      return;
    }

    setWorkingUid(friend.uid);
    setError('');
    try {
      if (isCloseFriend) {
        await removeCloseFriend(user.uid, friend.uid);
      } else {
        await addCloseFriend(user.uid, friend.uid);
      }
      setPrivacy((current) => current ? {
        ...current,
        closeFriends: isCloseFriend
          ? current.closeFriends.filter((uid) => uid !== friend.uid)
          : [...current.closeFriends, friend.uid],
      } : current);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not update Close Friends.');
      try {
        const refreshed = await getPrivacyList(user.uid);
        setPrivacy({
          ...refreshed,
          closeFriends: refreshed.closeFriends ?? [],
          hiddenFrom: refreshed.hiddenFrom ?? [],
        });
      } catch (refreshError) {
        console.warn('[Rocket story privacy] failed to refresh after save error', refreshError);
      }
    } finally {
      setWorkingUid(null);
    }
  }

  async function toggleHiddenFriend(friend: Friend) {
    if (!user || !privacy || workingUid) return;
    const isHidden = hiddenIds.has(friend.uid);
    if (!isHidden && privacy.hiddenFrom.length >= 200) {
      setError('You can hide your stories from up to 200 friends.');
      return;
    }

    const nextHidden = isHidden
      ? privacy.hiddenFrom.filter((uid) => uid !== friend.uid)
      : [...privacy.hiddenFrom, friend.uid];

    setWorkingUid(friend.uid);
    setError('');
    try {
      await setHiddenFrom(user.uid, nextHidden);
      setPrivacy((current) => current ? { ...current, hiddenFrom: nextHidden } : current);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not update story visibility.');
      try {
        const refreshed = await getPrivacyList(user.uid);
        setPrivacy({
          ...refreshed,
          closeFriends: refreshed.closeFriends ?? [],
          hiddenFrom: refreshed.hiddenFrom ?? [],
        });
      } catch (refreshError) {
        console.warn('[Rocket story privacy] failed to refresh after save error', refreshError);
      }
    } finally {
      setWorkingUid(null);
    }
  }

  function friendRow(friend: Friend, selected: boolean, onPress: () => void, accessibilityRole: 'checkbox' | 'switch') {
    const disabled = workingUid !== null;
    return (
      <RocketPressable
        key={friend.uid}
        accessibilityLabel={`${friend.displayName}${selected ? ', enabled' : ', disabled'}`}
        accessibilityRole={accessibilityRole}
        accessibilityState={{
          checked: selected,
          disabled,
          busy: workingUid === friend.uid,
        }}
        disabled={disabled}
        onPress={onPress}
        style={[styles.friendRow, { borderBottomColor: colors.borderSubtle }]}>
        <View style={styles.friendInfo}>
          <RocketAvatar
            accessibilityLabel={`${friend.displayName} profile`}
            color={getProfileColor(friend.uid)}
            initials={getProfileInitials(friend.displayName)}
            source={friend.photoUrl}
            size={42}
          />
          <View style={styles.friendLabels}>
            <RocketText numberOfLines={1} variant="bodyMedium">{friend.displayName}</RocketText>
            <RocketText color="secondary" numberOfLines={1} variant="caption">
              @{friend.username}
            </RocketText>
          </View>
        </View>
        {workingUid === friend.uid ? (
          <ActivityIndicator color={colors.primaryAccent} />
        ) : (
          <View style={[
            styles.toggle,
            {
              backgroundColor: selected ? colors.primaryAccent : colors.surfaceSecondary,
              borderColor: selected ? colors.primaryAccent : colors.border,
            },
          ]}>
            <RocketText color={selected ? 'inverse' : 'muted'} variant="captionBold">
              {selected ? '✓' : '＋'}
            </RocketText>
          </View>
        )}
      </RocketPressable>
    );
  }

  return (
    <RocketScreen
      contentContainerStyle={styles.screenContent}
      edges={['top']}
      scroll={false}>
      <View style={styles.header}>
        <RocketIconButton
          accessibilityLabel="Back"
          glyph="‹"
          onPress={() => router.back()}
          variant="ghost"
        />
        <RocketText variant="sectionTitle">Story privacy</RocketText>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <RocketText color="secondary" style={styles.intro} variant="bodySecondary">
          Choose who can see your stories. Changes are saved as you make them.
        </RocketText>

        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={colors.primaryAccent} size="large" />
            <RocketText color="secondary" variant="caption">Loading friends and privacy...</RocketText>
          </View>
        ) : friends.length === 0 ? (
          <View style={[styles.emptyState, { backgroundColor: colors.surface, borderColor: colors.borderSubtle }]}>
            <RocketText variant="bodyBold">No accepted friends yet</RocketText>
            <RocketText color="secondary" style={styles.emptyDetail} variant="caption">
              Add friends first to manage your Close Friends list or story visibility.
            </RocketText>
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <View style={styles.sectionHeading}>
                <RocketText variant="bodyBold">Close Friends</RocketText>
                <RocketText color="secondary" variant="caption">
                  {privacy?.closeFriends.length ?? 0}/200
                </RocketText>
              </View>
              <RocketText color="secondary" style={styles.sectionDescription} variant="caption">
                Stories shared with Close Friends are visible only to this list.
              </RocketText>
              <View style={[styles.friendList, { borderTopColor: colors.borderSubtle }]}>
                {friends.map((friend) => friendRow(
                  friend,
                  closeFriendIds.has(friend.uid),
                  () => void toggleCloseFriend(friend),
                  'checkbox',
                ))}
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeading}>
                <RocketText variant="bodyBold">Hide story from</RocketText>
                <RocketText color="secondary" variant="caption">
                  {privacy?.hiddenFrom.length ?? 0}/200
                </RocketText>
              </View>
              <RocketText color="secondary" style={styles.sectionDescription} variant="caption">
                These friends cannot view your active or future stories.
              </RocketText>
              <View style={[styles.friendList, { borderTopColor: colors.borderSubtle }]}>
                {friends.map((friend) => friendRow(
                  friend,
                  hiddenIds.has(friend.uid),
                  () => void toggleHiddenFriend(friend),
                  'switch',
                ))}
              </View>
            </View>
          </>
        )}

        {error ? (
          <RocketText accessibilityRole="alert" color="error" style={styles.error} variant="caption">
            {error}
          </RocketText>
        ) : null}
      </ScrollView>
    </RocketScreen>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    flex: 1,
    paddingHorizontal: 0,
  },
  header: {
    minHeight: 56,
    paddingHorizontal: SpacingScale.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: {
    width: 44,
  },
  content: {
    paddingHorizontal: SpacingScale.lg,
    paddingBottom: SpacingScale.huge,
  },
  intro: {
    marginTop: SpacingScale.sm,
    marginBottom: SpacingScale.xl,
  },
  loadingState: {
    alignItems: 'center',
    gap: SpacingScale.md,
    paddingVertical: SpacingScale.epic,
  },
  emptyState: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 18,
    padding: SpacingScale.xl,
  },
  emptyDetail: {
    textAlign: 'center',
    marginTop: SpacingScale.xs,
  },
  section: {
    marginBottom: SpacingScale.xxl,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionDescription: {
    marginTop: 3,
    marginBottom: SpacingScale.sm,
  },
  friendList: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  friendRow: {
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SpacingScale.xs,
  },
  friendInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.sm,
    marginRight: SpacingScale.md,
  },
  friendLabels: {
    flex: 1,
  },
  toggle: {
    width: 30,
    height: 30,
    borderWidth: 1,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    marginBottom: SpacingScale.lg,
  },
});
