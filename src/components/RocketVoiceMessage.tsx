import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { AudioPlayer, createAudioPlayer, AudioStatus } from 'expo-audio';
import { useRocketTheme } from '@/design-system';
import { RocketIconButton } from '@/components/rocket-ui';
import { getCallState } from '@/services/call-service';

interface Props {
  messageId: string;
  audioUrl: string;
  durationMs?: number;
}

let sharedPlayer: AudioPlayer | null = null;
let currentMessageId: string | null = null;

function getSharedPlayer() {
  if (!sharedPlayer) {
    sharedPlayer = createAudioPlayer();
  }
  return sharedPlayer;
}

export function pauseVoiceMessagePlayback() {
  if (sharedPlayer?.playing) sharedPlayer.pause();
}

export function RocketVoiceMessage({ messageId, audioUrl, durationMs = 0 }: Props) {
  const { colors } = useRocketTheme();
  
  const [playbackRate, setPlaybackRate] = useState<1 | 1.5 | 2>(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loadedDurationMs, setLoadedDurationMs] = useState(durationMs);

  useEffect(() => {
    const p = getSharedPlayer();
    
    if (currentMessageId === messageId) {
      setIsPlaying(p.playing);
      setCurrentTime(p.currentTime);
    } else {
      setIsPlaying(false);
      setCurrentTime(0);
    }

    const listener = p.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      if (currentMessageId === messageId) {
        setIsPlaying(status.playing);
        setCurrentTime(status.currentTime);
        if (status.duration > 0) setLoadedDurationMs(status.duration * 1000);
      } else {
        setIsPlaying(false);
        setCurrentTime(0);
      }
    });

    return () => {
      listener.remove();
    };
  }, [messageId]);

  const handlePlayPause = useCallback(() => {
    if (getCallState().call !== null) {
      return;
    }
    
    const p = getSharedPlayer();
    if (currentMessageId !== messageId) {
      currentMessageId = messageId;
      p.replace(audioUrl);
      p.playbackRate = playbackRate;
      p.play();
    } else {
      if (p.playing) {
        p.pause();
      } else {
        p.playbackRate = playbackRate;
        p.play();
      }
    }
  }, [audioUrl, messageId, playbackRate]);

  const handleRateChange = useCallback(() => {
    let next: 1 | 1.5 | 2 = 1;
    if (playbackRate === 1) next = 1.5;
    else if (playbackRate === 1.5) next = 2;
    
    setPlaybackRate(next);
    
    if (currentMessageId === messageId) {
      const p = getSharedPlayer();
      p.playbackRate = next;
    }
  }, [playbackRate, messageId]);

  const formatTime = (totalSeconds: number) => {
    const sec = Math.max(0, Math.floor(totalSeconds));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const effectiveDurationMs = loadedDurationMs || durationMs;
  const progress = effectiveDurationMs > 0 ? (currentTime * 1000) / effectiveDurationMs : 0;
  
  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <RocketIconButton
        accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
        accessibilityHint="Toggles voice message playback"
        onPress={handlePlayPause}
        glyph={isPlaying ? '⏸' : '▶'}
        size="md"
        variant="accent"
      />
      
      <View style={styles.trackContainer}>
        <View style={[styles.trackBackground, { backgroundColor: colors.border }]} />
        <View style={[
          styles.trackForeground, 
          { 
            backgroundColor: colors.accent,
            width: `${Math.min(100, Math.max(0, progress * 100))}%` 
          }
        ]} />
      </View>
      
      <View style={styles.rightControls}>
        <Text style={[styles.timeText, { color: colors.secondaryText }]}>
          {isPlaying 
            ? formatTime(currentTime)
            : formatTime(effectiveDurationMs / 1000)}
        </Text>
        <Pressable onPress={handleRateChange} style={styles.rateButton}>
          <Text style={[styles.rateText, { color: colors.primaryText }]}>
            {playbackRate}x
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 24,
    gap: 8,
    maxWidth: 300,
  },
  trackContainer: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    position: 'relative',
    marginHorizontal: 4,
  },
  trackBackground: {
    position: 'absolute',
    left: 0, right: 0, top: 0, bottom: 0,
    borderRadius: 2,
  },
  trackForeground: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 2,
  },
  rightControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeText: {
    fontSize: 12,
    minWidth: 32,
  },
  rateButton: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  rateText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
