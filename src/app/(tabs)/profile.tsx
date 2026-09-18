import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { PostCard } from '@/components/post-card';
import { Avatar, Card, colors, Screen } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';
import { getPostCount, Post, subscribeToFeed } from '@/services/posts-service';
import { getFriends } from '@/services/social-service';
import { getProfileColor, getProfileInitials } from '@/services/user-service';

export default function ProfileScreen() {
  const { profile, user } = useAuth();
  const [friendCount, setFriendCount] = useState(0);
  const [postCount, setPostCount] = useState(0);
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let unsubscribePosts: () => void = () => undefined;

    void Promise.all([getFriends(user.uid), getPostCount(user.uid)]).then(([friends, postsTotal]) => {
      setFriendCount(friends.length);
      setPostCount(postsTotal);
    }).catch(() => {
      setFriendCount(0);
      setPostCount(0);
    });

    setPostsLoading(true);
    unsubscribePosts = subscribeToFeed(user.uid, [user.uid], (nextPosts) => {
      setPosts(nextPosts);
      setPostsLoading(false);
    }, () => {
      setPosts([]);
      setPostsLoading(false);
    });

    return () => unsubscribePosts();
  }, [user]);

  if (!profile) {
    return <Screen scroll={false}><View style={page.loading}><Text style={page.loadingTitle}>Profile setup required</Text><Text style={page.loadingText}>Your Rocket profile could not be found.</Text></View></Screen>;
  }
  const profileUser = { name: profile.displayName, handle: profile.username, initials: getProfileInitials(profile.displayName), color: getProfileColor(profile.uid) };
  return <Screen><View style={page.top}><Text style={page.title}>Profile</Text><Pressable onPress={() => router.push('/settings')}><Text style={page.settings}>Settings</Text></Pressable></View><View style={page.profile}><Avatar user={profileUser} size={88} /><Text style={page.name}>{profile.displayName}</Text><Text style={page.handle}>@{profile.username}</Text>{profile.bio ? <Text style={page.bio}>{profile.bio}</Text> : null}<View style={page.stats}><View><Text style={page.statNumber}>{postCount}</Text><Text style={page.statLabel}>Posts</Text></View><View><Text style={page.statNumber}>{friendCount}</Text><Text style={page.statLabel}>Friends</Text></View></View></View>{postsLoading ? <View style={page.postsState}><ActivityIndicator color={colors.accent} size="small" /><Text style={page.postsStateText}>Loading posts...</Text></View> : posts.length === 0 ? <Card style={page.emptyPosts}><Text style={page.emptyPostsText}>No posts yet.</Text></Card> : posts.map((post) => <PostCard key={post.postId} post={post} />)}<Card style={page.profileCard}><Text style={page.cardTitle}>Your profile is just getting started</Text><Text style={page.cardBody}>Add a profile photo and share your first post to make this space yours.</Text><Pressable onPress={() => router.push('/edit-profile')} style={page.edit}><Text style={page.editText}>Edit profile</Text></Pressable></Card><Pressable onPress={() => router.push('/friends')} style={page.row}><Text style={page.rowTitle}>Friends & connections</Text><Text style={page.arrow}>›</Text></Pressable></Screen>;
}
const page = StyleSheet.create({ top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }, title: { color: colors.text, fontSize: 28, fontWeight: '900' }, settings: { color: colors.accent, fontSize: 13, fontWeight: '800' }, profile: { alignItems: 'center', marginTop: 28 }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }, loadingTitle: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center' }, loadingText: { color: colors.textSecondary, textAlign: 'center', marginTop: 8 }, name: { color: colors.text, fontSize: 21, fontWeight: '900', marginTop: 13 }, handle: { color: colors.textSecondary, fontSize: 13, marginTop: 4 }, bio: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', maxWidth: 250, lineHeight: 20, marginTop: 13 }, stats: { flexDirection: 'row', gap: 42, marginTop: 25, marginBottom: 29 }, statNumber: { color: colors.text, textAlign: 'center', fontSize: 18, fontWeight: '900' }, statLabel: { color: colors.textSecondary, textAlign: 'center', fontSize: 11, marginTop: 5 }, postsState: { alignItems: 'center', paddingVertical: 18 }, postsStateText: { color: colors.textSecondary, marginTop: 8, fontSize: 12 }, emptyPosts: { alignItems: 'center', padding: 22, marginBottom: 18 }, emptyPostsText: { color: colors.text, fontSize: 15, fontWeight: '700' }, profileCard: { padding: 18, marginTop: 18 }, cardTitle: { color: colors.text, fontSize: 15, fontWeight: '800' }, cardBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 7 }, edit: { marginTop: 14, alignSelf: 'flex-start', paddingVertical: 9, paddingHorizontal: 14, borderRadius: 11, backgroundColor: colors.backgroundSelected }, editText: { color: colors.accentSecondary, fontSize: 12, fontWeight: '800' }, row: { flexDirection: 'row', paddingVertical: 24, borderBottomWidth: 1, borderBottomColor: colors.border, justifyContent: 'space-between' }, rowTitle: { color: colors.text, fontSize: 15, fontWeight: '700' }, arrow: { color: colors.textSecondary, fontSize: 25, lineHeight: 19 } });
