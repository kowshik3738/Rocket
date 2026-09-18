import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, Card, Screen, colors } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';
import { Conversation, subscribeToConversations } from '@/services/messaging-service';
import { getProfileColor, getProfileInitials } from '@/services/user-service';

function formatTime(conversation: Conversation) {
  if (!conversation.lastMessageAt) return '';
  return conversation.lastMessageAt.toDate().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function ChatsScreen() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    setError('');
    return subscribeToConversations(user.uid, (nextConversations) => {
      setConversations(nextConversations);
      setLoading(false);
    }, (conversationError) => {
      setError(conversationError.message || 'We could not load your conversations.');
      setLoading(false);
    });
  }, [user]);

  return <Screen><View style={page.header}><View><Text style={page.title}>Messages</Text><Text style={page.subtitle}>Keep the conversation moving.</Text></View><Pressable onPress={() => router.push('/friends')} style={page.compose}><Text style={page.composeText}>＋</Text></Pressable></View>{loading ? <View style={page.state}><ActivityIndicator color={colors.accent} /><Text style={page.stateText}>Loading messages...</Text></View> : error ? <View style={page.state}><Text style={page.error}>{error}</Text></View> : conversations.length === 0 ? <Card style={page.empty}><Text style={page.emptyIcon}>✦</Text><Text style={page.emptyTitle}>No conversations yet</Text><Text style={page.emptyText}>Open a chat from your Friends list to start your orbit.</Text><Pressable onPress={() => router.push('/friends')} style={page.findButton}><Text style={page.findText}>Find a friend</Text></Pressable></Card> : conversations.map((conversation) => { if (!conversation.otherUser) return null; const otherUser = conversation.otherUser; const avatar = { initials: getProfileInitials(otherUser.displayName), color: getProfileColor(otherUser.uid) }; return <Pressable key={conversation.id} onPress={() => router.push(`/chat/${conversation.id}`)}><Card style={page.chat}><Avatar user={avatar} size={52} /><View style={page.info}><Text style={page.name}>{otherUser.displayName}</Text><Text style={page.handle}>@{otherUser.username}</Text><Text style={page.preview} numberOfLines={1}>{conversation.lastMessage || 'Start a conversation'}</Text></View><View style={page.trailing}><Text style={page.time}>{formatTime(conversation)}</Text></View></Card></Pressable>; })}</Screen>;
}

const page = StyleSheet.create({ header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, marginBottom: 29 }, title: { color: colors.text, fontSize: 28, fontWeight: '900' }, subtitle: { color: colors.textSecondary, marginTop: 7 }, compose: { width: 42, height: 42, borderRadius: 15, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }, composeText: { color: '#FFF', fontSize: 26, marginTop: -3 }, chat: { padding: 13, flexDirection: 'row', alignItems: 'center', marginBottom: 10 }, info: { flex: 1, marginLeft: 12 }, name: { color: colors.text, fontSize: 15, fontWeight: '800' }, handle: { color: colors.textSecondary, fontSize: 11, marginTop: 3 }, preview: { color: colors.textSecondary, fontSize: 12, marginTop: 6 }, trailing: { alignItems: 'flex-end', alignSelf: 'flex-start', paddingTop: 2 }, time: { color: colors.textSecondary, fontSize: 11 }, state: { alignItems: 'center', paddingVertical: 50 }, stateText: { color: colors.textSecondary, fontSize: 13, marginTop: 9 }, error: { color: colors.accent, fontSize: 13, lineHeight: 19, textAlign: 'center' }, empty: { alignItems: 'center', padding: 24, marginTop: 10 }, emptyIcon: { color: colors.accentSecondary, fontSize: 21 }, emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginTop: 10 }, emptyText: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 7 }, findButton: { borderRadius: 12, backgroundColor: colors.backgroundSelected, paddingVertical: 10, paddingHorizontal: 14, marginTop: 16 }, findText: { color: colors.accentSecondary, fontSize: 12, fontWeight: '800' } });
