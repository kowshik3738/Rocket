import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';

import { useAuth } from '@/providers/auth-provider';
import {
  RocketButton,
  RocketIconButton,
  RocketPressable,
  RocketScreen,
  RocketText,
  useRocketTheme,
} from '@/design-system';
import { Radius } from '@/design-system/tokens/radius';
import { SpacingScale } from '@/design-system/tokens/spacing';
import { getFriends, Friend } from '@/services/social-service';
import { uploadChatVideo, uploadPostImage } from '@/services/cloudinary-service';
import {
  createImageStory,
  createVideoStory,
  getPrivacyList,
  PrivacyList,
  StoryTier,
} from '@/services/stories-service';

type StoryMedia = ImagePicker.ImagePickerAsset & {
  type: 'image' | 'video';
};

type PublishStage = 'idle' | 'uploading' | 'publishing';

const AUDIENCES: Array<{ value: StoryTier; label: string; detail: string }> = [
  { value: 'friends', label: 'Friends', detail: 'All accepted friends' },
  { value: 'closeFriends', label: 'Close Friends', detail: 'Your Close Friends list' },
  { value: 'selected', label: 'Selected Friends', detail: 'Choose up to 50 friends' },
];

export default function StoryCreateScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useRocketTheme();

  const [media, setMedia] = useState<StoryMedia | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [privacy, setPrivacy] = useState<PrivacyList | null>(null);
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [tier, setTier] = useState<StoryTier>('friends');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [stage, setStage] = useState<PublishStage>('idle');
  const [error, setError] = useState('');

  const publishLock = useRef(false);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const isSubmitting = stage !== 'idle';

  useEffect(() => {
    if (!user) return;
    let active = true;

    void Promise.all([getFriends(user.uid), getPrivacyList(user.uid)])
      .then(([nextFriends, nextPrivacy]) => {
        if (!active) return;
        setFriends(nextFriends);
        setPrivacy(nextPrivacy);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'Could not load your friends.');
      })
      .finally(() => {
        if (active) setLoadingFriends(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  async function handlePickMedia() {
    if (isSubmitting) return;
    setError('');

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Allow photo library access to choose a story.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        base64: true,
        quality: 0.85,
        selectionLimit: 1,
      });

      if (result.canceled) return;
      const asset = result.assets[0];
      if (asset.type !== 'image' && asset.type !== 'video') {
        setError('Choose a photo or video to share as a story.');
        return;
      }
      setMedia(asset as StoryMedia);
    } catch (pickerError) {
      setError(pickerError instanceof Error ? pickerError.message : 'Could not open your photo library.');
    }
  }

  function toggleFriend(uid: string) {
    if (selectedIdSet.has(uid)) {
      setSelectedIds((current) => current.filter((id) => id !== uid));
      setError('');
      return;
    }
    if (selectedIds.length >= 50) {
      setError('Selected stories can include up to 50 friends.');
      return;
    }
    setSelectedIds((current) => current.includes(uid) ? current : [...current, uid]);
    setError('');
  }

  async function handlePublish() {
    if (!user || !media || publishLock.current) return;
    if (tier === 'selected' && selectedIds.length === 0) {
      setError('Select at least one friend, or choose a different audience.');
      return;
    }
    if (tier === 'closeFriends' && (privacy?.closeFriends.length ?? 0) === 0) {
      setError('Your Close Friends list is empty. Choose another audience or add Close Friends first.');
      return;
    }

    publishLock.current = true;
    setError('');
    try {
      setStage('uploading');
      const mediaUrl = media.type === 'video'
        ? await uploadChatVideo(media.uri, media.mimeType, media.fileName)
        : await uploadPostImage(media.base64, media.mimeType);

      setStage('publishing');
      if (media.type === 'video') {
        await createVideoStory(user.uid, tier, mediaUrl, tier === 'selected' ? selectedIds : undefined);
      } else {
        await createImageStory(user.uid, tier, mediaUrl, tier === 'selected' ? selectedIds : undefined);
      }

      router.replace(`/story/${user.uid}` as any);
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Your story could not be published. Please try again.');
      setStage('idle');
      publishLock.current = false;
    }
  }

  return (
    <RocketScreen
      contentContainerStyle={styles.screenContent}
      edges={['top', 'bottom']}
      scroll={false}>
      <View style={styles.header}>
        <RocketIconButton
          accessibilityLabel="Close story composer"
          glyph="✕"
          onPress={() => router.back()}
          variant="ghost"
        />
        <RocketText variant="sectionTitle">New story</RocketText>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}>
        <View style={[styles.previewFrame, { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderSubtle }]}>
          {media ? (
            <>
              <StoryMediaPreview media={media} />
              <View style={styles.previewActions}>
                <RocketButton
                  label="Change"
                  onPress={() => void handlePickMedia()}
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                />
                <RocketButton
                  label="Remove"
                  onPress={() => {
                    setMedia(null);
                    setError('');
                  }}
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                />
              </View>
            </>
          ) : (
            <RocketPressable
              accessibilityLabel="Choose a photo or video"
              accessibilityHint="Opens your photo library to select story media"
              accessibilityRole="button"
              onPress={() => void handlePickMedia()}
              style={styles.emptyPreview}>
              <RocketText style={styles.cameraGlyph} color="accent">✦</RocketText>
              <RocketText variant="bodyBold">Choose a photo or video</RocketText>
              <RocketText color="secondary" variant="caption">
                Preview it here before sharing
              </RocketText>
            </RocketPressable>
          )}
        </View>

        <RocketText style={styles.sectionTitle} variant="bodyBold">Share with</RocketText>
        <View style={styles.audienceOptions}>
          {AUDIENCES.map((audience) => {
            const selected = tier === audience.value;
            return (
              <RocketPressable
                key={audience.value}
                accessibilityLabel={`${audience.label} audience`}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => {
                  setTier(audience.value);
                  setError('');
                }}
                style={[
                  styles.audienceOption,
                  {
                    backgroundColor: selected ? colors.surfaceSecondary : colors.surface,
                    borderColor: selected ? colors.primaryAccent : colors.borderSubtle,
                  },
                ]}>
                <View style={styles.audienceText}>
                  <RocketText variant="bodyMedium">{audience.label}</RocketText>
                  <RocketText color="secondary" variant="caption">{audience.detail}</RocketText>
                </View>
                <View style={[styles.radioOuter, { borderColor: selected ? colors.primaryAccent : colors.border }]}>
                  {selected ? <View style={[styles.radioInner, { backgroundColor: colors.primaryAccent }]} /> : null}
                </View>
              </RocketPressable>
            );
          })}
        </View>

        {tier === 'closeFriends' && privacy ? (
          <RocketText color="secondary" style={styles.audienceNote} variant="caption">
            {privacy.closeFriends.length === 0
              ? 'Your Close Friends list is empty.'
              : `Shared with ${privacy.closeFriends.length} Close Friend${privacy.closeFriends.length === 1 ? '' : 's'}.`}
          </RocketText>
        ) : null}

        {tier === 'selected' ? (
          <View style={styles.friendsSection}>
            <View style={styles.friendsHeading}>
              <RocketText variant="bodyBold">Choose friends</RocketText>
              <RocketText color="secondary" variant="caption">{selectedIds.length}/50</RocketText>
            </View>
            {loadingFriends ? (
              <ActivityIndicator color={colors.primaryAccent} style={styles.friendLoader} />
            ) : friends.length === 0 ? (
              <RocketText color="secondary" style={styles.audienceNote} variant="caption">
                You do not have any accepted friends to select yet.
              </RocketText>
            ) : (
              <View style={styles.friendList}>
                {friends.map((friend) => {
                  const selected = selectedIdSet.has(friend.uid);
                  const disabled = !selected && selectedIds.length >= 50;
                  return (
                    <RocketPressable
                      key={friend.uid}
                      accessibilityLabel={`${friend.displayName}${selected ? ', selected' : ''}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected, disabled }}
                      disabled={disabled}
                      onPress={() => toggleFriend(friend.uid)}
                      style={[
                        styles.friendRow,
                        { borderBottomColor: colors.borderSubtle },
                      ]}>
                      <View style={styles.friendIdentity}>
                        <View style={[styles.friendAvatar, { backgroundColor: colors.surfaceSecondary }]}>
                          <RocketText color="secondary" variant="captionBold">
                            {friend.displayName.trim().slice(0, 1).toUpperCase()}
                          </RocketText>
                        </View>
                        <RocketText numberOfLines={1} style={styles.friendName} variant="body">
                          {friend.displayName}
                        </RocketText>
                      </View>
                      <View style={[
                        styles.checkbox,
                        {
                          backgroundColor: selected ? colors.primaryAccent : 'transparent',
                          borderColor: selected ? colors.primaryAccent : colors.border,
                        },
                      ]}>
                        {selected ? <RocketText color="inverse" variant="captionBold">✓</RocketText> : null}
                      </View>
                    </RocketPressable>
                  );
                })}
              </View>
            )}
          </View>
        ) : null}

        {error ? (
          <RocketText accessibilityRole="alert" color="error" style={styles.errorText} variant="caption">
            {error}
          </RocketText>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {isSubmitting ? (
          <View style={styles.stageRow} accessibilityRole="progressbar">
            <ActivityIndicator color={colors.primaryAccent} />
            <RocketText color="secondary" variant="bodyMedium">
              {stage === 'uploading' ? 'Uploading media...' : 'Publishing story...'}
            </RocketText>
          </View>
        ) : null}
        <RocketButton
          accessibilityHint="Uploads the selected media and shares your story"
          accessibilityLabel="Share story"
          disabled={!media || !user}
          label="Share story"
          loading={isSubmitting}
          onPress={() => void handlePublish()}
        />
      </View>
    </RocketScreen>
  );
}

function StoryMediaPreview({ media }: { media: StoryMedia }) {
  if (media.type === 'video') {
    return <VideoStoryPreview uri={media.uri} />;
  }
  return <Image contentFit="contain" source={{ uri: media.uri }} style={styles.previewMedia} />;
}

function VideoStoryPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.play();
  });

  return (
    <VideoView
      contentFit="contain"
      nativeControls
      player={player}
      style={styles.previewMedia}
    />
  );
}

const styles = StyleSheet.create({
  screenContent: {
    flex: 1,
    paddingHorizontal: 0,
  },
  header: {
    minHeight: 56,
    paddingHorizontal: SpacingScale.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: {
    width: 44,
  },
  scrollContent: {
    paddingHorizontal: SpacingScale.lg,
    paddingBottom: SpacingScale.lg,
  },
  scrollView: {
    flex: 1,
  },
  previewFrame: {
    width: '100%',
    height: 360,
    maxHeight: '58%',
    borderWidth: 1,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    marginTop: SpacingScale.sm,
    marginBottom: SpacingScale.xl,
  },
  previewMedia: {
    width: '100%',
    height: '100%',
  },
  emptyPreview: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SpacingScale.sm,
  },
  cameraGlyph: {
    fontSize: 40,
  },
  previewActions: {
    position: 'absolute',
    right: SpacingScale.sm,
    bottom: SpacingScale.sm,
    flexDirection: 'row',
    gap: SpacingScale.xs,
  },
  sectionTitle: {
    marginBottom: SpacingScale.sm,
  },
  audienceOptions: {
    gap: SpacingScale.sm,
  },
  audienceOption: {
    minHeight: 64,
    paddingHorizontal: SpacingScale.md,
    paddingVertical: SpacingScale.sm,
    borderWidth: 1,
    borderRadius: Radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  audienceText: {
    gap: 2,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  audienceNote: {
    marginTop: SpacingScale.sm,
  },
  friendsSection: {
    marginTop: SpacingScale.lg,
  },
  friendsHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SpacingScale.xs,
  },
  friendLoader: {
    paddingVertical: SpacingScale.lg,
  },
  friendList: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  friendRow: {
    minHeight: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  friendIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.sm,
    flex: 1,
    marginRight: SpacingScale.md,
  },
  friendAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendName: {
    flexShrink: 1,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    marginTop: SpacingScale.md,
  },
  footer: {
    gap: SpacingScale.sm,
    paddingHorizontal: SpacingScale.lg,
    paddingTop: SpacingScale.sm,
    paddingBottom: SpacingScale.sm,
  },
  stageRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SpacingScale.sm,
  },
});
