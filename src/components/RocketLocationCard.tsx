import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  Radius,
  RocketButton,
  RocketPressable,
  RocketText,
  SpacingScale,
  useRocketTheme,
} from '@/design-system';
import {
  formatCoordinates,
  LiveLocation,
  openInDeviceMaps,
} from '@/services/location-service';
import { subscribeToLiveLocationDoc } from '@/services/messaging-service';
import { subscribeToGroupLiveLocationDoc } from '@/services/group-service';

export interface RocketLocationCardProps {
  locationType: 'current' | 'live';
  latitude?: number | null;
  longitude?: number | null;
  liveLocationShareId?: string | null;
  conversationId?: string;
  groupId?: string;
  isMine: boolean;
  onStopSharing?: (shareId: string) => Promise<void>;
}

export function RocketLocationCard({
  locationType,
  latitude: initialLat,
  longitude: initialLon,
  liveLocationShareId,
  conversationId,
  groupId,
  isMine,
  onStopSharing,
}: RocketLocationCardProps) {
  const { colors } = useRocketTheme();
  const [liveDoc, setLiveDoc] = useState<LiveLocation | null>(null);
  const [stopping, setStopping] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Listen to live location updates if this is a live location card
  useEffect(() => {
    if (locationType !== 'live' || !liveLocationShareId) return;

    let unsubscribe: () => void = () => undefined;
    if (conversationId) {
      unsubscribe = subscribeToLiveLocationDoc(
        conversationId,
        liveLocationShareId,
        (data) => setLiveDoc(data),
        (err) => console.warn('[RocketLocationCard] liveLocation sub error:', err)
      );
    } else if (groupId) {
      unsubscribe = subscribeToGroupLiveLocationDoc(
        groupId,
        liveLocationShareId,
        (data) => setLiveDoc(data),
        (err) => console.warn('[RocketLocationCard] groupLiveLocation sub error:', err)
      );
    }

    return () => unsubscribe();
  }, [locationType, liveLocationShareId, conversationId, groupId]);

  // Timer to keep countdown fresh
  useEffect(() => {
    if (locationType !== 'live') return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [locationType]);

  const lat = locationType === 'live' ? liveDoc?.latitude ?? initialLat : initialLat;
  const lon = locationType === 'live' ? liveDoc?.longitude ?? initialLon : initialLon;

  const expiresAtMillis = liveDoc?.expiresAt?.toMillis
    ? liveDoc.expiresAt.toMillis()
    : null;
  const updatedAtMillis = liveDoc?.updatedAt?.toMillis
    ? liveDoc.updatedAt.toMillis()
    : null;
  const isStopped = !!liveDoc?.stoppedAt;
  const isExpired = expiresAtMillis ? now >= expiresAtMillis : false;
  const isActive = locationType === 'live' && !isStopped && !isExpired && !!liveDoc;
  const isStale = isActive && updatedAtMillis && now - updatedAtMillis > 7 * 60 * 1000;

  // Format remaining duration
  let remainingText = '';
  if (isActive && expiresAtMillis) {
    const remainingSeconds = Math.max(0, Math.floor((expiresAtMillis - now) / 1000));
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    if (hours > 0) {
      remainingText = `${hours}h ${minutes}m left`;
    } else {
      remainingText = `${Math.max(1, minutes)}m left`;
    }
  }

  const handleOpenMaps = () => {
    if (lat != null && lon != null) {
      void openInDeviceMaps(
        lat,
        lon,
        locationType === 'live' ? 'Live Location' : 'Pinned Location'
      );
    }
  };

  const handleStop = async () => {
    if (!liveLocationShareId || !onStopSharing || stopping) return;
    setStopping(true);
    try {
      await onStopSharing(liveLocationShareId);
    } catch (err) {
      console.warn('[RocketLocationCard] Failed to stop live location:', err);
    } finally {
      setStopping(false);
    }
  };

  const statusLabel =
    locationType === 'current'
      ? 'Current location'
      : isActive && !isStale
        ? `Sharing while Rocket is open · ${remainingText}`
        : isStale
          ? `Location updates paused · ${remainingText}`
          : isStopped
            ? 'Live location ended'
            : isExpired
              ? 'Live location expired'
              : 'Live location';

  return (
    <View
      style={[
        styles.cardContainer,
        {
          backgroundColor: isMine ? 'rgba(255, 255, 255, 0.15)' : colors.surfaceSecondary,
          borderColor: isMine ? 'rgba(255, 255, 255, 0.25)' : colors.borderSubtle,
        },
      ]}>
      {/* Header Row */}
      <View style={styles.headerRow}>
        <View
          style={[
            styles.iconRing,
            {
              backgroundColor: isActive
                ? 'rgba(32, 138, 239, 0.2)'
                : isMine
                  ? 'rgba(255, 255, 255, 0.2)'
                  : colors.surfaceTertiary,
            },
          ]}>
          <Text
            style={[
              styles.headerGlyph,
              {
                color: isActive
                  ? '#208AEF'
                  : isMine
                    ? '#FFFFFF'
                    : colors.primaryAccent,
              },
            ]}>
            {locationType === 'live' ? '📡' : '📍'}
          </Text>
        </View>

        <View style={styles.headerInfo}>
          <RocketText
            numberOfLines={1}
            style={[
              styles.cardTitle,
              { color: isMine ? '#FFFFFF' : colors.primaryText },
            ]}
            variant="bodyMedium">
            {locationType === 'live' ? 'Live location' : 'Current location'}
          </RocketText>
          <RocketText
            numberOfLines={1}
            style={[
              styles.statusText,
              {
                color: isActive
                  ? '#208AEF'
                  : isMine
                    ? 'rgba(255, 255, 255, 0.75)'
                    : colors.mutedText,
              },
            ]}
            variant="caption">
            {statusLabel}
          </RocketText>
        </View>
      </View>

      {/* Coordinate Display */}
      {lat != null && lon != null ? (
        <View style={styles.coordinateWrap}>
          <RocketText
            style={[
              styles.coordinateText,
              { color: isMine ? 'rgba(255, 255, 255, 0.85)' : colors.secondaryText },
            ]}
            variant="caption">
            {formatCoordinates(lat, lon)}
          </RocketText>
        </View>
      ) : null}

      {/* Action Buttons */}
      <View style={styles.actionsRow}>
        <RocketPressable
          accessibilityHint="Opens this position in system maps application"
          accessibilityLabel="Open in Maps"
          onPress={handleOpenMaps}
          style={[
            styles.mapButton,
            {
              backgroundColor: isMine ? 'rgba(255, 255, 255, 0.2)' : colors.surfaceTertiary,
              borderColor: isMine ? 'rgba(255, 255, 255, 0.3)' : colors.borderSubtle,
            },
          ]}>
          <RocketText
            style={[
              styles.mapButtonText,
              { color: isMine ? '#FFFFFF' : colors.primaryAccent },
            ]}
            variant="caption">
            Open in Maps
          </RocketText>
        </RocketPressable>

        {/* Stop Sharing Button (Only visible to owner while active) */}
        {locationType === 'live' && isMine && isActive ? (
          <RocketPressable
            accessibilityHint="Stops updating and sharing your live location"
            accessibilityLabel="Stop sharing"
            disabled={stopping}
            onPress={handleStop}
            style={[
              styles.stopButton,
              {
                backgroundColor: 'rgba(255, 59, 48, 0.15)',
                borderColor: 'rgba(255, 59, 48, 0.3)',
              },
            ]}>
            <RocketText
              style={styles.stopButtonText}
              variant="caption">
              {stopping ? 'Stopping...' : 'Stop sharing'}
            </RocketText>
          </RocketPressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: SpacingScale.sm,
    minWidth: 230,
    maxWidth: 300,
    marginVertical: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.xs,
  },
  iconRing: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerGlyph: {
    fontSize: 18,
  },
  headerInfo: {
    flex: 1,
  },
  cardTitle: {
    fontWeight: '600',
  },
  statusText: {
    fontSize: 11,
    marginTop: 1,
  },
  coordinateWrap: {
    marginTop: SpacingScale.xs,
    paddingHorizontal: 2,
  },
  coordinateText: {
    fontFamily: 'monospace',
    fontSize: 11,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.xs,
    marginTop: SpacingScale.sm,
  },
  mapButton: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapButtonText: {
    fontWeight: '600',
  },
  stopButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopButtonText: {
    color: '#FF3B30',
    fontWeight: '600',
  },
});
