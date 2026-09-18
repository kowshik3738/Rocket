import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, Card, colors } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';
import { deletePost, Post, setLikeState, subscribeToPostStats } from '@/services/posts-service';
import { getProfileColor, getProfileInitials } from '@/services/user-service';

export function PostCard({ post }: { post: Post }) {
  const { user } = useAuth();
  const [stats, setStats] = useState({ likeCount: post.likeCount, commentCount: post.commentCount, likedByViewer: post.likedByViewer });
  const [likeBusy, setLikeBusy] = useState(false);
  const [photoSize, setPhotoSize] = useState({ width: 1, height: 1 });
  const [photoViewerVisible, setPhotoViewerVisible] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState('');
  const photoTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLike = useRef<{ liked: boolean; count: number } | null>(null);
  const desiredLike = useRef<boolean | null>(null);
  const likeSyncRunning = useRef(false);
  const heartScale = useRef(new Animated.Value(0.6)).current;
  const heartOpacity = useRef(new Animated.Value(0)).current;
  const avatar = { initials: getProfileInitials(post.author.displayName), color: getProfileColor(post.author.uid) };
  useEffect(() => subscribeToPostStats(post, user?.uid ?? '', (nextStats) => {
    const optimistic = pendingLike.current;
    setStats(optimistic ? { ...nextStats, likedByViewer: optimistic.liked, likeCount: nextStats.likeCount + (optimistic.liked === nextStats.likedByViewer ? 0 : optimistic.liked ? 1 : -1) } : nextStats);
  }, (statsError) => setError(statsError.message)), [post, user?.uid]);
  async function syncDesiredLike() {
    if (!user || likeSyncRunning.current) return;
    likeSyncRunning.current = true;
    setLikeBusy(true);
    try {
      while (desiredLike.current !== null) {
        const desired = desiredLike.current;
        await setLikeState(post.postId, user.uid, desired);
        if (desiredLike.current === desired) {
          desiredLike.current = null;
          pendingLike.current = null;
        }
      }
    } catch (likeError) {
      const failedDesired = desiredLike.current;
      desiredLike.current = null;
      pendingLike.current = null;
      if (failedDesired !== null) setStats((current) => ({ ...current, likedByViewer: !failedDesired, likeCount: Math.max(0, current.likeCount + (failedDesired ? -1 : 1)) }));
      setError(likeError instanceof Error ? likeError.message : 'Could not update your like.');
    } finally {
      likeSyncRunning.current = false;
      setLikeBusy(false);
    }
  }
  function requestLikeState(nextLiked: boolean) {
    if (!user) return;
    desiredLike.current = nextLiked;
    pendingLike.current = { liked: nextLiked, count: stats.likeCount };
    setStats((current) => ({ ...current, likedByViewer: nextLiked, likeCount: Math.max(0, current.likeCount + (nextLiked === current.likedByViewer ? 0 : nextLiked ? 1 : -1)) }));
    setError('');
    void syncDesiredLike();
  }
  function handleLike() {
    requestLikeState(!(desiredLike.current ?? stats.likedByViewer));
  }
  async function handlePhotoDoubleTap() {
    showHeart();
    if (!user || (desiredLike.current ?? stats.likedByViewer)) return;
    requestLikeState(true);
  }
  function showHeart() {
    heartScale.stopAnimation();
    heartOpacity.stopAnimation();
    heartScale.setValue(0.6);
    heartOpacity.setValue(1);
    Animated.parallel([
      Animated.sequence([Animated.timing(heartScale, { toValue: 1.25, duration: 180, useNativeDriver: true }), Animated.timing(heartScale, { toValue: 1, duration: 120, useNativeDriver: true })]),
      Animated.timing(heartOpacity, { toValue: 0, duration: 420, delay: 160, useNativeDriver: true }),
    ]).start();
  }
  function handlePhotoPress() {
    if (photoTapTimer.current) {
      clearTimeout(photoTapTimer.current);
      photoTapTimer.current = null;
      void handlePhotoDoubleTap();
      return;
    }
    photoTapTimer.current = setTimeout(() => {
      photoTapTimer.current = null;
      setPhotoViewerVisible(true);
    }, 180);
  }
  async function handleDelete() {
    if (!user || deleteBusy || user.uid !== post.authorUid) return;
    setDeleteBusy(true);
    setError('');
    try { await deletePost(post.postId); } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : 'Could not delete this post.'); } finally { setDeleteBusy(false); }
  }
  function confirmDelete() {
    if (deleteBusy) return;
    Alert.alert('Delete post?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete post', style: 'destructive', onPress: () => void handleDelete() },
    ]);
  }
  const time = post.createdAt?.toDate().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) ?? 'Just now';
  function handleAuthorPress() {
    const route = user?.uid === post.authorUid ? '/(tabs)/profile' : { pathname: '/user/[uid]' as const, params: { uid: post.authorUid } };
    router.push(route);
  }
  return <Card style={page.card}><View style={page.header}><View style={page.headerInfo}><Pressable onPress={handleAuthorPress} hitSlop={8}><Avatar user={avatar} size={42} /></Pressable><Pressable onPress={handleAuthorPress} style={page.author}><Text style={page.name}>{post.author.displayName}</Text><Text style={page.meta}>@{post.author.username} · {time}</Text></Pressable></View>{user?.uid === post.authorUid ? <Pressable accessibilityLabel="Post options" disabled={deleteBusy} onPress={confirmDelete}><Text style={page.menu}>...</Text></Pressable> : null}</View>{post.imageUrl ? <Pressable accessibilityLabel="Open post photo" onPress={handlePhotoPress}><Image contentFit="contain" source={post.imageUrl} onLoad={({ source }) => setPhotoSize({ width: source.width, height: source.height })} style={[page.image, { aspectRatio: photoSize.width / photoSize.height }]} /><Animated.Text pointerEvents="none" style={[page.heart, { opacity: heartOpacity, transform: [{ scale: heartScale }] }]}>♥</Animated.Text></Pressable> : null}{post.text ? <Text style={page.text}>{post.text}</Text> : null}<View style={page.actions}><Pressable onPress={handleLike} style={page.actionButton}><Text style={[page.action, stats.likedByViewer && page.liked]}>{stats.likedByViewer ? '♥' : '♡'} <Text style={page.count}>{stats.likeCount}</Text></Text></Pressable><Pressable onPress={() => router.push(`/post/${post.postId}/comments`)} style={page.actionButton}><Text style={page.action}>◯ <Text style={page.count}>{stats.commentCount}</Text></Text></Pressable></View>{error ? <Text style={page.error}>{error}</Text> : null}<Modal animationType="fade" visible={photoViewerVisible} onRequestClose={() => setPhotoViewerVisible(false)}><View style={page.viewer}><Pressable accessibilityLabel="Close photo" onPress={() => setPhotoViewerVisible(false)} style={page.close}><Text style={page.closeText}>X</Text></Pressable><Image contentFit="contain" source={post.imageUrl} style={page.viewerImage} /></View></Modal></Card>;
}

const page = StyleSheet.create({ card: { padding: 14, marginBottom: 14 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, headerInfo: { flexDirection: 'row', alignItems: 'center' }, author: { marginLeft: 10 }, name: { color: colors.text, fontSize: 14, fontWeight: '800' }, meta: { color: colors.textSecondary, fontSize: 11, marginTop: 3 }, menu: { color: colors.textSecondary, fontSize: 18, fontWeight: '800', paddingHorizontal: 6 }, image: { width: '100%', maxHeight: 480, borderRadius: 16, marginTop: 14 }, heart: { position: 'absolute', top: '40%', left: '45%', color: '#FFF', fontSize: 88, textShadowColor: 'rgba(0, 0, 0, 0.35)', textShadowRadius: 8 }, text: { color: colors.text, fontSize: 16, lineHeight: 23, marginTop: 15 }, actions: { flexDirection: 'row', gap: 22, marginTop: 16 }, actionButton: { minWidth: 72, minHeight: 44, justifyContent: 'center' }, action: { color: colors.textSecondary, fontSize: 30, fontWeight: '700' }, count: { fontSize: 14 }, liked: { color: colors.accent }, error: { color: colors.accent, fontSize: 11, marginTop: 9 }, viewer: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }, viewerImage: { width: '100%', height: '100%' }, close: { position: 'absolute', zIndex: 1, top: 54, right: 20, width: 44, height: 44, borderRadius: 22, backgroundColor: '#333', alignItems: 'center', justifyContent: 'center' }, closeText: { color: '#FFF', fontSize: 18, fontWeight: '800' } });
