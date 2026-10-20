import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Alert, Animated, Easing, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, View } from 'react-native';
import { useAuth } from '@/providers/auth-provider';
import { deleteStory, fetchStoriesForAuthor, fetchOwnActiveStories, fetchStoryViewers, Story, StoryViewer, recordStoryView } from '@/services/stories-service';
import { getProfileInitials, getProfileColor, getUserProfile, UserProfile } from '@/services/user-service';
import { RocketAvatar, RocketButton, RocketEmptyState, RocketPressable, RocketText, useRocketTheme, RocketLoadingIndicator, RocketIconButton } from '@/design-system';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEventListener } from 'expo';
import { SpacingScale } from '@/design-system/tokens/spacing';

const STORY_DURATION = 5000;


function getRelativeTime(timestamp?: any): string {
  if (!timestamp || !timestamp.toMillis) return '';
  const diffMs = Date.now() - timestamp.toMillis();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${Math.max(1, diffMins)}m`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h`;
  return `${Math.floor(diffHrs / 24)}d`;
}

export default function StoryViewerScreen() {
  const { authorUid } = useLocalSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useRocketTheme();

  const [stories, setStories] = useState<Story[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [authorName, setAuthorName] = useState('Rocket User');
  const [authorPhotoUrl, setAuthorPhotoUrl] = useState<string | undefined>();
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [viewersVisible, setViewersVisible] = useState(false);
  const [viewers, setViewers] = useState<Array<{ receipt: StoryViewer; profile: UserProfile | null }>>([]);
  const [viewerCount, setViewerCount] = useState<number | null>(null);
  const [viewerCountLoading, setViewerCountLoading] = useState(false);
  const [viewersLoading, setViewersLoading] = useState(false);
  const [viewersError, setViewersError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  
  const currentStory = stories[currentIndex];

  useEffect(() => { setVideoDuration(null); }, [currentIndex]);

  useFocusEffect(useCallback(() => {
    if (!user || !authorUid) return;
    let active = true;
    const fetchIt = async () => {
      try {
        setLoading(true);
        // Fetch Author Profile
        const profile = await getUserProfile(authorUid as string);
        if (active && profile) {
          setAuthorName(profile.displayName || 'Rocket User');
          setAuthorPhotoUrl(profile.photoUrl);
        }

        let fetchedStories = [];
        if (authorUid === user.uid) {
          fetchedStories = await fetchOwnActiveStories(user.uid);
          fetchedStories.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));
        } else {
          fetchedStories = await fetchStoriesForAuthor(user.uid, authorUid as string);
        }
        
        if (fetchedStories.length === 0) {
          if (active) router.back();
          return;
        }
        
        if (active) {
          setCurrentIndex(0);
          setStories(fetchedStories);
        }
      } catch (e) {
        console.error(e);
        if (active) router.back();
      } finally {
        if (active) setLoading(false);
      }
    };
    void fetchIt();
    return () => {
      active = false;
    };
  }, [user, authorUid, router]));

  // View recording
  useEffect(() => {
    if (!user || !currentStory || authorUid === user.uid) return;
    recordStoryView(currentStory.id, user.uid).catch(() => {
      // Best effort, ignore fail
    });
  }, [currentStory, user, authorUid]);

  useEffect(() => {
    if (!user || !currentStory || currentStory.authorUid !== user.uid) return;
    let active = true;
    setViewerCount(null);
    setViewerCountLoading(true);
    setViewersError('');
    void fetchStoryViewers(currentStory.id)
      .then((receipts) => {
        if (active) setViewerCount(receipts.length);
      })
      .catch((error) => {
        if (active) {
          setViewersError(error instanceof Error ? error.message : 'Viewer count could not be loaded.');
        }
      })
      .finally(() => {
        if (active) setViewerCountLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentStory, user]);

  const handleNext = () => {
    if (currentIndex < stories.length - 1) {
      setCurrentIndex(curr => curr + 1);
    } else {
      router.back();
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(curr => curr - 1);
    } else {
      // Replay first or do nothing
    }
  };

  async function openViewers() {
    if (!user || !currentStory || user.uid !== currentStory.authorUid || viewersLoading) return;
    setViewersVisible(true);
    setViewersLoading(true);
    setViewersError('');
    setViewers([]);
    try {
      const receipts = await fetchStoryViewers(currentStory.id);
      const profiles = await Promise.all(receipts.map((receipt) => getUserProfile(receipt.viewerUid)));
      setViewers(receipts.map((receipt, index) => ({ receipt, profile: profiles[index] })));
      setViewerCount(receipts.length);
    } catch (error) {
      setViewersError(error instanceof Error ? error.message : 'Viewers could not be loaded.');
    } finally {
      setViewersLoading(false);
    }
  }

  function confirmDeleteStory() {
    if (!user || !currentStory || user.uid !== currentStory.authorUid || deleting) return;
    Alert.alert('Delete this story?', 'This story will be removed for everyone who can view it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete story',
        style: 'destructive',
        onPress: () => void executeDeleteStory(currentStory),
      },
    ]);
  }

  async function executeDeleteStory(story: Story) {
    if (!user || user.uid !== story.authorUid || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteStory(story.id);
      const remaining = stories.filter((item) => item.id !== story.id);
      setStories(remaining);
      setViewersVisible(false);
      setViewers([]);
      if (remaining.length === 0) {
        router.back();
      } else {
        setCurrentIndex(Math.min(currentIndex, remaining.length - 1));
      }
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'This story could not be deleted. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  if (loading || stories.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <RocketLoadingIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StoryContent story={currentStory} onComplete={handleNext} isActive={!viewersVisible} onDurationKnown={setVideoDuration} />
      
      {/* Absolute Overlays */}
      <SafeAreaView style={styles.safeOverlay}>
        <View style={styles.topBar}>
          <View style={styles.progressRow}>
            {stories.map((s, idx) => (
              <ProgressBar 
                key={s.id} 
                isActive={idx === currentIndex} 
                isPassed={idx < currentIndex} 
                duration={s.type === 'video' ? (idx === currentIndex ? videoDuration : null) : STORY_DURATION}
              />
            ))}
          </View>
          <View style={styles.headerInfo}>
            <View style={styles.authorGroup}>
              <RocketAvatar 
                size={36} 
                source={authorPhotoUrl}
                initials={getProfileInitials(authorName)} 
                color={getProfileColor(authorUid as string)} 
                hasOrbit={false}
              />
              <RocketText variant="bodyBold" style={styles.authorName}>{authorName}</RocketText>
              <RocketText variant="caption" style={styles.timeText}>{getRelativeTime(currentStory.createdAt)}</RocketText>
            </View>
            <View style={styles.headerActions}>
              {user?.uid === authorUid ? (
                <RocketButton
                  label="Add story"
                  onPress={() => router.push('/story-create' as any)}
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                />
              ) : null}
              <RocketIconButton
                glyph="✕"
                variant="ghost"
                size="sm"
                onPress={() => router.back()}
                accessibilityLabel="Close story"
              />
            </View>
          </View>
        </View>
      </SafeAreaView>

      {user?.uid === currentStory.authorUid ? (
        <View style={styles.ownerControls}>
          {deleteError ? (
            <RocketText color="error" style={styles.deleteError} variant="caption">
              {deleteError}
            </RocketText>
          ) : null}
          <RocketPressable
            accessibilityLabel={`View story viewers, ${viewerCountLoading ? 'loading viewer count' : viewerCount ?? 'unavailable'} viewers`}
            accessibilityRole="button"
            disabled={deleting}
            onPress={() => void openViewers()}
            style={[styles.viewerControl, { backgroundColor: 'rgba(8,10,17,0.78)' }]}>
            <RocketText style={styles.viewerGlyph}>◉</RocketText>
            <RocketText color="primary" variant="captionBold">
              {viewerCountLoading && viewerCount === null ? '…' : viewerCount ?? '—'}
            </RocketText>
          </RocketPressable>
          <RocketIconButton
            accessibilityLabel="Delete story"
            disabled={deleting}
            glyph={deleting ? '…' : '⌫'}
            onPress={confirmDeleteStory}
            variant="filled"
          />
        </View>
      ) : null}

      <Modal
        animationType="slide"
        onRequestClose={() => setViewersVisible(false)}
        transparent
        visible={viewersVisible}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.viewerSheet, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <RocketText variant="sectionTitle">Story viewers</RocketText>
                <RocketText color="secondary" variant="caption">
                  {viewersLoading ? 'Loading viewers...' : `${viewers.length} ${viewers.length === 1 ? 'viewer' : 'viewers'}`}
                </RocketText>
              </View>
              <RocketIconButton
                accessibilityLabel="Close viewer list"
                glyph="✕"
                onPress={() => setViewersVisible(false)}
                variant="ghost"
              />
            </View>
            {viewersLoading ? (
              <View style={styles.viewersLoading}>
                <RocketLoadingIndicator size="normal" />
              </View>
            ) : viewersError ? (
              <RocketText accessibilityRole="alert" color="error" style={styles.viewersError} variant="bodySecondary">
                {viewersError}
              </RocketText>
            ) : viewers.length === 0 ? (
              <RocketEmptyState
                body="When friends view this story, they will appear here."
                style={styles.viewersEmpty}
                title="No viewers yet"
              />
            ) : (
              <ScrollView contentContainerStyle={styles.viewerList} showsVerticalScrollIndicator={false}>
                {viewers.map(({ receipt, profile }) => {
                  const displayName = profile?.displayName || 'Rocket user';
                  return (
                    <View key={receipt.viewerUid} style={styles.viewerRow}>
                      <RocketAvatar
                        accessibilityLabel={`${displayName} profile picture`}
                        color={getProfileColor(receipt.viewerUid)}
                        initials={getProfileInitials(displayName)}
                        source={profile?.photoUrl}
                        size={44}
                      />
                      <View style={styles.viewerIdentity}>
                        <RocketText numberOfLines={1} variant="bodyMedium">{displayName}</RocketText>
                        {profile?.username ? (
                          <RocketText color="secondary" numberOfLines={1} variant="caption">
                            @{profile.username}
                          </RocketText>
                        ) : null}
                      </View>
                      {receipt.viewedAt ? (
                        <RocketText color="muted" variant="caption">
                          {getRelativeTime(receipt.viewedAt)}
                        </RocketText>
                      ) : null}
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <View style={styles.touchZones}>
        <RocketPressable style={styles.leftZone} onPress={handlePrev}><View style={{flex: 1}} /></RocketPressable>
        <RocketPressable style={styles.rightZone} onPress={handleNext}><View style={{flex: 1}} /></RocketPressable>
      </View>
    </View>
  );
}

const ProgressBar = ({ isActive, isPassed, duration }: { isActive: boolean, isPassed: boolean, duration: number | null }) => {
  const widthAnim = useRef(new Animated.Value(isPassed ? 100 : 0)).current;

  useEffect(() => {
    if (isActive && duration) {
      widthAnim.setValue(0);
      Animated.timing(widthAnim, {
        toValue: 100,
        duration,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();
    } else if (isPassed) {
      widthAnim.setValue(100);
    } else {
      widthAnim.setValue(0);
    }
  }, [isActive, isPassed, duration]);

  const width = widthAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={[styles.progressTrack, { backgroundColor: 'rgba(255,255,255,0.3)' }]}>
      <Animated.View style={[styles.progressFill, { width, backgroundColor: '#FFF' }]} />
    </View>
  );
};

const StoryContent = ({ story, onComplete, isActive, onDurationKnown }: { story: Story, onComplete: () => void, isActive: boolean, onDurationKnown: (d: number) => void }) => {
  const { colors } = useRocketTheme();

  useEffect(() => {
    if (story.type === 'video' || !isActive) return;
    const t = setTimeout(onComplete, STORY_DURATION);
    return () => clearTimeout(t);
  }, [story.id, story.type, onComplete, isActive]);

  if (story.type === 'text') {
    const bgMap: Record<string, string> = {
      classic: colors.surfaceSecondary,
      modern: colors.primaryAccent,
      neon: '#FF0055',
      mono: '#111111'
    };
    const bg = story.backgroundColor && bgMap[story.backgroundColor] ? bgMap[story.backgroundColor] : colors.background;
    return (
      <View style={[styles.contentContainer, { backgroundColor: bg }]}>
        <RocketText variant="screenTitle" style={styles.textContent}>{story.text}</RocketText>
      </View>
    );
  }

  if (story.type === 'image') {
    return (
      <View style={styles.contentContainer}>
        <Image source={story.mediaUrl} style={styles.media} contentFit="contain" />
      </View>
    );
  }

  if (story.type === 'video') {
    return <VideoStory url={story.mediaUrl!} onComplete={onComplete} isActive={isActive} onDurationKnown={onDurationKnown} />;
  }

  return <View style={styles.contentContainer} />;
};

import { useEvent } from 'expo';

const VideoStory = ({ url, onComplete, isActive, onDurationKnown }: { url: string, onComplete: () => void, isActive: boolean, onDurationKnown: (d: number) => void }) => {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
  });

  const { status } = useEvent(player, 'statusChange', { status: player.status });

  useEffect(() => {
    if (status === 'readyToPlay' && player.duration) {
      onDurationKnown(player.duration * 1000);
    }
  }, [status, player]);

  useEventListener(player, 'playToEnd', () => {
    onComplete();
  });

  useEffect(() => {
    if (isActive) {
      player.play();
    } else {
      player.pause();
    }
  }, [isActive, player]);

  useEffect(() => {
    return () => {
      player.pause();
    };
  }, [player]);

  return (
    <View style={styles.contentContainer}>
       <VideoView style={styles.media} player={player} nativeControls={false} contentFit="contain" />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  textContent: {
    textAlign: 'center',
    padding: SpacingScale.epic,
    color: '#FFF',
  },
  media: {
    width: '100%',
    height: '100%',
  },
  safeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  topBar: {
    paddingHorizontal: SpacingScale.md,
    paddingTop: Platform.OS === 'android' ? SpacingScale.xl : SpacingScale.sm,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: SpacingScale.sm,
  },
  progressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  headerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.xs,
  },
  ownerControls: {
    position: 'absolute',
    right: SpacingScale.lg,
    bottom: SpacingScale.xl,
    zIndex: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.sm,
  },
  viewerControl: {
    minWidth: 56,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: SpacingScale.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SpacingScale.xs,
  },
  viewerGlyph: {
    color: '#FFFFFF',
    fontSize: 17,
  },
  deleteError: {
    maxWidth: 150,
    textAlign: 'right',
    backgroundColor: 'rgba(8,10,17,0.85)',
    padding: SpacingScale.xs,
    borderRadius: 8,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  viewerSheet: {
    height: '72%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingTop: SpacingScale.sm,
    paddingHorizontal: SpacingScale.lg,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(148,163,184,0.55)',
    marginBottom: SpacingScale.md,
  },
  sheetHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148,163,184,0.2)',
    marginBottom: SpacingScale.xs,
  },
  viewersLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewersError: {
    paddingVertical: SpacingScale.xl,
  },
  viewersEmpty: {
    flex: 1,
    paddingVertical: SpacingScale.xl,
  },
  viewerList: {
    paddingBottom: SpacingScale.xl,
  },
  viewerRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148,163,184,0.15)',
  },
  viewerIdentity: {
    flex: 1,
  },
  authorGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.sm,
  },
  timeText: {
    color: 'rgba(255,255,255,0.7)',
    marginLeft: 4,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  authorName: {
    color: '#FFF',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  touchZones: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    zIndex: 5,
  },
  leftZone: {
    flex: 1,
  },
  rightZone: {
    flex: 2,
  },
});
