import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { PostCard } from '@/components/post-card';
import { Brand, Card, Screen, SectionTitle, colors } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';
import { getFriends } from '@/services/social-service';
import { Post, subscribeToFeed } from '@/services/posts-service';

export default function FeedScreen() {
  const { profile, user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    let unsubscribePosts: () => void = () => undefined;
    setLoading(true);
    setError('');
    void getFriends(user.uid).then((friends) => {
      unsubscribePosts = subscribeToFeed(user.uid, [user.uid, ...friends.map((friend) => friend.uid)], setPosts, (feedError) => { setError(feedError.message || 'We could not load your feed.'); setLoading(false); });
      setLoading(false);
    }).catch(() => { setError('We could not load your orbit. Check your connection and try again.'); setLoading(false); });
    return () => unsubscribePosts();
  }, [user]);

  if (!profile) return <Screen scroll={false}><View style={page.missing}><Text style={page.missingTitle}>Profile setup required</Text><Text style={page.missingBody}>Your Rocket profile could not be found.</Text></View></Screen>;
  return <Screen><View style={page.header}><Brand compact /><Pressable style={page.bell}><Text style={page.bellText}>○</Text><View style={page.dot} /></Pressable></View><View style={page.greeting}><Text style={page.eyebrow}>TUESDAY, SEPTEMBER 15</Text><Text style={page.title}>Good morning, {profile.displayName}</Text><Text style={page.subtitle}>Here is what is happening in your orbit.</Text></View><SectionTitle title="Latest from your people" />{loading ? <View style={page.state}><ActivityIndicator color={colors.accent} /><Text style={page.stateText}>Loading your feed...</Text></View> : error ? <View style={page.state}><Text style={page.error}>{error}</Text></View> : posts.length === 0 ? <Card style={page.empty}><Text style={page.emptyTitle}>No posts yet.</Text><Text style={page.emptyBody}>Share something with your orbit.</Text></Card> : posts.map((post) => <PostCard key={post.postId} post={post} />)}</Screen>;
}

const page = StyleSheet.create({ header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 5 }, greeting: { marginTop: 30, marginBottom: 27 }, eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginBottom: 7 }, title: { color: colors.text, fontSize: 27, fontWeight: '900' }, subtitle: { color: colors.textSecondary, fontSize: 14, marginTop: 7 }, bell: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.backgroundElement, alignItems: 'center', justifyContent: 'center' }, bellText: { color: colors.text, fontSize: 25, lineHeight: 25 }, dot: { position: 'absolute', width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent, right: 8, top: 8 }, state: { alignItems: 'center', paddingVertical: 50 }, stateText: { color: colors.textSecondary, marginTop: 9, fontSize: 13 }, error: { color: colors.accent, textAlign: 'center', fontSize: 13 }, empty: { alignItems: 'center', padding: 28 }, emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800' }, emptyBody: { color: colors.textSecondary, fontSize: 13, marginTop: 7 }, missing: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }, missingTitle: { color: colors.text, fontSize: 20, fontWeight: '800' }, missingBody: { color: colors.textSecondary, textAlign: 'center', marginTop: 8 } });
