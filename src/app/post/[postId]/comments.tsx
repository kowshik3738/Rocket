import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar, colors } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';
import { addComment, PostComment, subscribeToComments } from '@/services/posts-service';
import { getProfileColor, getProfileInitials } from '@/services/user-service';

export default function CommentsScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [comments, setComments] = useState<PostComment[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!postId) return;
    setLoading(true);
    return subscribeToComments(postId, (nextComments) => { setComments(nextComments); setLoading(false); }, (commentError) => { setError(commentError.message); setLoading(false); });
  }, [postId]);
  async function handleAddComment() {
    if (!user || !postId || !text.trim()) return;
    setSending(true); setError('');
    try { await addComment(postId, user.uid, text); setText(''); } catch (commentError) { setError(commentError instanceof Error ? commentError.message : 'Could not add your comment.'); } finally { setSending(false); }
  }
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={page.container}><View style={page.header}><Pressable onPress={() => router.back()}><Text style={page.back}>‹</Text></Pressable><Text style={page.title}>Comments</Text><View style={page.spacer} /></View>{loading ? <View style={page.state}><ActivityIndicator color={colors.accent} /></View> : <ScrollView contentContainerStyle={page.list}>{comments.length === 0 ? <View style={page.empty}><Text style={page.emptyTitle}>No comments yet</Text><Text style={page.emptyText}>Start the conversation.</Text></View> : comments.map((comment) => { const avatar = { initials: getProfileInitials(comment.author.displayName), color: getProfileColor(comment.author.uid) }; return <View key={comment.commentId} style={page.comment}><Avatar user={avatar} size={36} /><View style={page.commentBody}><Text style={page.author}>{comment.author.displayName} <Text style={page.handle}>@{comment.author.username}</Text></Text><Text style={page.commentText}>{comment.text}</Text></View></View>; })}</ScrollView>}{error ? <Text style={page.error}>{error}</Text> : null}<View style={page.composer}><TextInput multiline onChangeText={(value) => setText(value.slice(0, 500))} placeholder="Write a comment..." placeholderTextColor={colors.textSecondary} style={page.input} value={text} /><Pressable disabled={sending || !text.trim()} onPress={() => void handleAddComment()} style={[page.send, (!text.trim() || sending) && page.disabled]}><Text style={page.sendText}>↑</Text></Pressable></View></KeyboardAvoidingView>;
}

const page = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.background, paddingTop: 46 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: colors.border }, back: { color: colors.text, fontSize: 31, lineHeight: 31 }, title: { color: colors.text, fontSize: 19, fontWeight: '800' }, spacer: { width: 22 }, list: { padding: 20, flexGrow: 1 }, state: { flex: 1, alignItems: 'center', justifyContent: 'center' }, empty: { alignItems: 'center', paddingVertical: 80 }, emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800' }, emptyText: { color: colors.textSecondary, marginTop: 7 }, comment: { flexDirection: 'row', marginBottom: 18 }, commentBody: { flex: 1, marginLeft: 10 }, author: { color: colors.text, fontSize: 13, fontWeight: '800' }, handle: { color: colors.textSecondary, fontWeight: '400' }, commentText: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 4 }, composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 9, padding: 12, borderTopWidth: 1, borderTopColor: colors.border }, input: { flex: 1, maxHeight: 90, minHeight: 44, borderRadius: 16, backgroundColor: colors.backgroundElement, color: colors.text, paddingHorizontal: 14, paddingVertical: 11 }, send: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.45 }, sendText: { color: '#FFF', fontSize: 22, fontWeight: '800' }, error: { color: colors.accent, textAlign: 'center', padding: 8, fontSize: 12 } });
