import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar, Screen, TopBar, colors } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';
import {
  addGroupMember,
  getEligibleFriends,
  getGroup,
  getGroupProfiles,
  Group,
  leaveGroup,
  removeGroupMember,
  renameGroup,
} from '@/services/group-service';
import { Friend } from '@/services/social-service';
import { getProfileColor, getProfileInitials, UserProfile } from '@/services/user-service';

export default function GroupInfoScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { user } = useAuth();
  const [group, setGroup] = useState<Group | null>(null);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [friends, setFriends] = useState<Friend[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');

  async function load() {
    if (!user || !groupId) return;
    setLoading(true);
    try {
      const current = await getGroup(groupId, user.uid);
      setGroup(current);
      setName(current.name);
      const [nextProfiles, nextFriends] = await Promise.all([
        getGroupProfiles(current.memberIds),
        getEligibleFriends(user.uid, current.memberIds),
      ]);
      setProfiles(nextProfiles);
      setFriends(nextFriends);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Group unavailable.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [groupId, user]);

  const admin = !!group && !!user && group.adminIds.includes(user.uid);

  async function action(label: string, work: () => Promise<void>) {
    if (working) return;
    setWorking(label);
    setError('');
    try {
      await work();
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'That change could not be saved.');
    } finally {
      setWorking('');
    }
  }

  if (loading) {
    return (
      <Screen>
        <View style={styles.state}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </Screen>
    );
  }

  if (!group || !user) {
    return (
      <Screen>
        <TopBar back={() => router.back()} title="Group info" />
        <Text style={styles.error}>{error || 'Group unavailable.'}</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar back={() => router.back()} title="Group info" />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.nameRow}>
        <Avatar
          size={58}
          user={{ initials: getProfileInitials(group.name), color: colors.accentSecondary }}
        />
        <View style={styles.nameInfo}>
          {admin ? (
            <TextInput
              editable={!working}
              maxLength={60}
              onChangeText={setName}
              style={styles.input}
              value={name}
            />
          ) : (
            <Text style={styles.groupName}>{group.name}</Text>
          )}
          <Text style={styles.meta}>
            {group.memberIds.length} members · Created by {profiles[group.createdBy]?.displayName || 'member'}
          </Text>
        </View>
      </View>
      {admin && name.trim() !== group.name ? (
        <Pressable
          disabled={!!working}
          onPress={() => void action('rename', () => renameGroup(group, user.uid, name))}
          style={styles.action}>
          <Text style={styles.actionText}>{working === 'rename' ? 'Saving…' : 'Save name'}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.heading}>Members</Text>
      {group.memberIds.map((uid) => {
        const profile = profiles[uid];
        const isAdmin = group.adminIds.includes(uid);
        return (
          <View key={uid} style={styles.member}>
            <Avatar
              size={42}
              source={profile?.photoUrl}
              user={{
                initials: getProfileInitials(profile?.displayName || '?'),
                color: getProfileColor(uid),
              }}
            />
            <View style={styles.memberInfo}>
              <Text style={styles.memberName}>
                {profile?.displayName || 'Group member'} {uid === group.createdBy ? '· Creator' : ''}
              </Text>
              <Text style={styles.memberMeta}>
                {isAdmin ? 'Admin' : profile ? `@${profile.username}` : 'Member'}
              </Text>
            </View>
            {admin && uid !== user.uid && !isAdmin ? (
              <Pressable
                disabled={!!working}
                onPress={() =>
                  Alert.alert(
                    'Remove member?',
                    `Remove ${profile?.displayName || 'this member'} from the group?`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Remove',
                        style: 'destructive',
                        onPress: () => void action(`remove-${uid}`, () => removeGroupMember(group, user.uid, uid)),
                      },
                    ],
                  )
                }>
                <Text style={styles.remove}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      {admin && friends.length ? (
        <>
          <Text style={styles.heading}>Add accepted friends</Text>
          {friends.map((friend) => (
            <Pressable
              disabled={!!working}
              key={friend.uid}
              onPress={() => void action(`add-${friend.uid}`, () => addGroupMember(group, user.uid, friend.uid))}
              style={styles.member}>
              <Avatar
                size={42}
                source={friend.photoUrl}
                user={{
                  initials: getProfileInitials(friend.displayName),
                  color: getProfileColor(friend.uid),
                }}
              />
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>{friend.displayName}</Text>
                <Text style={styles.memberMeta}>@{friend.username}</Text>
              </View>
              <Text style={styles.add}>{working === `add-${friend.uid}` ? 'Adding…' : 'Add'}</Text>
            </Pressable>
          ))}
        </>
      ) : null}
      {!admin || group.adminIds.length > 1 ? (
        <Pressable
          disabled={!!working}
          onPress={() =>
            Alert.alert('Leave group?', 'You will lose access to this group and its messages.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Leave',
                style: 'destructive',
                onPress: () =>
                  void action('leave', async () => {
                    await leaveGroup(group, user.uid);
                    router.replace('/(tabs)/chats');
                  }),
              },
            ])
          }
          style={styles.leave}>
          <Text style={styles.leaveText}>{working === 'leave' ? 'Leaving…' : 'Leave group'}</Text>
        </Pressable>
      ) : (
        <Text style={styles.note}>You are the only admin. Add or transfer an admin before leaving.</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  state: { padding: 50, alignItems: 'center' },
  error: { color: colors.accent, textAlign: 'center', marginBottom: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 15 },
  nameInfo: { flex: 1, marginLeft: 13 },
  groupName: { color: colors.text, fontSize: 19, fontWeight: '900' },
  input: { color: colors.text, fontSize: 19, fontWeight: '900', borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 4 },
  meta: { color: colors.textSecondary, fontSize: 12, marginTop: 5 },
  action: { padding: 12, borderRadius: 12, backgroundColor: colors.backgroundSelected, alignItems: 'center' },
  actionText: { color: colors.accent, fontWeight: '800' },
  heading: { color: colors.text, fontSize: 17, fontWeight: '800', marginTop: 26, marginBottom: 9 },
  member: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 14, backgroundColor: colors.backgroundElement, borderWidth: 1, borderColor: colors.border, marginBottom: 7 },
  memberInfo: { flex: 1, marginLeft: 10 },
  memberName: { color: colors.text, fontWeight: '800' },
  memberMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
  add: { color: colors.accent, fontWeight: '800' },
  remove: { color: colors.accent, fontSize: 12, fontWeight: '800', padding: 7 },
  leave: { marginTop: 28, padding: 14, alignItems: 'center' },
  leaveText: { color: colors.accent, fontWeight: '800' },
  note: { color: colors.textSecondary, textAlign: 'center', marginTop: 25, lineHeight: 19 },
});
