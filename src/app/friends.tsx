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
import { createOrGetConversation } from '@/services/messaging-service';
import {
  acceptFriendRequest,
  declineFriendRequest,
  Friend,
  FriendRequest,
  getFriends,
  getIncomingFriendRequests,
} from '@/services/social-service';
import { getProfileColor, getProfileInitials } from '@/services/user-service';
import {
  RocketBadge,
  RocketButton,
  RocketEmptyState,
  RocketIconButton,
  RocketLoadingIndicator,
  RocketPressable,
  RocketScreen,
  RocketText,
  RocketUserRow,
  useRocketTheme,
} from '@/design-system';
import { Radius } from '@/design-system/tokens/radius';
import { SpacingScale } from '@/design-system/tokens/spacing';

export default function FriendsScreen() {
  const { user, profile } = useAuth();
  const { colors } = useRocketTheme();

  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [activeTab, setActiveTab] = useState<'friends' | 'requests'>('friends');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState('');
  const [chatId, setChatId] = useState('');

  const myDisplayName = profile?.displayName || user?.displayName || 'User';
  const myAvatar = {
    initials: getProfileInitials(myDisplayName),
    color: getProfileColor(user?.uid || 'user'),
  };

  async function handleOpenSelfChat() {
    if (!user) return;
    setChatId(user.uid);
    setError('');

    try {
      const conversationId = await createOrGetConversation(user.uid, user.uid);
      router.push(`/chat/${conversationId}`);
    } catch (chatError) {
      setError(
        chatError instanceof Error
          ? chatError.message
          : 'Could not open self-chat.'
      );
    } finally {
      setChatId('');
    }
  }

  async function loadSocialData(isRefresh = false) {
    if (!user) return;
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError('');

    try {
      const [nextFriends, nextRequests] = await Promise.all([
        getFriends(user.uid),
        getIncomingFriendRequests(user.uid),
      ]);
      setFriends(nextFriends);
      setRequests(nextRequests);
    } catch {
      setError(
        'We could not load your friends right now. Check your connection and try again.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadSocialData(false);
  }, [user]);

  const handleRefresh = () => {
    void loadSocialData(true);
  };

  async function handleRequestAction(
    request: FriendRequest,
    action: 'accept' | 'decline'
  ) {
    if (!user) return;
    setActionId(request.id);
    setError('');

    try {
      if (action === 'accept') {
        await acceptFriendRequest(request, user.uid);
      } else {
        await declineFriendRequest(request, user.uid);
      }
      await loadSocialData(false);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Could not update that friend request.'
      );
    } finally {
      setActionId('');
    }
  }

  async function handleOpenChat(friend: Friend) {
    if (!user) return;
    setChatId(friend.uid);
    setError('');

    try {
      const conversationId = await createOrGetConversation(user.uid, friend.uid);
      router.push(`/chat/${conversationId}`);
    } catch (chatError) {
      setError(
        chatError instanceof Error
          ? chatError.message
          : 'Could not open this conversation.'
      );
    } finally {
      setChatId('');
    }
  }

  function handleNavigateToProfile(targetUid: string) {
    router.push({
      pathname: '/user/[uid]',
      params: { uid: targetUid },
    });
  }

  return (
    <RocketScreen
      contentContainerStyle={styles.screenContent}
      edges={['top']}
      scroll={false}>
      {/* Top Header Bar */}
      <View style={styles.topHeader}>
        <View style={styles.headerLeft}>
          <RocketIconButton
            accessibilityHint="Go back"
            accessibilityLabel="Back"
            glyph="‹"
            glyphStyle={styles.backGlyph}
            onPress={() => router.back()}
            size="md"
            variant="ghost"
          />
          <View style={styles.headerTitles}>
            <RocketText style={styles.screenTitle} variant="screenTitle">
              Friends
            </RocketText>
            <RocketText color="secondary" variant="caption">
              The people in your orbit
            </RocketText>
          </View>
        </View>

        <RocketIconButton
          accessibilityHint="Search for users"
          accessibilityLabel="Find people"
          glyph="⌕"
          glyphStyle={styles.searchGlyph}
          onPress={() => router.push('/(tabs)/search')}
          size="md"
          variant="filled"
        />
      </View>

      {/* Segmented Tab Controls: Friends vs Requests */}
      <View
        style={[
          styles.tabsRow,
          {
            backgroundColor: colors.surfaceSecondary,
            borderColor: colors.borderSubtle,
          },
        ]}>
        <RocketPressable
          accessibilityHint="Show friends list"
          accessibilityLabel={`Friends, ${friends.length}`}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'friends' }}
          onPress={() => setActiveTab('friends')}
          style={[
            styles.tabButton,
            activeTab === 'friends' && {
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.borderSubtle,
            },
          ]}>
          <RocketText
            color={activeTab === 'friends' ? 'primary' : 'secondary'}
            style={styles.tabText}
            variant="bodyMedium">
            Friends
          </RocketText>
          <RocketBadge
            label={friends.length}
            size="sm"
            variant={activeTab === 'friends' ? 'primary' : 'neutral'}
          />
        </RocketPressable>

        <RocketPressable
          accessibilityHint="Show incoming friend requests"
          accessibilityLabel={`Requests, ${requests.length} pending`}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'requests' }}
          onPress={() => setActiveTab('requests')}
          style={[
            styles.tabButton,
            activeTab === 'requests' && {
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.borderSubtle,
            },
          ]}>
          <RocketText
            color={activeTab === 'requests' ? 'primary' : 'secondary'}
            style={styles.tabText}
            variant="bodyMedium">
            Requests
          </RocketText>
          <RocketBadge
            label={requests.length}
            size="sm"
            variant={requests.length > 0 ? 'highlight' : 'neutral'}
          />
        </RocketPressable>
      </View>

      {/* Global Error Banner */}
      {error ? (
        <View style={styles.errorContainer}>
          <RocketText color="error" style={styles.errorText} variant="caption">
            {error}
          </RocketText>
        </View>
      ) : null}

      {/* Main List Area */}
      {loading ? (
        <View style={styles.centerContainer}>
          <RocketLoadingIndicator size="normal" />
          <RocketText color="secondary" style={styles.loadingText} variant="caption">
            Loading your orbit...
          </RocketText>
        </View>
      ) : activeTab === 'friends' ? (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={friends}
          keyExtractor={(item) => item.uid}
          ListHeaderComponent={
            <View style={styles.listHeaderWrap}>
              {requests.length > 0 ? (
                <RocketPressable
                  accessibilityHint="Switch to requests tab"
                  accessibilityLabel={`You have ${requests.length} pending friend requests`}
                  accessibilityRole="button"
                  onPress={() => setActiveTab('requests')}
                  style={[
                    styles.requestsNoticeCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.highlight,
                    },
                  ]}>
                  <View style={styles.requestsNoticeLeft}>
                    <Text style={styles.requestsNoticeIcon}>✦</Text>
                    <RocketText color="primary" variant="bodyMedium">
                      {requests.length} pending friend {requests.length === 1 ? 'request' : 'requests'}
                    </RocketText>
                  </View>
                  <RocketText color="highlight" style={styles.reviewText} variant="captionBold">
                    Review ›
                  </RocketText>
                </RocketPressable>
              ) : null}

              {/* Message Yourself Header Item */}
              <View style={styles.selfRowContainer}>
                <RocketUserRow
                  avatarUser={myAvatar}
                  avatarSource={profile?.photoUrl}
                  displayName={`${myDisplayName} (You)`}
                  id={user?.uid ?? 'self'}
                  onPress={() => void handleOpenSelfChat()}
                  subtitle="Message yourself"
                  trailingAction={
                    <RocketButton
                      label={chatId === user?.uid ? 'Opening...' : 'Message'}
                      loading={chatId === user?.uid}
                      onPress={() => void handleOpenSelfChat()}
                      size="sm"
                      variant="secondary"
                    />
                  }
                  username=""
                />
              </View>

              {friends.length > 0 ? (
                <View style={styles.sectionHeaderWrap}>
                  <RocketText color="secondary" style={styles.sectionHeaderText} variant="captionBold">
                    FRIENDS IN YOUR ORBIT
                  </RocketText>
                </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <RocketEmptyState
              action={
                <RocketButton
                  label="Find people"
                  onPress={() => router.push('/(tabs)/search')}
                  size="md"
                  variant="primary"
                />
              }
              body="Search by username to send friend requests and grow your orbit."
              title="Start your orbit"
            />
          }
          refreshControl={
            <RefreshControl
              colors={[colors.primaryAccent]}
              onRefresh={handleRefresh}
              refreshing={refreshing}
              tintColor={colors.primaryAccent}
            />
          }
          renderItem={({ item }) => {
            const avatar = {
              initials: getProfileInitials(item.displayName),
              color: getProfileColor(item.uid),
            };
            const isOpening = chatId === item.uid;

            return (
              <RocketUserRow
                avatarUser={avatar}
                avatarSource={item.photoUrl}
                displayName={item.displayName}
                id={item.uid}
                onPress={() => handleNavigateToProfile(item.uid)}
                trailingAction={
                  <RocketButton
                    label={isOpening ? 'Opening...' : 'Message'}
                    loading={isOpening}
                    onPress={() => void handleOpenChat(item)}
                    size="sm"
                    variant="secondary"
                  />
                }
                username={item.username}
              />
            );
          }}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={requests}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <RocketEmptyState
              body="When people send you friend requests, you will find them here."
              title="No pending requests"
            />
          }
          refreshControl={
            <RefreshControl
              colors={[colors.primaryAccent]}
              onRefresh={handleRefresh}
              refreshing={refreshing}
              tintColor={colors.primaryAccent}
            />
          }
          renderItem={({ item }) => {
            if (!item.sender) return null;
            const sender = item.sender;
            const avatar = {
              initials: getProfileInitials(sender.displayName),
              color: getProfileColor(sender.uid),
            };
            const isProcessing = actionId === item.id;

            return (
              <RocketUserRow
                avatarUser={avatar}
                avatarSource={sender.photoUrl}
                displayName={sender.displayName}
                id={item.id}
                onPress={() => handleNavigateToProfile(sender.uid)}
                trailingAction={
                  <View style={styles.requestActions}>
                    <RocketButton
                      disabled={isProcessing}
                      label="Accept"
                      loading={isProcessing}
                      onPress={() => void handleRequestAction(item, 'accept')}
                      size="sm"
                      variant="primary"
                    />
                    <RocketButton
                      disabled={isProcessing}
                      label="Decline"
                      onPress={() => void handleRequestAction(item, 'decline')}
                      size="sm"
                      variant="ghost"
                    />
                  </View>
                }
                username={sender.username}
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
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SpacingScale.xl,
    paddingTop: SpacingScale.sm,
    paddingBottom: SpacingScale.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.sm,
  },
  backGlyph: {
    fontSize: 28,
    fontWeight: '300',
  },
  headerTitles: {
    justifyContent: 'center',
  },
  screenTitle: {
    fontSize: 24,
    letterSpacing: -0.5,
  },
  searchGlyph: {
    fontSize: 18,
    fontWeight: '700',
  },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SpacingScale.xl,
    marginBottom: SpacingScale.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: 3,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SpacingScale.xs + 2,
    paddingVertical: SpacingScale.sm,
    borderRadius: Radius.md - 1,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabText: {
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
  listContent: {
    paddingHorizontal: SpacingScale.xl,
    paddingBottom: SpacingScale.huge,
  },
  requestsNoticeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SpacingScale.md,
    paddingHorizontal: SpacingScale.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    marginBottom: SpacingScale.md,
  },
  requestsNoticeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.sm,
  },
  requestsNoticeIcon: {
    fontSize: 14,
    color: '#FF3E83',
  },
  reviewText: {
    letterSpacing: 0.3,
  },
  requestActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.xs,
  },
  listHeaderWrap: {
    marginBottom: SpacingScale.sm,
  },
  selfRowContainer: {
    marginBottom: SpacingScale.md,
  },
  sectionHeaderWrap: {
    paddingVertical: SpacingScale.xs,
    paddingHorizontal: SpacingScale.xs,
    marginBottom: SpacingScale.xs,
  },
  sectionHeaderText: {
    letterSpacing: 0.8,
  },
});
