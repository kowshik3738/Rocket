import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, ListRenderItem, StyleSheet, Text, View } from 'react-native';
import { Timestamp } from 'firebase/firestore';

import { RocketChatActionSheet } from '@/components/RocketChatActionSheet';
import {
  Radius,
  RocketAvatar,
  RocketBadge,
  RocketBrand,
  RocketButton,
  RocketCard,
  RocketChatRow,
  RocketEmptyState,
  RocketIconButton,
  RocketLoadingIndicator,
  RocketPressable,
  RocketScreen,
  RocketSpark,
  RocketText,
  SpacingScale,
  useRocketTheme,
} from '@/design-system';
import { useAuth } from '@/providers/auth-provider';
import { Conversation, subscribeToConversations } from '@/services/messaging-service';
import { Group, subscribeToGroups } from '@/services/group-service';
import {
  ChatPreferencesMap,
  deleteChatForUser,
  setChatArchived,
  setChatMuted,
  setChatPinned,
  subscribeToChatPreferences,
} from '@/services/chat-management-service';
import { getProfileColor, getProfileInitials } from '@/services/user-service';

type FilterType = 'all' | 'direct' | 'groups';

type UnifiedChatItem =
  | { kind: 'group'; group: Group; sortTime: number }
  | { kind: 'conversation'; conversation: Conversation; sortTime: number };

function formatChatTimestamp(timestamp: Timestamp | null): string {
  if (!timestamp) return '';
  const date = timestamp.toDate();
  const now = new Date();

  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (isYesterday) {
    return 'Yesterday';
  }

  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays >= 0 && diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ChatsScreen() {
  const { user, profile } = useAuth();
  const { colors } = useRocketTheme();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [preferences, setPreferences] = useState<ChatPreferencesMap>({});
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [error, setError] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');

  // Action sheet state
  const [selectedItem, setSelectedItem] = useState<UnifiedChatItem | null>(null);

  const loading = !conversationsLoaded || !groupsLoaded;

  useEffect(() => {
    if (!user) return;
    setConversationsLoaded(false);
    setGroupsLoaded(false);
    setError('');

    const unsubscribeConversations = subscribeToConversations(
      user.uid,
      (nextConversations) => {
        setConversations(nextConversations);
        setConversationsLoaded(true);
      },
      (conversationError) => {
        setError(conversationError.message || 'We could not load your conversations.');
        setConversationsLoaded(true);
      }
    );

    const unsubscribeGroups = subscribeToGroups(
      user.uid,
      (nextGroups) => {
        setGroups(nextGroups);
        setGroupsLoaded(true);
      },
      (groupError) => {
        setError(groupError.message || 'We could not load your groups.');
        setGroupsLoaded(true);
      }
    );

    const unsubscribePreferences = subscribeToChatPreferences(
      user.uid,
      (nextPreferences) => {
        setPreferences(nextPreferences);
      }
    );

    return () => {
      unsubscribeConversations();
      unsubscribeGroups();
      unsubscribePreferences();
    };
  }, [user]);

  const currentUserAvatar = useMemo(
    () => ({
      initials: getProfileInitials(profile?.displayName || user?.displayName || 'User'),
      color: getProfileColor(user?.uid || 'user'),
    }),
    [profile?.displayName, user?.displayName, user?.uid]
  );

  // Active (non-archived) vs archived counts
  const archivedDirectCount = useMemo(
    () => conversations.filter((c) => preferences[c.id]?.archived && !preferences[c.id]?.deleted).length,
    [conversations, preferences]
  );

  const archivedGroupCount = useMemo(
    () => groups.filter((g) => preferences[g.id]?.archived && !preferences[g.id]?.deleted).length,
    [groups, preferences]
  );

  const totalArchivedCount = archivedDirectCount + archivedGroupCount;

  const visibleDirectCount = conversations.filter((c) => !preferences[c.id]?.deleted && !preferences[c.id]?.archived).length;
  const visibleGroupCount = groups.filter((g) => !preferences[g.id]?.deleted && !preferences[g.id]?.archived).length;
  const totalVisibleCount = visibleDirectCount + visibleGroupCount;

  // Ordered list: Pinned non-archived first, then normal non-archived, each sorted by sortTime desc.
  const items: UnifiedChatItem[] = useMemo(() => {
    const pinnedList: UnifiedChatItem[] = [];
    const normalList: UnifiedChatItem[] = [];

    if (activeFilter === 'all' || activeFilter === 'groups') {
      for (const group of groups) {
        if (!preferences[group.id]?.archived && !preferences[group.id]?.deleted) {
          const item: UnifiedChatItem = {
            kind: 'group',
            group,
            sortTime: group.lastMessageAt?.toMillis() ?? 0,
          };
          if (preferences[group.id]?.pinned) {
            pinnedList.push(item);
          } else {
            normalList.push(item);
          }
        }
      }
    }

    if (activeFilter === 'all' || activeFilter === 'direct') {
      for (const conversation of conversations) {
        if (conversation.otherUser && !preferences[conversation.id]?.archived && !preferences[conversation.id]?.deleted) {
          const item: UnifiedChatItem = {
            kind: 'conversation',
            conversation,
            sortTime: conversation.lastMessageAt?.toMillis() ?? 0,
          };
          if (preferences[conversation.id]?.pinned) {
            pinnedList.push(item);
          } else {
            normalList.push(item);
          }
        }
      }
    }

    pinnedList.sort((a, b) => b.sortTime - a.sortTime);
    normalList.sort((a, b) => b.sortTime - a.sortTime);

    return [...pinnedList, ...normalList];
  }, [activeFilter, groups, conversations, preferences]);

  const showFilters = visibleGroupCount > 0 && visibleDirectCount > 0;

  const handleTogglePin = async () => {
    if (!user || !selectedItem) return;
    const chatId =
      selectedItem.kind === 'group' ? selectedItem.group.id : selectedItem.conversation.id;
    const chatType = selectedItem.kind === 'group' ? 'group' : 'direct';
    const currentPinned = Boolean(preferences[chatId]?.pinned);
    const pinnedCount = Object.values(preferences).filter((p) => p.pinned && !p.archived).length;
    try {
      await setChatPinned(user.uid, chatId, chatType, !currentPinned, pinnedCount);
    } catch (pinError) {
      setError(pinError instanceof Error ? pinError.message : 'Could not update pin state.');
    }
  };

  const handleToggleArchive = async () => {
    if (!user || !selectedItem) return;
    const chatId =
      selectedItem.kind === 'group' ? selectedItem.group.id : selectedItem.conversation.id;
    const chatType = selectedItem.kind === 'group' ? 'group' : 'direct';
    const currentArchived = Boolean(preferences[chatId]?.archived);
    try {
      await setChatArchived(user.uid, chatId, chatType, !currentArchived);
    } catch (archiveError) {
      setError(
        archiveError instanceof Error ? archiveError.message : 'Could not update archive state.'
      );
    }
  };

  const handleToggleMute = async () => {
    if (!user || !selectedItem) return;
    const chatId =
      selectedItem.kind === 'group' ? selectedItem.group.id : selectedItem.conversation.id;
    const chatType = selectedItem.kind === 'group' ? 'group' : 'direct';
    const currentMuted = Boolean(preferences[chatId]?.muted);
    try {
      await setChatMuted(user.uid, chatId, chatType, !currentMuted);
    } catch (muteError) {
      setError(muteError instanceof Error ? muteError.message : 'Could not update mute state.');
    }
  };

  const handleDeleteChat = async () => {
    if (!user || !selectedItem) return;
    const chatId = selectedItem.kind === 'group' ? selectedItem.group.id : selectedItem.conversation.id;
    const chatType = selectedItem.kind === 'group' ? 'group' : 'direct';

    Alert.alert(
      'Delete chat?',
      'This removes the chat from your view only. It will not delete anyone else\'s messages.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteChatForUser(user.uid, chatId, chatType);
              setSelectedItem(null);
            } catch (deleteError) {
              setError(deleteError instanceof Error ? deleteError.message : 'Could not delete this chat.');
            }
          },
        },
      ],
    );
  };

  const selectedTitle = useMemo(() => {
    if (!selectedItem) return '';
    if (selectedItem.kind === 'group') return selectedItem.group.name;
    const otherUser = selectedItem.conversation.otherUser!;
    const isSelf = selectedItem.conversation.participantA === selectedItem.conversation.participantB;
    return isSelf ? `${otherUser.displayName} (You)` : otherUser.displayName;
  }, [selectedItem]);

  const selectedPref = useMemo(() => {
    if (!selectedItem) return null;
    const chatId =
      selectedItem.kind === 'group' ? selectedItem.group.id : selectedItem.conversation.id;
    return preferences[chatId];
  }, [selectedItem, preferences]);

  const renderItem: ListRenderItem<UnifiedChatItem> = ({ item, index }) => {
    const isLast = index === items.length - 1;

    if (item.kind === 'group') {
      const group = item.group;
      const pref = preferences[group.id];
      return (
        <RocketChatRow
          avatarColor={colors.secondaryAccent}
          avatarUser={{
            initials: getProfileInitials(group.name),
            color: colors.secondaryAccent,
          }}
          id={group.id}
          isGroup={true}
          isMuted={Boolean(pref?.muted)}
          isPinned={Boolean(pref?.pinned)}
          onLongPress={() => setSelectedItem(item)}
          onPress={() => router.push(`/group/${group.id}`)}
          preview={group.lastMessage || 'Group created'}
          showSeparator={!isLast}
          subtitle={`${group.memberIds.length} members`}
          time={formatChatTimestamp(group.lastMessageAt)}
          title={group.name}
        />
      );
    }

    const conversation = item.conversation;
    const otherUser = conversation.otherUser!;
    const isSelf = conversation.participantA === conversation.participantB;
    const pref = preferences[conversation.id];

    return (
      <RocketChatRow
        avatarUser={{
          initials: getProfileInitials(otherUser.displayName),
          color: getProfileColor(otherUser.uid),
        }}
        avatarSource={otherUser.photoUrl}
        id={conversation.id}
        isGroup={false}
        isMuted={Boolean(pref?.muted)}
        isPinned={Boolean(pref?.pinned)}
        onLongPress={() => setSelectedItem(item)}
        onPress={() => router.push(`/chat/${conversation.id}`)}
        preview={conversation.lastMessage || (isSelf ? 'Jot something down' : 'Start a conversation')}
        showSeparator={!isLast}
        subtitle={isSelf ? 'Message yourself' : `@${otherUser.username}`}
        time={formatChatTimestamp(conversation.lastMessageAt)}
        title={isSelf ? `${otherUser.displayName} (You)` : otherUser.displayName}
      />
    );
  };

  const renderHeaderBar = () => (
    <View style={styles.header}>
      <RocketBrand compact showSpark />

      <View style={styles.headerActions}>
        <RocketIconButton
          accessibilityHint="Create a new group conversation"
          accessibilityLabel="Create group"
          glyph="👥"
          onPress={() => router.push('/group/create')}
          size="md"
          variant="filled"
        />

        <RocketIconButton
          accessibilityHint="Select a friend to message"
          accessibilityLabel="Start conversation"
          glyph="＋"
          onPress={() => router.push('/friends')}
          size="md"
          variant="accent"
        />

        <RocketPressable
          accessibilityHint="Go to your profile screen"
          accessibilityLabel="My profile"
          accessibilityRole="button"
          hitSlop={4}
          onPress={() => router.push('/profile')}
          style={styles.profileButton}>
          <RocketAvatar
            hasOrbit
            size={36}
            source={profile?.photoUrl}
            user={currentUserAvatar}
          />
        </RocketPressable>
      </View>
    </View>
  );

  const renderListHeader = () => (
    <View style={styles.listHeader}>
      <View style={styles.titleSection}>
        <View style={styles.titleRow}>
          <RocketText style={styles.screenTitle} variant="screenTitle">
            Messages
          </RocketText>
          {totalVisibleCount > 0 ? (
            <RocketBadge
              label={totalVisibleCount}
              size="sm"
              variant="neutral"
            />
          ) : null}
        </View>
        <RocketText color="secondary" style={styles.screenSubtitle} variant="bodySecondary">
          Keep the conversation moving.
        </RocketText>
      </View>

      {showFilters ? (
        <View style={styles.filterBar}>
          <RocketPressable
            accessibilityLabel="Show all conversations"
            accessibilityRole="tab"
            accessibilityState={{ selected: activeFilter === 'all' }}
            onPress={() => setActiveFilter('all')}
            style={[
              styles.filterPill,
              activeFilter === 'all'
                ? {
                    backgroundColor: colors.surfaceSecondary,
                    borderColor: colors.borderFocus,
                  }
                : {
                    backgroundColor: 'transparent',
                    borderColor: colors.borderSubtle,
                  },
            ]}>
            <RocketText
              color={activeFilter === 'all' ? 'primary' : 'muted'}
              style={styles.filterText}
              variant="buttonSmall">
              All {totalVisibleCount}
            </RocketText>
          </RocketPressable>

          <RocketPressable
            accessibilityLabel="Show direct messages"
            accessibilityRole="tab"
            accessibilityState={{ selected: activeFilter === 'direct' }}
            onPress={() => setActiveFilter('direct')}
            style={[
              styles.filterPill,
              activeFilter === 'direct'
                ? {
                    backgroundColor: colors.surfaceSecondary,
                    borderColor: colors.borderFocus,
                  }
                : {
                    backgroundColor: 'transparent',
                    borderColor: colors.borderSubtle,
                  },
            ]}>
            <RocketText
              color={activeFilter === 'direct' ? 'primary' : 'muted'}
              style={styles.filterText}
              variant="buttonSmall">
              Direct {visibleDirectCount}
            </RocketText>
          </RocketPressable>

          <RocketPressable
            accessibilityLabel="Show group conversations"
            accessibilityRole="tab"
            accessibilityState={{ selected: activeFilter === 'groups' }}
            onPress={() => setActiveFilter('groups')}
            style={[
              styles.filterPill,
              activeFilter === 'groups'
                ? {
                    backgroundColor: colors.surfaceSecondary,
                    borderColor: colors.borderFocus,
                  }
                : {
                    backgroundColor: 'transparent',
                    borderColor: colors.borderSubtle,
                  },
            ]}>
            <RocketText
              color={activeFilter === 'groups' ? 'primary' : 'muted'}
              style={styles.filterText}
              variant="buttonSmall">
              Groups {visibleGroupCount}
            </RocketText>
          </RocketPressable>
        </View>
      ) : null}

      {/* Archived Entry Row - Only shown when user has archived chats */}
      {totalArchivedCount > 0 ? (
        <RocketPressable
          accessibilityHint="Open your archived chats"
          accessibilityLabel={`Archived chats, ${totalArchivedCount} conversation${totalArchivedCount === 1 ? '' : 's'}`}
          accessibilityRole="button"
          onPress={() => router.push('/archived' as any)}
          pressedStyle={{ backgroundColor: colors.surfaceSecondary }}
          style={[
            styles.archivedBanner,
            { backgroundColor: colors.surface, borderColor: colors.borderSubtle },
          ]}>
          <View style={styles.archivedLeft}>
            <View
              style={[
                styles.archivedIconWrap,
                { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderSubtle },
              ]}>
              <Text style={styles.archivedGlyph}>📦</Text>
            </View>
            <View style={styles.archivedTextWrap}>
              <RocketText color="primary" variant="bodyMedium">
                Archived
              </RocketText>
              <RocketText color="muted" variant="caption">
                {totalArchivedCount} {totalArchivedCount === 1 ? 'chat' : 'chats'}
              </RocketText>
            </View>
          </View>
          <RocketText color="muted" style={styles.archivedChevron} variant="bodyMedium">
            ›
          </RocketText>
        </RocketPressable>
      ) : null}
    </View>
  );

  const renderEmptyComponent = () => {
    if (loading) {
      return (
        <View style={styles.stateCenter}>
          <RocketLoadingIndicator size="normal" />
          <RocketText color="muted" style={styles.stateMessage} variant="bodySecondary">
            Loading messages...
          </RocketText>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.stateCenter}>
          <RocketCard style={styles.errorCard} variant="outline">
            <RocketSpark color="warning" size="md" />
            <RocketText color="error" style={styles.errorText} variant="bodySecondary">
              {error}
            </RocketText>
          </RocketCard>
        </View>
      );
    }

    if (activeFilter === 'groups') {
      return (
        <RocketEmptyState
          action={
            <RocketButton
              fullWidth
              label="Create a group"
              onPress={() => router.push('/group/create')}
              size="md"
              variant="primary"
            />
          }
          body="Start a group conversation with multiple friends in your orbit."
          title="No groups yet"
        />
      );
    }

    if (activeFilter === 'direct') {
      return (
        <RocketEmptyState
          action={
            <RocketButton
              fullWidth
              label="Find a friend"
              onPress={() => router.push('/friends')}
              size="md"
              variant="primary"
            />
          }
          body="Open a chat from your friends list to begin a private conversation."
          title="No direct messages"
        />
      );
    }

    return (
      <RocketEmptyState
        action={
          <RocketButton
            fullWidth
            label="Find a friend"
            onPress={() => router.push('/friends')}
            size="md"
            variant="primary"
          />
        }
        body="Open a chat from your friends list or create a group."
        title="No conversations yet"
      />
    );
  };

  return (
    <RocketScreen
      contentContainerStyle={styles.screenContent}
      header={renderHeaderBar()}
      scroll={false}>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={loading || error ? [] : items}
        keyExtractor={(item) =>
          item.kind === 'group' ? `group-${item.group.id}` : `conv-${item.conversation.id}`
        }
        ListEmptyComponent={renderEmptyComponent}
        ListHeaderComponent={renderListHeader}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
      />

      <RocketChatActionSheet
        chatTitle={selectedTitle}
        isArchived={Boolean(selectedPref?.archived)}
        isMuted={Boolean(selectedPref?.muted)}
        isPinned={Boolean(selectedPref?.pinned)}
        onClose={() => setSelectedItem(null)}
        onDeleteChat={() => void handleDeleteChat()}
        onToggleArchive={() => void handleToggleArchive()}
        onToggleMute={() => void handleToggleMute()}
        onTogglePin={() => void handleTogglePin()}
        visible={!!selectedItem}
      />
    </RocketScreen>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingHorizontal: 0,
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SpacingScale.lg,
    paddingTop: SpacingScale.xs,
    paddingBottom: SpacingScale.sm,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.sm,
  },
  profileButton: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listHeader: {
    paddingHorizontal: SpacingScale.lg,
    paddingTop: SpacingScale.md,
    paddingBottom: SpacingScale.md,
  },
  titleSection: {
    marginBottom: SpacingScale.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.sm,
  },
  screenTitle: {
    letterSpacing: -0.6,
  },
  screenSubtitle: {
    marginTop: 4,
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.sm,
    marginTop: SpacingScale.xs,
  },
  filterPill: {
    minHeight: 34,
    paddingHorizontal: SpacingScale.md,
    paddingVertical: 6,
    borderRadius: 9999,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterText: {
    fontSize: 12,
  },
  archivedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SpacingScale.md,
    paddingVertical: SpacingScale.sm,
    borderRadius: Radius.lg,
    borderWidth: 1,
    marginTop: SpacingScale.md,
  },
  archivedLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.md,
  },
  archivedIconWrap: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  archivedGlyph: {
    fontSize: 16,
  },
  archivedTextWrap: {
    gap: 2,
  },
  archivedChevron: {
    fontSize: 20,
    fontWeight: '300',
    marginRight: SpacingScale.xs,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: SpacingScale.huge,
  },
  stateCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: SpacingScale.epic,
    paddingHorizontal: SpacingScale.xl,
  },
  stateMessage: {
    marginTop: SpacingScale.md,
    textAlign: 'center',
  },
  errorCard: {
    alignItems: 'center',
    padding: SpacingScale.xl,
    gap: SpacingScale.sm,
    maxWidth: 320,
  },
  errorText: {
    textAlign: 'center',
    lineHeight: 20,
  },
});
