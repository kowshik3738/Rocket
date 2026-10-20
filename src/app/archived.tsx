import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, ListRenderItem, StyleSheet, View } from 'react-native';
import { Timestamp } from 'firebase/firestore';

import { RocketChatActionSheet } from '@/components/RocketChatActionSheet';
import {
  RocketButton,
  RocketChatRow,
  RocketEmptyState,
  RocketHeader,
  RocketLoadingIndicator,
  RocketScreen,
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

type UnifiedArchivedItem =
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

export default function ArchivedScreen() {
  const { user } = useAuth();
  const { colors } = useRocketTheme();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [preferences, setPreferences] = useState<ChatPreferencesMap>({});
  const [loading, setLoading] = useState(true);

  // Action sheet state
  const [selectedItem, setSelectedItem] = useState<UnifiedArchivedItem | null>(null);

  useEffect(() => {
    if (!user) return;
    setLoading(true);

    let convDone = false;
    let grpDone = false;

    const checkDone = () => {
      if (convDone && grpDone) {
        setLoading(false);
      }
    };

    const unsubscribeConv = subscribeToConversations(
      user.uid,
      (nextConv) => {
        setConversations(nextConv);
        convDone = true;
        checkDone();
      },
      () => {
        convDone = true;
        checkDone();
      }
    );

    const unsubscribeGroups = subscribeToGroups(
      user.uid,
      (nextGroups) => {
        setGroups(nextGroups);
        grpDone = true;
        checkDone();
      },
      () => {
        grpDone = true;
        checkDone();
      }
    );

    const unsubscribePrefs = subscribeToChatPreferences(user.uid, (nextPrefs) => {
      setPreferences(nextPrefs);
    });

    return () => {
      unsubscribeConv();
      unsubscribeGroups();
      unsubscribePrefs();
    };
  }, [user]);

  const items: UnifiedArchivedItem[] = useMemo(() => {
    const list: UnifiedArchivedItem[] = [];

    for (const group of groups) {
      if (preferences[group.id]?.archived && !preferences[group.id]?.deleted) {
        list.push({
          kind: 'group',
          group,
          sortTime: group.lastMessageAt?.toMillis() ?? 0,
        });
      }
    }

    for (const conversation of conversations) {
      if (conversation.otherUser && preferences[conversation.id]?.archived && !preferences[conversation.id]?.deleted) {
        list.push({
          kind: 'conversation',
          conversation,
          sortTime: conversation.lastMessageAt?.toMillis() ?? 0,
        });
      }
    }

    list.sort((a, b) => b.sortTime - a.sortTime);
    return list;
  }, [groups, conversations, preferences]);

  const handleTogglePin = async () => {
    if (!user || !selectedItem) return;
    const chatId = selectedItem.kind === 'group' ? selectedItem.group.id : selectedItem.conversation.id;
    const chatType = selectedItem.kind === 'group' ? 'group' : 'direct';
    const currentPinned = Boolean(preferences[chatId]?.pinned);
    await setChatPinned(user.uid, chatId, chatType, !currentPinned);
  };

  const handleToggleArchive = async () => {
    if (!user || !selectedItem) return;
    const chatId = selectedItem.kind === 'group' ? selectedItem.group.id : selectedItem.conversation.id;
    const chatType = selectedItem.kind === 'group' ? 'group' : 'direct';
    const currentArchived = Boolean(preferences[chatId]?.archived);
    await setChatArchived(user.uid, chatId, chatType, !currentArchived);
  };

  const handleToggleMute = async () => {
    if (!user || !selectedItem) return;
    const chatId = selectedItem.kind === 'group' ? selectedItem.group.id : selectedItem.conversation.id;
    const chatType = selectedItem.kind === 'group' ? 'group' : 'direct';
    const currentMuted = Boolean(preferences[chatId]?.muted);
    await setChatMuted(user.uid, chatId, chatType, !currentMuted);
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
            await deleteChatForUser(user.uid, chatId, chatType);
            setSelectedItem(null);
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
    const chatId = selectedItem.kind === 'group' ? selectedItem.group.id : selectedItem.conversation.id;
    return preferences[chatId];
  }, [selectedItem, preferences]);

  const renderItem: ListRenderItem<UnifiedArchivedItem> = ({ item, index }) => {
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

  const renderEmptyComponent = () => {
    if (loading) {
      return (
        <View style={styles.stateCenter}>
          <RocketLoadingIndicator size="normal" />
          <RocketText color="muted" style={styles.stateMessage} variant="bodySecondary">
            Loading archived chats...
          </RocketText>
        </View>
      );
    }

    return (
      <RocketEmptyState
        action={
          <RocketButton
            fullWidth
            label="Back to messages"
            onPress={() => router.back()}
            size="md"
            variant="primary"
          />
        }
        body="Chats you archive will appear here safely out of your main inbox."
        title="No archived chats"
      />
    );
  };

  return (
    <RocketScreen
      contentContainerStyle={styles.screenContent}
      header={
        <RocketHeader
          borderBottom
          onBack={() => router.back()}
          subtitle={`${items.length} conversation${items.length === 1 ? '' : 's'}`}
          title="Archived"
        />
      }
      scroll={false}>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={loading ? [] : items}
        keyExtractor={(item) =>
          item.kind === 'group' ? `group-${item.group.id}` : `conv-${item.conversation.id}`
        }
        ListEmptyComponent={renderEmptyComponent}
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
});
