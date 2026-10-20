import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Modal,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';

import { useAuth } from '@/providers/auth-provider';
import { deletePost, Post, setLikeState, subscribeToPostStats } from '@/services/posts-service';
import { getProfileColor, getProfileInitials } from '@/services/user-service';
import { Radius } from '../tokens/radius';
import { SpacingScale } from '../tokens/spacing';
import { useRocketTheme } from '../hooks/useRocketTheme';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { RocketAvatar } from './RocketAvatar';
import { RocketIconButton } from './RocketIconButton';
import { RocketPressable } from './RocketPressable';
import { RocketText } from './RocketText';

export interface RocketPostCardProps {
  post: Post;
  style?: StyleProp<ViewStyle>;
}

export function RocketPostCard({ post, style }: RocketPostCardProps) {
  const { user } = useAuth();
  const { colors } = useRocketTheme();
  const reducedMotion = useReducedMotion();

  const [stats, setStats] = useState({
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    likedByViewer: post.likedByViewer,
  });
  const [_likeBusy, setLikeBusy] = useState(false);
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

  const avatar = {
    initials: getProfileInitials(post.author.displayName),
    color: getProfileColor(post.author.uid),
  };

  useEffect(() => {
    return subscribeToPostStats(
      post,
      user?.uid ?? '',
      (nextStats) => {
        const optimistic = pendingLike.current;
        setStats(
          optimistic
            ? {
                ...nextStats,
                likedByViewer: optimistic.liked,
                likeCount:
                  nextStats.likeCount +
                  (optimistic.liked === nextStats.likedByViewer
                    ? 0
                    : optimistic.liked
                      ? 1
                      : -1),
              }
            : nextStats
        );
      },
      (statsError) => setError(statsError.message)
    );
  }, [post, user?.uid]);

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
      if (failedDesired !== null) {
        setStats((current) => ({
          ...current,
          likedByViewer: !failedDesired,
          likeCount: Math.max(0, current.likeCount + (failedDesired ? -1 : 1)),
        }));
      }
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
    setStats((current) => ({
      ...current,
      likedByViewer: nextLiked,
      likeCount: Math.max(
        0,
        current.likeCount + (nextLiked === current.likedByViewer ? 0 : nextLiked ? 1 : -1)
      ),
    }));
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
    if (reducedMotion) {
      heartOpacity.setValue(1);
      Animated.timing(heartOpacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start();
      return;
    }

    heartScale.stopAnimation();
    heartOpacity.stopAnimation();
    heartScale.setValue(0.6);
    heartOpacity.setValue(1);
    Animated.parallel([
      Animated.sequence([
        Animated.timing(heartScale, {
          toValue: 1.25,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(heartScale, {
          toValue: 1,
          duration: 120,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(heartOpacity, {
        toValue: 0,
        duration: 420,
        delay: 160,
        useNativeDriver: true,
      }),
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
    try {
      await deletePost(post.postId);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete this post.');
    } finally {
      setDeleteBusy(false);
    }
  }

  function confirmDelete() {
    if (deleteBusy) return;
    Alert.alert('Delete post?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete post', style: 'destructive', onPress: () => void handleDelete() },
    ]);
  }

  const time = post.createdAt
    ? post.createdAt
        .toDate()
        .toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Just now';

  function handleAuthorPress() {
    const route =
      user?.uid === post.authorUid
        ? '/(tabs)/profile'
        : { pathname: '/user/[uid]' as const, params: { uid: post.authorUid } };
    router.push(route);
  }

  const isTextOnly = !post.imageUrl;
  const isAuthor = user?.uid === post.authorUid;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.borderSubtle,
        },
        style,
      ]}>
      {/* Author Header */}
      <View style={styles.header}>
        <Pressable
          accessibilityHint="Go to user profile"
          accessibilityLabel={`Author ${post.author.displayName}`}
          accessibilityRole="button"
          hitSlop={8}
          onPress={handleAuthorPress}
          style={styles.authorRow}>
          <RocketAvatar
            hasOrbit={false}
            size={40}
            source={post.author.photoUrl}
            user={avatar}
          />
          <View style={styles.authorInfo}>
            <RocketText
              numberOfLines={1}
              style={styles.authorName}
              variant="bodyMedium">
              {post.author.displayName}
            </RocketText>
            <RocketText
              color="muted"
              numberOfLines={1}
              style={styles.authorMeta}
              variant="caption">
              @{post.author.username} · {time}
            </RocketText>
          </View>
        </Pressable>

        {isAuthor ? (
          <RocketIconButton
            accessibilityHint="Delete your post"
            accessibilityLabel="Post options"
            disabled={deleteBusy}
            glyph="⋯"
            glyphStyle={styles.menuGlyph}
            onPress={confirmDelete}
            size="sm"
            variant="ghost"
          />
        ) : null}
      </View>

      {/* Post Text / Caption */}
      {post.text ? (
        <View style={styles.textContainer}>
          <RocketText
            color="primary"
            style={isTextOnly ? styles.textOnlyPost : styles.captionText}
            variant={isTextOnly ? 'bodyMedium' : 'body'}>
            {post.text}
          </RocketText>
        </View>
      ) : null}

      {/* Post Photo Media */}
      {post.imageUrl ? (
        <Pressable
          accessibilityHint="Double tap to like, single tap to open full screen"
          accessibilityLabel="Post photo"
          accessibilityRole="imagebutton"
          onPress={handlePhotoPress}
          style={styles.imageContainer}>
          <Image
            contentFit="cover"
            onLoad={({ source }) =>
              setPhotoSize({ width: source.width || 1, height: source.height || 1 })
            }
            source={post.imageUrl}
            style={[
              styles.image,
              {
                aspectRatio: Math.max(0.75, Math.min(1.9, photoSize.width / photoSize.height)),
              },
            ]}
          />
          <Animated.Text
            pointerEvents="none"
            style={[
              styles.heartFeedback,
              {
                color: colors.highlight,
                opacity: heartOpacity,
                transform: [{ scale: heartScale }],
              },
            ]}>
            ♥
          </Animated.Text>
        </Pressable>
      ) : null}

      {/* Interaction Controls */}
      <View style={styles.actionsBar}>
        <RocketPressable
          accessibilityHint={stats.likedByViewer ? 'Unlike this post' : 'Like this post'}
          accessibilityLabel={`Like, ${stats.likeCount} likes`}
          accessibilityRole="button"
          accessibilityState={{ selected: stats.likedByViewer }}
          hitSlop={6}
          onPress={handleLike}
          style={[
            styles.actionPill,
            stats.likedByViewer && {
              backgroundColor: colors.highlightSubtle,
            },
          ]}>
          <Text
            style={[
              styles.actionGlyph,
              {
                color: stats.likedByViewer ? colors.highlight : colors.secondaryText,
              },
            ]}>
            {stats.likedByViewer ? '♥' : '♡'}
          </Text>
          <RocketText
            color={stats.likedByViewer ? 'highlight' : 'secondary'}
            style={styles.actionCount}
            variant="caption">
            {stats.likeCount}
          </RocketText>
        </RocketPressable>

        <RocketPressable
          accessibilityHint="View comments on this post"
          accessibilityLabel={`Comments, ${stats.commentCount} comments`}
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => router.push(`/post/${post.postId}/comments`)}
          style={styles.actionPill}>
          <Text style={[styles.actionGlyph, { color: colors.secondaryText }]}>💬</Text>
          <RocketText
            color="secondary"
            style={styles.actionCount}
            variant="caption">
            {stats.commentCount}
          </RocketText>
        </RocketPressable>
      </View>

      {/* Inline Error Notice */}
      {error ? (
        <RocketText color="error" style={styles.errorNotice} variant="caption">
          {error}
        </RocketText>
      ) : null}

      {/* Full-screen Photo Viewer Modal */}
      <Modal
        animationType="fade"
        onRequestClose={() => setPhotoViewerVisible(false)}
        transparent={false}
        visible={photoViewerVisible}>
        <View style={styles.viewerContainer}>
          <RocketIconButton
            accessibilityLabel="Close photo viewer"
            glyph="✕"
            glyphStyle={styles.viewerCloseText}
            onPress={() => setPhotoViewerVisible(false)}
            size="md"
            style={styles.viewerCloseButton}
            variant="filled"
          />
          {post.imageUrl ? (
            <Image
              contentFit="contain"
              source={post.imageUrl}
              style={styles.viewerImage}
            />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: SpacingScale.lg,
    marginBottom: SpacingScale.lg,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  authorRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.sm + 2,
  },
  authorInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  authorName: {
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  authorMeta: {
    marginTop: 2,
    letterSpacing: 0,
  },
  menuGlyph: {
    fontSize: 20,
    fontWeight: '800',
  },
  textContainer: {
    marginTop: SpacingScale.sm + 2,
  },
  captionText: {
    lineHeight: 22,
    letterSpacing: -0.1,
  },
  textOnlyPost: {
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: -0.2,
    paddingVertical: SpacingScale.xs,
  },
  imageContainer: {
    width: '100%',
    borderRadius: Radius.lg,
    overflow: 'hidden',
    marginTop: SpacingScale.md,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    maxHeight: 480,
    borderRadius: Radius.lg,
  },
  heartFeedback: {
    position: 'absolute',
    fontSize: 84,
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  actionsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.md,
    marginTop: SpacingScale.md,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.full,
    minHeight: 36,
  },
  actionGlyph: {
    fontSize: 17,
    fontWeight: '700',
    includeFontPadding: false,
  },
  actionCount: {
    fontWeight: '700',
    fontSize: 13,
  },
  errorNotice: {
    marginTop: SpacingScale.sm,
  },
  viewerContainer: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImage: {
    width: '100%',
    height: '100%',
  },
  viewerCloseButton: {
    position: 'absolute',
    top: 52,
    right: 20,
    zIndex: 10,
  },
  viewerCloseText: {
    fontSize: 16,
    fontWeight: '800',
  },
});
