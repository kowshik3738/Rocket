import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '@/providers/auth-provider';
import { createOrGetConversation } from '@/services/messaging-service';
import { getPostCount, Post, subscribeToFeed } from '@/services/posts-service';
import {
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  ReportReason,
  reportUser,
} from '@/services/report-service';
import {
  blockUser,
  getFriends,
  getRelationshipStatus,
  RelationshipStatus,
  sendFriendRequest,
  unblockUser,
  unfriend,
} from '@/services/social-service';
import {
  getProfileColor,
  getProfileInitials,
  getUserProfile,
  UserProfile,
} from '@/services/user-service';
import {
  RocketButton,
  RocketEmptyState,
  RocketIconButton,
  RocketLoadingIndicator,
  RocketPostCard,
  RocketPressable,
  RocketProfileHero,
  RocketScreen,
  RocketText,
  useRocketTheme,
} from '@/design-system';
import { Radius } from '@/design-system/tokens/radius';
import { SpacingScale } from '@/design-system/tokens/spacing';

export default function OtherUserProfileScreen() {
  const { user } = useAuth();
  const { colors } = useRocketTheme();
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
  const [sendingRequest, setSendingRequest] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);

  const [showActionSheet, setShowActionSheet] = useState(false);
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
          void Promise.all([getFriends(safeUid), getPostCount(safeUid)])
            .then(([friends, postsTotal]) => {
              setFriendCount(friends.length);
              setPostCount(postsTotal);
            })
            .catch(() => {
              setFriendCount(0);
              setPostCount(0);
            });
        }
      })
      .catch(() => {
        setProfile(null);
        setFriendCount(0);
        setPostCount(0);
        setRelationship(null);
      })
      .finally(() => setProfileLoading(false));

    unsubscribePosts = subscribeToFeed(
      safeUid,
      [safeUid],
      (nextPosts) => {
        setPosts(nextPosts);
        setPostsLoading(false);
      },
      () => {
        setPosts([]);
        setPostsLoading(false);
      }
    );

    return () => unsubscribePosts();
  }, [uid, user?.uid]);

  // Handlers for social actions
  async function handleSendRequest() {
    if (!user || !profile || sendingRequest || relationship !== 'add') return;
    setSendingRequest(true);
    setActionError('');
    try {
      await sendFriendRequest(user.uid, profile.uid);
      setRelationship('sent');
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not send friend request.'
      );
    } finally {
      setSendingRequest(false);
    }
  }

  async function handleOpenChat() {
    if (!user || !profile || openingChat) return;
    setOpeningChat(true);
    setActionError('');
    try {
      const conversationId = await createOrGetConversation(user.uid, profile.uid);
      router.push(`/chat/${conversationId}`);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not open conversation.'
      );
    } finally {
      setOpeningChat(false);
    }
  }

  function handleConfirmUnfriend() {
    setShowActionSheet(false);
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
      ]
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
      setActionError(
        err instanceof Error
          ? err.message
          : 'Could not remove friend. Check your connection and try again.'
      );
    } finally {
      setUnfriending(false);
    }
  }

  function handleConfirmBlock() {
    setShowActionSheet(false);
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
      ]
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
      setActionError(
        err instanceof Error
          ? err.message
          : 'Could not block user. Check your connection and try again.'
      );
    } finally {
      setBlocking(false);
    }
  }

  function handleConfirmUnblock() {
    setShowActionSheet(false);
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
      ]
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
      setActionError(
        err instanceof Error
          ? err.message
          : 'Could not unblock user. Check your connection and try again.'
      );
    } finally {
      setUnblocking(false);
    }
  }

  function handleOpenReportModal() {
    setShowActionSheet(false);
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
          ]
        );
      } else {
        Alert.alert(
          'Report Submitted',
          'Report submitted. Thank you for helping keep Rocket safe.'
        );
      }
    } catch (err) {
      setReportError(
        err instanceof Error
          ? err.message
          : 'Could not submit report. Check your connection and try again.'
      );
    } finally {
      setSubmittingReport(false);
    }
  }

  // Not found or Loading states
  if (!uid) {
    return (
      <RocketScreen scroll={false}>
        <RocketEmptyState
          action={
            <RocketButton
              label="Go back"
              onPress={() => router.back()}
              size="md"
              variant="secondary"
            />
          }
          body="No user identifier was provided."
          title="User profile not found"
        />
      </RocketScreen>
    );
  }

  if (profileLoading) {
    return (
      <RocketScreen scroll={false}>
        <View style={styles.centerContainer}>
          <RocketLoadingIndicator size="large" />
          <RocketText color="secondary" style={styles.loadingText} variant="caption">
            Loading profile...
          </RocketText>
        </View>
      </RocketScreen>
    );
  }

  if (!profile) {
    return (
      <RocketScreen scroll={false}>
        <RocketEmptyState
          action={
            <RocketButton
              label="Go back"
              onPress={() => router.back()}
              size="md"
              variant="secondary"
            />
          }
          body="This user could not be loaded or may no longer exist."
          title="Profile not found"
        />
      </RocketScreen>
    );
  }

  const avatar = {
    initials: getProfileInitials(profile.displayName),
    color: getProfileColor(profile.uid),
    source: profile.photoUrl,
  };

  // Determine primary action button for another user
  const renderRelationshipActions = () => {
    if (isOwnProfile) {
      return (
        <RocketButton
          label="Edit profile"
          onPress={() => router.push('/edit-profile')}
          size="md"
          variant="secondary"
        />
      );
    }

    if (relationship === 'blocked') {
      return (
        <View style={styles.actionRow}>
          <RocketButton
            disabled={unblocking}
            label={unblocking ? 'Unblocking...' : 'Unblock user'}
            loading={unblocking}
            onPress={handleConfirmUnblock}
            size="md"
            style={styles.primaryActionButton}
            variant="outline"
          />
          <RocketIconButton
            accessibilityHint="More options for this user"
            accessibilityLabel="More options"
            glyph="⋯"
            onPress={() => setShowActionSheet(true)}
            size="md"
            variant="filled"
          />
        </View>
      );
    }

    if (relationship === 'friends') {
      return (
        <View style={styles.actionRow}>
          <RocketButton
            iconLeft={<Text style={styles.buttonIcon}>💬</Text>}
            label={openingChat ? 'Opening...' : 'Message'}
            loading={openingChat}
            onPress={() => void handleOpenChat()}
            size="md"
            style={styles.primaryActionButton}
            variant="primary"
          />
          <RocketIconButton
            accessibilityHint="More options for this user"
            accessibilityLabel="More options"
            glyph="⋯"
            onPress={() => setShowActionSheet(true)}
            size="md"
            variant="filled"
          />
        </View>
      );
    }

    if (relationship === 'sent') {
      return (
        <View style={styles.actionRow}>
          <RocketButton
            disabled
            iconLeft={<Text style={styles.buttonIcon}>✓</Text>}
            label="Request sent"
            size="md"
            style={styles.primaryActionButton}
            variant="secondary"
          />
          <RocketIconButton
            accessibilityHint="More options for this user"
            accessibilityLabel="More options"
            glyph="⋯"
            onPress={() => setShowActionSheet(true)}
            size="md"
            variant="filled"
          />
        </View>
      );
    }

    if (relationship === 'incoming') {
      return (
        <View style={styles.actionRow}>
          <RocketButton
            label="View friend request"
            onPress={() => router.push('/friends')}
            size="md"
            style={styles.primaryActionButton}
            variant="primary"
          />
          <RocketIconButton
            accessibilityHint="More options for this user"
            accessibilityLabel="More options"
            glyph="⋯"
            onPress={() => setShowActionSheet(true)}
            size="md"
            variant="filled"
          />
        </View>
      );
    }

    // Default: 'add'
    return (
      <View style={styles.actionRow}>
        <RocketButton
          iconLeft={<Text style={styles.buttonIcon}>＋</Text>}
          label={sendingRequest ? 'Sending...' : 'Add friend'}
          loading={sendingRequest}
          onPress={() => void handleSendRequest()}
          size="md"
          style={styles.primaryActionButton}
          variant="primary"
        />
        <RocketIconButton
          accessibilityHint="More options for this user"
          accessibilityLabel="More options"
          glyph="⋯"
          onPress={() => setShowActionSheet(true)}
          size="md"
          variant="filled"
        />
      </View>
    );
  };

  return (
    <RocketScreen
      contentContainerStyle={styles.screenContent}
      edges={['top']}
      scroll={false}>
      <FlatList
        data={relationship === 'blocked' ? [] : posts}
        keyExtractor={(item) => item.postId}
        renderItem={({ item }) => <RocketPostCard post={item} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.headerContainer}>
            {/* Header bar: Back button + User handle + Options menu */}
            <View style={styles.topBar}>
              <RocketIconButton
                accessibilityHint="Go back"
                accessibilityLabel="Back"
                glyph="‹"
                glyphStyle={styles.backGlyph}
                onPress={() => router.back()}
                size="md"
                variant="ghost"
              />
              <RocketText
                color="secondary"
                numberOfLines={1}
                style={styles.headerHandle}
                variant="bodyMedium">
                @{profile.username}
              </RocketText>
              {!isOwnProfile ? (
                <RocketIconButton
                  accessibilityHint="User options"
                  accessibilityLabel="Options"
                  glyph="⋯"
                  glyphStyle={styles.optionsGlyph}
                  onPress={() => setShowActionSheet(true)}
                  size="md"
                  variant="ghost"
                />
              ) : (
                <RocketIconButton
                  accessibilityHint="Open settings"
                  accessibilityLabel="Settings"
                  glyph="⚙"
                  onPress={() => router.push('/settings')}
                  size="md"
                  variant="ghost"
                />
              )}
            </View>

            {/* Profile Hero with Orbit Avatar, Identity, and Action Controls */}
            <RocketProfileHero
              avatar={avatar}
              bio={profile.bio}
              displayName={profile.displayName}
              stats={
                isOwnProfile
                  ? [
                      { label: 'Posts', value: postCount },
                      {
                        label: 'Friends',
                        value: friendCount,
                        onPress: () => router.push('/friends'),
                      },
                    ]
                  : [
                      {
                        label: 'Posts',
                        value: relationship === 'blocked' ? 0 : posts.length,
                      },
                    ]
              }
              actions={renderRelationshipActions()}
              username={profile.username}
            />

            {/* Inline Action Error if any */}
            {actionError ? (
              <RocketText color="error" style={styles.actionError} variant="caption">
                {actionError}
              </RocketText>
            ) : null}

            {/* Section Transition */}
            <View style={styles.sectionHeaderRow}>
              <RocketText
                color="primary"
                style={styles.sectionTitle}
                variant="sectionTitle">
                Posts
              </RocketText>
              {relationship !== 'blocked' && posts.length > 0 ? (
                <RocketText color="secondary" variant="caption">
                  {posts.length} {posts.length === 1 ? 'post' : 'posts'}
                </RocketText>
              ) : null}
            </View>
          </View>
        }
        ListEmptyComponent={
          relationship === 'blocked' ? (
            <RocketEmptyState
              body="You have blocked this user. Unblock them to see their posts and profile activity."
              title="User blocked"
            />
          ) : postsLoading ? (
            <View style={styles.stateContainer}>
              <RocketLoadingIndicator size="normal" />
              <RocketText color="secondary" style={styles.stateText} variant="caption">
                Loading posts...
              </RocketText>
            </View>
          ) : (
            <RocketEmptyState
              body={`${profile.displayName} has not shared any posts yet.`}
              title="No posts yet"
            />
          )
        }
      />

      {/* Secondary Options Action Sheet Modal */}
      <Modal
        animationType="fade"
        onRequestClose={() => setShowActionSheet(false)}
        transparent
        visible={showActionSheet}>
        <Pressable
          onPress={() => setShowActionSheet(false)}
          style={styles.modalOverlay}>
          <View
            style={[
              styles.actionSheetCard,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.borderSubtle,
              },
            ]}>
            <View style={styles.actionSheetHandle} />
            <RocketText style={styles.actionSheetTitle} variant="sectionTitle">
              @{profile.username}
            </RocketText>

            <View style={styles.actionSheetButtons}>
              {relationship === 'friends' ? (
                <RocketPressable
                  accessibilityHint="Remove user from friends"
                  accessibilityLabel="Remove friend"
                  accessibilityRole="button"
                  disabled={unfriending || blocking || submittingReport}
                  onPress={handleConfirmUnfriend}
                  style={styles.sheetOption}>
                  <Text style={styles.sheetOptionGlyph}>✕</Text>
                  <RocketText color="error" style={styles.sheetOptionText} variant="bodyMedium">
                    {unfriending ? 'Removing friend...' : 'Remove friend'}
                  </RocketText>
                </RocketPressable>
              ) : null}

              {relationship === 'blocked' ? (
                <RocketPressable
                  accessibilityHint="Unblock this user"
                  accessibilityLabel="Unblock user"
                  accessibilityRole="button"
                  disabled={unblocking || submittingReport}
                  onPress={handleConfirmUnblock}
                  style={styles.sheetOption}>
                  <Text style={styles.sheetOptionGlyph}>✓</Text>
                  <RocketText style={styles.sheetOptionText} variant="bodyMedium">
                    {unblocking ? 'Unblocking...' : 'Unblock user'}
                  </RocketText>
                </RocketPressable>
              ) : (
                <RocketPressable
                  accessibilityHint="Block this user"
                  accessibilityLabel="Block user"
                  accessibilityRole="button"
                  disabled={blocking || unfriending || submittingReport}
                  onPress={handleConfirmBlock}
                  style={styles.sheetOption}>
                  <Text style={styles.sheetOptionGlyph}>🚫</Text>
                  <RocketText color="error" style={styles.sheetOptionText} variant="bodyMedium">
                    {blocking ? 'Blocking...' : 'Block user'}
                  </RocketText>
                </RocketPressable>
              )}

              <RocketPressable
                accessibilityHint="Report this user"
                accessibilityLabel="Report user"
                accessibilityRole="button"
                disabled={submittingReport || blocking || unfriending}
                onPress={handleOpenReportModal}
                style={styles.sheetOption}>
                <Text style={styles.sheetOptionGlyph}>🚩</Text>
                <RocketText color="secondary" style={styles.sheetOptionText} variant="bodyMedium">
                  Report user
                </RocketText>
              </RocketPressable>

              <RocketButton
                label="Cancel"
                onPress={() => setShowActionSheet(false)}
                size="md"
                style={styles.sheetCancelButton}
                variant="ghost"
              />
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Report Modal */}
      <Modal
        animationType="fade"
        onRequestClose={handleCloseReportModal}
        transparent
        visible={showReportModal}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}>
          <View
            style={[
              styles.reportCard,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
              },
            ]}>
            <RocketText style={styles.reportModalTitle} variant="sectionTitle">
              Report User
            </RocketText>
            <RocketText
              color="secondary"
              style={styles.reportModalSubtitle}
              variant="bodySecondary">
              Help us understand why you are reporting @{profile.username}.
            </RocketText>

            <ScrollView
              contentContainerStyle={styles.reportScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.reportScrollView}>
              <RocketText
                color="secondary"
                style={styles.reportSectionLabel}
                variant="captionBold">
                Reason
              </RocketText>
              <View style={styles.reasonsList}>
                {REPORT_REASONS.map((r) => {
                  const isSelected = reportReason === r;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected }}
                      key={r}
                      onPress={() => setReportReason(r)}
                      style={[
                        styles.reasonOption,
                        {
                          backgroundColor: isSelected
                            ? colors.primaryAccentSubtle
                            : colors.surface,
                          borderColor: isSelected
                            ? colors.primaryAccent
                            : colors.borderSubtle,
                        },
                      ]}>
                      <View
                        style={[
                          styles.radioCircle,
                          {
                            borderColor: isSelected
                              ? colors.primaryAccent
                              : colors.secondaryText,
                          },
                        ]}>
                        {isSelected ? (
                          <View
                            style={[
                              styles.radioInnerDot,
                              { backgroundColor: colors.primaryAccent },
                            ]}
                          />
                        ) : null}
                      </View>
                      <RocketText
                        color={isSelected ? 'primary' : 'secondary'}
                        style={styles.reasonText}
                        variant="body">
                        {REPORT_REASON_LABELS[r]}
                      </RocketText>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.detailsHeader}>
                <RocketText
                  color="secondary"
                  style={styles.reportSectionLabel}
                  variant="captionBold">
                  Details (Optional)
                </RocketText>
                <RocketText color="muted" variant="caption">
                  {reportDetails.length}/500
                </RocketText>
              </View>
              <TextInput
                maxLength={500}
                multiline
                numberOfLines={3}
                onChangeText={setReportDetails}
                placeholder="Provide additional details..."
                placeholderTextColor={colors.mutedText}
                style={[
                  styles.detailsInput,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.borderSubtle,
                    color: colors.primaryText,
                  },
                ]}
                textAlignVertical="top"
                value={reportDetails}
              />

              {reportError ? (
                <RocketText color="error" style={styles.reportError} variant="caption">
                  {reportError}
                </RocketText>
              ) : null}
            </ScrollView>

            <View
              style={[
                styles.reportActions,
                { borderTopColor: colors.borderSubtle },
              ]}>
              <RocketButton
                disabled={submittingReport}
                label="Cancel"
                onPress={handleCloseReportModal}
                size="md"
                style={styles.modalHalfButton}
                variant="ghost"
              />
              <RocketButton
                disabled={submittingReport}
                label="Submit report"
                loading={submittingReport}
                onPress={() => void handleSubmitReport()}
                size="md"
                style={styles.modalHalfButton}
                variant="primary"
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </RocketScreen>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingHorizontal: 0,
    flex: 1,
  },
  listContent: {
    paddingHorizontal: SpacingScale.xl,
    paddingBottom: SpacingScale.huge,
  },
  headerContainer: {
    paddingTop: SpacingScale.sm,
    marginBottom: SpacingScale.lg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SpacingScale.md,
  },
  backGlyph: {
    fontSize: 28,
    fontWeight: '300',
  },
  headerHandle: {
    fontWeight: '700',
    maxWidth: 200,
    textAlign: 'center',
  },
  optionsGlyph: {
    fontSize: 22,
    fontWeight: '800',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.sm,
    width: '100%',
  },
  primaryActionButton: {
    flex: 1,
  },
  buttonIcon: {
    fontSize: 16,
  },
  actionError: {
    textAlign: 'center',
    marginTop: SpacingScale.sm,
    paddingHorizontal: SpacingScale.lg,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SpacingScale.xl,
    marginBottom: SpacingScale.sm,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    letterSpacing: -0.3,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SpacingScale.xl,
  },
  loadingText: {
    marginTop: SpacingScale.md,
  },
  stateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SpacingScale.epic,
  },
  stateText: {
    marginTop: SpacingScale.sm,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SpacingScale.xl,
  },
  actionSheetCard: {
    width: '100%',
    maxWidth: 400,
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: SpacingScale.xl,
  },
  actionSheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#334155',
    alignSelf: 'center',
    marginBottom: SpacingScale.md,
  },
  actionSheetTitle: {
    textAlign: 'center',
    marginBottom: SpacingScale.lg,
  },
  actionSheetButtons: {
    gap: SpacingScale.sm,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.md,
    paddingVertical: SpacingScale.md,
    paddingHorizontal: SpacingScale.md,
    borderRadius: Radius.md,
  },
  sheetOptionGlyph: {
    fontSize: 18,
    width: 24,
    textAlign: 'center',
  },
  sheetOptionText: {
    fontWeight: '700',
  },
  sheetCancelButton: {
    marginTop: SpacingScale.sm,
  },
  reportCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: SpacingScale.xl,
  },
  reportModalTitle: {
    textAlign: 'center',
  },
  reportModalSubtitle: {
    textAlign: 'center',
    marginTop: 4,
    marginBottom: SpacingScale.lg,
  },
  reportScrollView: {
    maxHeight: 340,
  },
  reportScrollContent: {
    paddingBottom: SpacingScale.sm,
  },
  reportSectionLabel: {
    marginBottom: SpacingScale.xs,
  },
  reasonsList: {
    gap: SpacingScale.xs,
    marginBottom: SpacingScale.lg,
  },
  reasonOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SpacingScale.md - 2,
    paddingHorizontal: SpacingScale.md,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SpacingScale.md,
  },
  radioInnerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  reasonText: {
    flex: 1,
    fontWeight: '600',
  },
  detailsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SpacingScale.xs,
  },
  detailsInput: {
    height: 84,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: SpacingScale.md,
    paddingVertical: SpacingScale.sm,
    fontSize: 14,
  },
  reportError: {
    marginTop: SpacingScale.sm,
    textAlign: 'center',
  },
  reportActions: {
    flexDirection: 'row',
    gap: SpacingScale.md,
    marginTop: SpacingScale.lg,
    paddingTop: SpacingScale.md,
    borderTopWidth: 1,
  },
  modalHalfButton: {
    flex: 1,
  },
});
