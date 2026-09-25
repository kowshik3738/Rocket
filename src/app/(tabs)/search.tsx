import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar, Card, colors, Screen, SectionTitle } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';
import { getSearchUsers, RelationshipStatus, SearchUser, sendFriendRequest } from '@/services/social-service';
import { getProfileColor, getProfileInitials } from '@/services/user-service';

function relationshipLabel(status: RelationshipStatus) {
  if (status === 'friends') return 'Friends';
  if (status === 'sent') return 'Request sent';
  if (status === 'incoming') return 'Incoming request';
  if (status === 'blocked') return 'Blocked';
  return 'Add friend';
}

export default function SearchScreen() {
  const { user } = useAuth();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<SearchUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState('');

  useEffect(() => {
    if (!user || !term.trim()) {
      setResults([]);
      setLoading(false);
      setError('');
      return;
    }

    let active = true;
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      void getSearchUsers(term, user.uid)
        .then((nextResults) => {
          if (active) setResults(nextResults);
        })
        .catch(() => {
          if (active) setError('We could not search Rocket right now. Check your connection and try again.');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [term, user]);

  async function handleSendRequest(target: SearchUser) {
    if (!user || target.relationship !== 'add') return;
    setActionId(target.uid);
    setError('');
    try {
      await sendFriendRequest(user.uid, target.uid);
      setResults((current) => current.map((result) => result.uid === target.uid ? { ...result, relationship: 'sent' } : result));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not send friend request.');
    } finally {
      setActionId('');
    }
  }

  return <Screen><Text style={page.title}>Find your people</Text><Text style={page.subtitle}>Search Rocket by username.</Text><View style={page.search}><Text style={page.searchIcon}>⌕</Text><TextInput autoCapitalize="none" autoCorrect={false} onChangeText={setTerm} placeholder="Search by username" placeholderTextColor={colors.textSecondary} style={page.input} value={term} /></View><SectionTitle title="Results" />{loading ? <View style={page.state}><ActivityIndicator color={colors.accent} /><Text style={page.stateText}>Searching Rocket...</Text></View> : error ? <View style={page.state}><Text style={page.error}>{error}</Text></View> : !term.trim() ? <View style={page.state}><Text style={page.stateText}>Search for a username to find people.</Text></View> : results.length === 0 ? <View style={page.state}><Text style={page.emptyTitle}>No people found</Text><Text style={page.stateText}>Try another username.</Text></View> : results.map((result) => { const avatar = { initials: getProfileInitials(result.displayName), color: getProfileColor(result.uid) }; const isAddable = result.relationship === 'add'; const destinationUid = String(result.uid || ''); return <Pressable key={result.uid} onPress={() => { if (!destinationUid) return; router.push({ pathname: '/user/[uid]', params: { uid: destinationUid } }); }}><Card style={page.person}><Avatar user={avatar} size={48} /><View style={page.info}><Text style={page.name}>{result.displayName}</Text><Text style={page.handle}>@{result.username}</Text></View><Pressable disabled={!isAddable || actionId === result.uid} onPress={(event) => { event.stopPropagation(); void handleSendRequest(result); }} style={[page.follow, !isAddable && page.inactive]}><Text style={page.followText}>{actionId === result.uid ? 'Sending...' : relationshipLabel(result.relationship)}</Text></Pressable></Card></Pressable>; })}</Screen>;
}

const page = StyleSheet.create({ title: { color: colors.text, fontSize: 28, fontWeight: '900', marginTop: 16 }, subtitle: { color: colors.textSecondary, marginTop: 7 }, search: { height: 54, borderRadius: 17, backgroundColor: colors.backgroundElement, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, marginTop: 26, marginBottom: 30 }, searchIcon: { color: colors.textSecondary, fontSize: 25, marginRight: 8 }, input: { flex: 1, color: colors.text, fontSize: 15 }, person: { padding: 13, flexDirection: 'row', alignItems: 'center', marginBottom: 10 }, info: { flex: 1, marginLeft: 11 }, name: { color: colors.text, fontSize: 14, fontWeight: '800' }, handle: { color: colors.textSecondary, fontSize: 11, marginTop: 4 }, follow: { borderRadius: 12, backgroundColor: colors.backgroundSelected, paddingVertical: 10, paddingHorizontal: 12 }, inactive: { opacity: 0.65 }, followText: { color: colors.accentSecondary, fontSize: 12, fontWeight: '800' }, state: { alignItems: 'center', paddingVertical: 35, paddingHorizontal: 24 }, stateText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 9 }, emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '800' }, error: { color: colors.accent, textAlign: 'center', fontSize: 13, lineHeight: 19 } });
