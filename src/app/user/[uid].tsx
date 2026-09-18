import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { PostCard } from '@/components/post-card';
import { Avatar, Card, colors, Screen } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';
import { getPostCount, Post, subscribeToFeed } from '@/services/posts-service';
import { getFriends } from '@/services/social-service';
import { getProfileColor, getProfileInitials, getUserProfile, UserProfile } from '@/services/user-service';

export default function OtherUserProfileScreen() {
  const { user } = useAuth();
  const params = useLocalSearchParams<{ uid?: string | string[] }>();
  const uid = Array.isArray(params.uid) ? params.uid[0] : params.uid;
  const normalizedUid = uid ? String(uid) : null;
  const isOwnProfile = !!user && !!normalizedUid && user.uid === normalizedUid;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [friendCount, setFriendCount] = useState(0);
  const [postCount, setPostCount] = useState(0);
  const [posts, setPosts] = useState<Post[]>([]);
  const [profileLoading, setProfileLoading] = useState(true);
  const [postsLoading, setPostsLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    const safeUid = String(uid);
    let unsubscribePosts: () => void = () => undefined;
    setProfileLoading(true);
    setPostsLoading(true);

    void getUserProfile(safeUid)
      .then((nextProfile) => {
        setProfile(nextProfile);
        if (!nextProfile) {
          setFriendCount(0);
          setPostCount(0);
          return;
        }

        if (user?.uid === safeUid) {
          void Promise.all([getFriends(safeUid), getPostCount(safeUid)]).then(([friends, postsTotal]) => {
            setFriendCount(friends.length);
            setPostCount(postsTotal);
          }).catch((error: unknown) => {
            const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: string }).code) : 'unknown';
            console.warn('OtherUserProfileScreen own stats failed', { uid: safeUid, code });
            setFriendCount(0);
            setPostCount(0);
          });
        }
      })
      .catch((error: unknown) => {
        const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: string }).code) : 'unknown';
        console.warn('OtherUserProfileScreen profile read failed', { uid: safeUid, code });
        setProfile(null);
        setFriendCount(0);
        setPostCount(0);
      })
      .finally(() => setProfileLoading(false));

    unsubscribePosts = subscribeToFeed(safeUid, [safeUid], (nextPosts) => {
      setPosts(nextPosts);
      setPostsLoading(false);
    }, (error: Error) => {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: string }).code) : 'unknown';
      console.warn('OtherUserProfileScreen posts read failed', { uid: safeUid, code });
      setPosts([]);
      setPostsLoading(false);
    });

    return () => unsubscribePosts();
  }, [uid, user?.uid]);

  if (!uid) {
    return <Screen scroll={false}><View style={page.state}><Text style={page.stateTitle}>User profile not found</Text></View></Screen>;
  }

  if (profileLoading) {
    return <Screen scroll={false}><View style={page.state}><ActivityIndicator color={colors.accent} /><Text style={page.stateText}>Loading profile...</Text></View></Screen>;
  }

  if (!profile) {
    return <Screen scroll={false}><View style={page.state}><Text style={page.stateTitle}>Profile not found</Text><Text style={page.stateText}>This user could not be loaded.</Text></View></Screen>;
  }

  const profileUser = {
    name: profile.displayName,
    handle: profile.username,
    initials: getProfileInitials(profile.displayName),
    color: getProfileColor(profile.uid),
  };

  return <Screen><View style={page.profile}><Avatar user={profileUser} size={88} /><Text style={page.name}>{profile.displayName}</Text><Text style={page.handle}>@{profile.username}</Text>{profile.bio ? <Text style={page.bio}>{profile.bio}</Text> : null}{isOwnProfile ? <View style={page.stats}><View><Text style={page.statNumber}>{postCount}</Text><Text style={page.statLabel}>Posts</Text></View><View><Text style={page.statNumber}>{friendCount}</Text><Text style={page.statLabel}>Friends</Text></View></View> : null}</View>{postsLoading ? <View style={page.postsState}><ActivityIndicator color={colors.accent} size="small" /><Text style={page.postsStateText}>Loading posts...</Text></View> : posts.length === 0 ? <Card style={page.emptyPosts}><Text style={page.emptyPostsText}>No posts yet.</Text></Card> : posts.map((post) => <PostCard key={post.postId} post={post} />)}</Screen>;
}

const page = StyleSheet.create({
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  stateTitle: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  stateText: { color: colors.textSecondary, textAlign: 'center', marginTop: 8 },
  profile: { alignItems: 'center', marginTop: 28 },
  name: { color: colors.text, fontSize: 21, fontWeight: '900', marginTop: 13 },
  handle: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  bio: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', maxWidth: 250, lineHeight: 20, marginTop: 13 },
  stats: { flexDirection: 'row', gap: 42, marginTop: 25, marginBottom: 29 },
  statNumber: { color: colors.text, textAlign: 'center', fontSize: 18, fontWeight: '900' },
  statLabel: { color: colors.textSecondary, textAlign: 'center', fontSize: 11, marginTop: 5 },
  postsState: { alignItems: 'center', paddingVertical: 18 },
  postsStateText: { color: colors.textSecondary, marginTop: 8, fontSize: 12 },
  emptyPosts: { alignItems: 'center', padding: 22, marginBottom: 18 },
  emptyPostsText: { color: colors.text, fontSize: 15, fontWeight: '700' },
});
