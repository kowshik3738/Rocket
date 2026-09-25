import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PostCard } from '@/components/post-card';
import { Avatar, Card, colors, Screen } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';
import { getPostCount, Post, subscribeToFeed } from '@/services/posts-service';
import { REPORT_REASONS, REPORT_REASON_LABELS, ReportReason, reportUser } from '@/services/report-service';
import { blockUser, getFriends, getRelationshipStatus, RelationshipStatus, unblockUser, unfriend } from '@/services/social-service';
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
  const [relationship, setRelationship] = useState<RelationshipStatus | null>(null);
  const [unfriending, setUnfriending] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [unblocking, setUnblocking] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>('spam');
  const [reportDetails, setReportDetails] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);
  const [reportError, setReportError] = useState('');
  const [actionError, setActionError] = useState('');
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
    setActionError('');

    void getUserProfile(safeUid)
      .then((nextProfile) => {
        setProfile(nextProfile);
        if (!nextProfile) {
          setFriendCount(0);
          setPostCount(0);
          setRelationship(null);
          return;
        }

        if (user?.uid && user.uid !== safeUid) {
          void getRelationshipStatus(user.uid, safeUid)
            .then((status) => setRelationship(status))
            .catch(() => setRelationship(null));
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
        setRelationship(null);
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

  function handleConfirmUnfriend() {
    if (!user || !profile || unfriending) return;
    Alert.alert(
      'Remove Friend',
      `Are you sure you want to remove ${profile.displayName} from your friends?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void executeUnfriend();
          },
        },
      ],
    );
  }

  async function executeUnfriend() {
    if (!user || !profile || unfriending) return;
    setUnfriending(true);
    setActionError('');
    try {
      await unfriend(user.uid, profile.uid);
      setRelationship('add');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not remove friend. Check your connection and try again.');
    } finally {
      setUnfriending(false);
    }
  }

  function handleConfirmBlock() {
    if (!user || !profile || blocking || unfriending) return;
    Alert.alert(
      'Block User',
      `Are you sure you want to block ${profile.displayName}? They will not be able to message you, call you, or see your posts. If you are friends, you will be removed from each other's friend lists.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => {
            void executeBlock();
          },
        },
      ],
    );
  }

  async function executeBlock() {
    if (!user || !profile || blocking || unfriending) return;
    setBlocking(true);
    setActionError('');
    try {
      await blockUser(user.uid, profile.uid);
      setRelationship('blocked');
      setPosts([]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not block user. Check your connection and try again.');
    } finally {
      setBlocking(false);
    }
  }

  function handleConfirmUnblock() {
    if (!user || !profile || unblocking) return;
    Alert.alert(
      'Unblock User',
      `Are you sure you want to unblock ${profile.displayName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: () => {
            void executeUnblock();
          },
        },
      ],
    );
  }

  async function executeUnblock() {
    if (!user || !profile || unblocking) return;
    setUnblocking(true);
    setActionError('');
    try {
      await unblockUser(user.uid, profile.uid);
      setRelationship('add');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not unblock user. Check your connection and try again.');
    } finally {
      setUnblocking(false);
    }
  }

  function handleOpenReportModal() {
    setReportReason('spam');
    setReportDetails('');
    setReportError('');
    setShowReportModal(true);
  }

  function handleCloseReportModal() {
    if (submittingReport) return;
    setShowReportModal(false);
    setReportError('');
  }

  async function handleSubmitReport() {
    if (!user || !profile || submittingReport) return;
    setSubmittingReport(true);
    setReportError('');

    try {
      await reportUser({
        reporterUid: user.uid,
        reportedUid: profile.uid,
        reason: reportReason,
        details: reportDetails,
      });

      setShowReportModal(false);

      if (relationship !== 'blocked') {
        Alert.alert(
          'Report Submitted',
          'Report submitted. Would you also like to block this user?',
          [
            { text: 'Done', style: 'cancel' },
            {
              text: 'Block User',
              style: 'destructive',
              onPress: () => {
                void executeBlock();
              },
            },
          ],
        );
      } else {
        Alert.alert(
          'Report Submitted',
          'Report submitted. Thank you for helping keep Rocket safe.',
        );
      }
    } catch (err) {
      setReportError(err instanceof Error ? err.message : 'Could not submit report. Check your connection and try again.');
    } finally {
      setSubmittingReport(false);
    }
  }

  return (
    <Screen>
      <View style={page.profile}>
        <Avatar user={profileUser} size={88} />
        <Text style={page.name}>{profile.displayName}</Text>
        <Text style={page.handle}>@{profile.username}</Text>
        {profile.bio ? <Text style={page.bio}>{profile.bio}</Text> : null}
        {isOwnProfile ? (
          <View style={page.stats}>
            <View><Text style={page.statNumber}>{postCount}</Text><Text style={page.statLabel}>Posts</Text></View>
            <View><Text style={page.statNumber}>{friendCount}</Text><Text style={page.statLabel}>Friends</Text></View>
          </View>
        ) : null}
        {!isOwnProfile ? (
          <View style={page.actions}>
            {relationship === 'blocked' ? (
              <View style={page.buttonRow}>
                <Pressable
                  disabled={unblocking || submittingReport}
                  onPress={handleConfirmUnblock}
                  style={[page.unblockButton, (unblocking || submittingReport) && page.actionButtonDisabled]}
                >
                  <Text style={page.unblockButtonText}>{unblocking ? 'Unblocking...' : 'Unblock user'}</Text>
                </Pressable>
                <Pressable
                  disabled={unblocking || submittingReport}
                  onPress={handleOpenReportModal}
                  style={[page.reportButton, (unblocking || submittingReport) && page.actionButtonDisabled]}
                >
                  <Text style={page.reportButtonText}>Report</Text>
                </Pressable>
              </View>
            ) : (
              <View style={page.buttonRow}>
                {relationship === 'friends' ? (
                  <Pressable
                    disabled={unfriending || blocking || submittingReport}
                    onPress={handleConfirmUnfriend}
                    style={[page.unfriendButton, (unfriending || blocking || submittingReport) && page.actionButtonDisabled]}
                  >
                    <Text style={page.unfriendButtonText}>{unfriending ? 'Removing...' : 'Remove friend'}</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  disabled={blocking || unfriending || submittingReport}
                  onPress={handleConfirmBlock}
                  style={[page.blockButton, (blocking || unfriending || submittingReport) && page.actionButtonDisabled]}
                >
                  <Text style={page.blockButtonText}>{blocking ? 'Blocking...' : 'Block'}</Text>
                </Pressable>
                <Pressable
                  disabled={blocking || unfriending || submittingReport}
                  onPress={handleOpenReportModal}
                  style={[page.reportButton, (blocking || unfriending || submittingReport) && page.actionButtonDisabled]}
                >
                  <Text style={page.reportButtonText}>Report</Text>
                </Pressable>
              </View>
            )}
          </View>
        ) : null}
        {actionError ? <Text style={page.actionError}>{actionError}</Text> : null}
      </View>
      {relationship === 'blocked' ? (
        <Card style={page.emptyPosts}><Text style={page.emptyPostsText}>You have blocked this user.</Text></Card>
      ) : postsLoading ? (
        <View style={page.postsState}>
          <ActivityIndicator color={colors.accent} size="small" />
          <Text style={page.postsStateText}>Loading posts...</Text>
        </View>
      ) : posts.length === 0 ? (
        <Card style={page.emptyPosts}><Text style={page.emptyPostsText}>No posts yet.</Text></Card>
      ) : (
        posts.map((post) => <PostCard key={post.postId} post={post} />)
      )}

      <Modal
        animationType="fade"
        onRequestClose={handleCloseReportModal}
        transparent
        visible={showReportModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={page.modalOverlay}
        >
          <View style={page.modalCard}>
            <Text style={page.modalTitle}>Report User</Text>
            <Text style={page.modalSubtitle}>
              Help us understand why you are reporting @{profile.username}.
            </Text>

            <ScrollView
              contentContainerStyle={page.modalScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={page.modalScrollView}
            >
              <Text style={page.modalSectionLabel}>Reason</Text>
              <View style={page.reasonsList}>
                {REPORT_REASONS.map((r) => {
                  const isSelected = reportReason === r;
                  return (
                    <Pressable
                      key={r}
                      onPress={() => setReportReason(r)}
                      style={[page.reasonOption, isSelected && page.reasonOptionSelected]}
                    >
                      <View style={[page.radioCircle, isSelected && page.radioCircleSelected]}>
                        {isSelected ? <View style={page.radioInnerDot} /> : null}
                      </View>
                      <Text style={[page.reasonText, isSelected && page.reasonTextSelected]}>
                        {REPORT_REASON_LABELS[r]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={page.detailsHeader}>
                <Text style={page.modalSectionLabel}>Details (Optional)</Text>
                <Text style={page.charCounter}>{reportDetails.length}/500</Text>
              </View>
              <TextInput
                maxLength={500}
                multiline
                numberOfLines={3}
                onChangeText={setReportDetails}
                placeholder="Provide additional details..."
                placeholderTextColor={colors.textSecondary}
                style={page.detailsInput}
                textAlignVertical="top"
                value={reportDetails}
              />

              {reportError ? <Text style={page.modalError}>{reportError}</Text> : null}
            </ScrollView>

            <View style={page.modalActions}>
              <Pressable
                disabled={submittingReport}
                onPress={handleCloseReportModal}
                style={[page.modalCancelButton, submittingReport && page.actionButtonDisabled]}
              >
                <Text style={page.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={submittingReport}
                onPress={handleSubmitReport}
                style={[page.modalSubmitButton, submittingReport && page.actionButtonDisabled]}
              >
                {submittingReport ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={page.modalSubmitText}>Submit Report</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
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
  actions: { marginTop: 16, marginBottom: 12 },
  buttonRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  unfriendButton: { borderRadius: 12, backgroundColor: colors.backgroundSelected, paddingVertical: 9, paddingHorizontal: 16 },
  unfriendButtonText: { color: colors.accent, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  blockButton: { borderRadius: 12, backgroundColor: colors.backgroundSelected, paddingVertical: 9, paddingHorizontal: 16 },
  blockButtonText: { color: colors.accent, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  unblockButton: { borderRadius: 12, backgroundColor: colors.backgroundSelected, paddingVertical: 9, paddingHorizontal: 16 },
  unblockButtonText: { color: colors.text, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  reportButton: { borderRadius: 12, backgroundColor: colors.backgroundSelected, paddingVertical: 9, paddingHorizontal: 16 },
  reportButtonText: { color: colors.textSecondary, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  actionButtonDisabled: { opacity: 0.5 },
  actionError: { color: colors.accent, fontSize: 13, textAlign: 'center', marginTop: 8, paddingHorizontal: 20 },
  postsState: { alignItems: 'center', paddingVertical: 18 },
  postsStateText: { color: colors.textSecondary, marginTop: 8, fontSize: 12 },
  emptyPosts: { alignItems: 'center', padding: 22, marginBottom: 18 },
  emptyPostsText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.75)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 420, maxHeight: '85%', backgroundColor: colors.backgroundElement, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 20 },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  modalSubtitle: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 4, marginBottom: 16 },
  modalScrollView: { maxHeight: 340 },
  modalScrollContent: { paddingBottom: 8 },
  modalSectionLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8 },
  reasonsList: { gap: 8, marginBottom: 16 },
  reasonOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  reasonOptionSelected: { borderColor: colors.accent, backgroundColor: colors.backgroundSelected },
  radioCircle: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.textSecondary, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  radioCircleSelected: { borderColor: colors.accent },
  radioInnerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  reasonText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600', flex: 1 },
  reasonTextSelected: { color: colors.text, fontWeight: '700' },
  detailsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  charCounter: { color: colors.textSecondary, fontSize: 12 },
  detailsInput: { height: 80, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, color: colors.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  modalError: { color: colors.accent, fontSize: 12, marginTop: 10, textAlign: 'center' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  modalCancelButton: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.backgroundSelected, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  modalSubmitButton: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  modalSubmitText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
});
