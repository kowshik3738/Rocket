import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, Card, colors, Screen, SectionTitle } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';
import { createOrGetConversation } from '@/services/messaging-service';
import { acceptFriendRequest, declineFriendRequest, Friend, FriendRequest, getFriends, getIncomingFriendRequests, unfriend } from '@/services/social-service';
import { getProfileColor, getProfileInitials } from '@/services/user-service';

export default function FriendsScreen() {
  const { user } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState('');
  const [chatId, setChatId] = useState('');

  async function loadSocialData() {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const [nextFriends, nextRequests] = await Promise.all([getFriends(user.uid), getIncomingFriendRequests(user.uid)]);
      setFriends(nextFriends);
      setRequests(nextRequests);
    } catch {
      setError('We could not load your friends right now. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSocialData();
  }, [user]);

  async function handleRequestAction(request: FriendRequest, action: 'accept' | 'decline') {
    if (!user) return;
    setActionId(request.id);
    setError('');
    try {
      if (action === 'accept') {
        await acceptFriendRequest(request, user.uid);
      } else {
        await declineFriendRequest(request, user.uid);
      }
      await loadSocialData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not update that friend request.');
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
      setError(chatError instanceof Error ? chatError.message : 'Could not open this conversation.');
    } finally {
      setChatId('');
    }
  }

  function confirmUnfriend(friend: Friend) {
    if (!user || actionId) return;
    Alert.alert(
      'Remove Friend',
      `Are you sure you want to remove ${friend.displayName} (@${friend.username}) from your friends?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void executeUnfriend(friend);
          },
        },
      ],
    );
  }

  async function executeUnfriend(friend: Friend) {
    if (!user || actionId) return;
    setActionId(friend.uid);
    setError('');
    try {
      await unfriend(user.uid, friend.uid);
      await loadSocialData();
    } catch (unfriendError) {
      setError(unfriendError instanceof Error ? unfriendError.message : 'Could not remove friend. Check your connection and try again.');
    } finally {
      setActionId('');
    }
  }

  return (
    <Screen>
      <View style={page.header}>
        <View>
          <Text style={page.title}>Friends</Text>
          <Text style={page.subtitle}>The people in your orbit.</Text>
        </View>
        <Pressable onPress={() => router.push('/(tabs)/search')}>
          <Text style={page.add}>Find people</Text>
        </Pressable>
      </View>
      {error ? <Text style={page.error}>{error}</Text> : null}
      {loading ? (
        <View style={page.loading}>
          <ActivityIndicator color={colors.accent} />
          <Text style={page.loadingText}>Loading your orbit...</Text>
        </View>
      ) : (
        <>
          <SectionTitle title="Your connections" action={`${friends.length} ${friends.length === 1 ? 'friend' : 'friends'}`} />
          {friends.length === 0 ? (
            <Card style={page.empty}>
              <Text style={page.emptyIcon}>✦</Text>
              <Text style={page.emptyTitle}>Find people to start your orbit.</Text>
              <Text style={page.emptyText}>Search by username to send your first friend request.</Text>
            </Card>
          ) : (
            friends.map((friend) => {
              const avatar = { initials: getProfileInitials(friend.displayName), color: getProfileColor(friend.uid) };
              const isRemoving = actionId === friend.uid;
              const isOpening = chatId === friend.uid;
              const isBusy = isRemoving || isOpening;
              return (
                <Card key={friend.uid} style={page.friend}>
                  <Pressable
                    disabled={isBusy}
                    onPress={() => void handleOpenChat(friend)}
                    style={page.friendContent}
                  >
                    <Avatar user={avatar} size={50} />
                    <View style={page.info}>
                      <Text style={page.name}>{friend.displayName}</Text>
                      <Text style={page.handle}>@{friend.username}</Text>
                    </View>
                  </Pressable>
                  <View style={page.friendActions}>
                    <Pressable
                      disabled={isBusy}
                      onPress={() => void handleOpenChat(friend)}
                      style={[page.messageButton, isBusy && page.buttonDisabled]}
                    >
                      <Text style={page.messageButtonText}>{isOpening ? 'Opening...' : 'Message'}</Text>
                    </Pressable>
                    <Pressable
                      disabled={isBusy}
                      onPress={() => confirmUnfriend(friend)}
                      style={[page.unfriendButton, isBusy && page.buttonDisabled]}
                    >
                      <Text style={page.unfriendButtonText}>{isRemoving ? 'Removing...' : 'Remove'}</Text>
                    </Pressable>
                  </View>
                </Card>
              );
            })
          )}
          <View style={page.requestHeader}>
            <Text style={page.heading}>Incoming requests</Text>
            <Text style={page.count}>{requests.length} pending</Text>
          </View>
          {requests.length === 0 ? (
            <Card style={page.empty}>
              <Text style={page.emptyIcon}>✦</Text>
              <Text style={page.emptyText}>No incoming requests right now.</Text>
            </Card>
          ) : (
            requests.map((request) => {
              if (!request.sender) return null;
              const avatar = { initials: getProfileInitials(request.sender.displayName), color: getProfileColor(request.sender.uid) };
              return (
                <Card key={request.id} style={page.request}>
                  <Avatar user={avatar} size={46} />
                  <View style={page.info}>
                    <Text style={page.name}>{request.sender.displayName}</Text>
                    <Text style={page.handle}>@{request.sender.username}</Text>
                  </View>
                  <View style={page.requestActions}>
                    <Pressable disabled={actionId === request.id} onPress={() => void handleRequestAction(request, 'accept')} style={page.accept}>
                      <Text style={page.acceptText}>Accept</Text>
                    </Pressable>
                    <Pressable disabled={actionId === request.id} onPress={() => void handleRequestAction(request, 'decline')} style={page.decline}>
                      <Text style={page.declineText}>Decline</Text>
                    </Pressable>
                  </View>
                </Card>
              );
            })
          )}
        </>
      )}
    </Screen>
  );
}

const page = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginTop: 16, marginBottom: 29 },
  title: { color: colors.text, fontSize: 28, fontWeight: '900' },
  add: { color: colors.accent, fontSize: 13, fontWeight: '800', marginTop: 7 },
  subtitle: { color: colors.textSecondary, marginTop: 7 },
  friend: { padding: 13, flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  friendContent: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  friendActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  messageButton: { borderRadius: 10, backgroundColor: colors.backgroundElement, paddingVertical: 7, paddingHorizontal: 10 },
  messageButtonText: { color: colors.text, fontSize: 11, fontWeight: '700' },
  unfriendButton: { borderRadius: 10, backgroundColor: colors.backgroundSelected, paddingVertical: 7, paddingHorizontal: 10 },
  unfriendButtonText: { color: colors.accent, fontSize: 11, fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
  info: { flex: 1, marginLeft: 12 },
  name: { color: colors.text, fontSize: 14, fontWeight: '800' },
  handle: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  connected: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  requestHeader: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 23, marginBottom: 12 },
  heading: { color: colors.text, fontSize: 18, fontWeight: '800' },
  count: { color: colors.accent, fontSize: 12, fontWeight: '800' },
  empty: { alignItems: 'center', padding: 22, marginBottom: 10 },
  emptyIcon: { color: colors.accentSecondary, fontSize: 21 },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '800', textAlign: 'center', marginTop: 8 },
  emptyText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 8 },
  request: { padding: 12, flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  requestActions: { gap: 6 },
  accept: { borderRadius: 10, backgroundColor: colors.accent, paddingVertical: 7, paddingHorizontal: 10 },
  acceptText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  decline: { paddingVertical: 5, alignItems: 'center' },
  declineText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  loading: { alignItems: 'center', paddingVertical: 50 },
  loadingText: { color: colors.textSecondary, fontSize: 13, marginTop: 9 },
  error: { color: colors.accent, fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 12 },
});
