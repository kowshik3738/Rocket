import React, { useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  Radius,
  RocketLoadingIndicator,
  RocketPressable,
  RocketText,
  SpacingScale,
  useRocketTheme,
} from '@/design-system';
import {
  acquireCurrentPosition,
  Coordinates,
  LiveLocationDuration,
  requestForegroundLocationPermission,
} from '@/services/location-service';

export interface RocketLocationPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  onSendCurrentLocation: (coords: Coordinates) => Promise<void>;
  onStartLiveLocation: (coords: Coordinates, duration: LiveLocationDuration) => Promise<void>;
}

export function RocketLocationPickerSheet({
  visible,
  onClose,
  onSendCurrentLocation,
  onStartLiveLocation,
}: RocketLocationPickerSheetProps) {
  const { colors } = useRocketTheme();
  const [step, setStep] = useState<'main' | 'duration'>('main');
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');

  const handleClose = () => {
    if (loading) return;
    setStep('main');
    onClose();
  };

  const handleSendCurrent = async () => {
    try {
      setLoading(true);
      setLoadingText('Acquiring current position...');
      const coords = await acquireCurrentPosition();
      await onSendCurrentLocation(coords);
      handleClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not acquire location.';
      if (message.includes('permission')) {
        Alert.alert(
          'Location Permission Required',
          'Allow Rocket to access your location to share it with your friends.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open Settings',
              onPress: () => void Linking.openSettings().catch(() => undefined),
            },
          ]
        );
      } else {
        Alert.alert('Location Error', message);
      }
    } finally {
      setLoading(false);
      setLoadingText('');
    }
  };

  const handleSelectLiveDuration = async (duration: LiveLocationDuration) => {
    try {
      setLoading(true);
      setLoadingText('Starting live location...');
      const granted = await requestForegroundLocationPermission();
      if (!granted) {
        Alert.alert(
          'Location Permission Required',
          'Allow Rocket to access your location to share your live location.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open Settings',
              onPress: () => void Linking.openSettings().catch(() => undefined),
            },
          ]
        );
        return;
      }

      const coords = await acquireCurrentPosition();
      await onStartLiveLocation(coords, duration);
      handleClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start live location.';
      Alert.alert('Live Location Error', message);
    } finally {
      setLoading(false);
      setLoadingText('');
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={handleClose}
      transparent
      visible={visible}>
      <Pressable onPress={handleClose} style={styles.backdrop}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceSecondary,
              borderColor: colors.borderSubtle,
            },
          ]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
            <RocketText style={styles.title} variant="bodyMedium">
              {step === 'main' ? 'Location' : 'Share live location'}
            </RocketText>
            <RocketText color="muted" style={styles.notice} variant="caption">
              Live location updates while Rocket is open
            </RocketText>
          </View>

          {loading ? (
            <View style={styles.loadingWrap}>
              <RocketLoadingIndicator size="normal" />
              <RocketText color="secondary" style={styles.loadingText} variant="caption">
                {loadingText}
              </RocketText>
            </View>
          ) : step === 'main' ? (
            <View style={styles.actionsCol}>
              {/* Option 1: Send current location */}
              <RocketPressable
                accessibilityHint="Gets your current position and sends it as a pinned location"
                accessibilityLabel="Send current location"
                onPress={handleSendCurrent}
                style={[styles.row, { borderBottomColor: colors.borderSubtle }]}>
                <View style={[styles.iconWrap, { backgroundColor: colors.surfaceTertiary }]}>
                  <Text style={styles.glyph}>📍</Text>
                </View>
                <View style={styles.textWrap}>
                  <RocketText style={styles.rowTitle} variant="body">
                    Send current location
                  </RocketText>
                  <RocketText color="secondary" variant="caption">
                    Accurate to device GPS fix
                  </RocketText>
                </View>
              </RocketPressable>

              {/* Option 2: Share live location */}
              <RocketPressable
                accessibilityHint="Choose a duration to share your live location"
                accessibilityLabel="Share live location"
                onPress={() => setStep('duration')}
                style={styles.row}>
                <View style={[styles.iconWrap, { backgroundColor: 'rgba(32, 138, 239, 0.15)' }]}>
                  <Text style={styles.glyph}>📡</Text>
                </View>
                <View style={styles.textWrap}>
                  <RocketText style={styles.rowTitle} variant="body">
                    Share live location...
                  </RocketText>
                  <RocketText color="secondary" variant="caption">
                    Select 15m, 1h, or 8h duration
                  </RocketText>
                </View>
              </RocketPressable>
            </View>
          ) : (
            <View style={styles.actionsCol}>
              {/* Duration: 15 minutes */}
              <RocketPressable
                accessibilityHint="Share live location for 15 minutes"
                accessibilityLabel="15 minutes"
                onPress={() => void handleSelectLiveDuration(15)}
                style={[styles.row, { borderBottomColor: colors.borderSubtle }]}>
                <View style={[styles.iconWrap, { backgroundColor: colors.surfaceTertiary }]}>
                  <Text style={styles.durationGlyph}>15m</Text>
                </View>
                <View style={styles.textWrap}>
                  <RocketText style={styles.rowTitle} variant="body">
                    15 minutes
                  </RocketText>
                  <RocketText color="secondary" variant="caption">
                    Quick meetups
                  </RocketText>
                </View>
              </RocketPressable>

              {/* Duration: 1 hour */}
              <RocketPressable
                accessibilityHint="Share live location for 1 hour"
                accessibilityLabel="1 hour"
                onPress={() => void handleSelectLiveDuration(60)}
                style={[styles.row, { borderBottomColor: colors.borderSubtle }]}>
                <View style={[styles.iconWrap, { backgroundColor: colors.surfaceTertiary }]}>
                  <Text style={styles.durationGlyph}>1h</Text>
                </View>
                <View style={styles.textWrap}>
                  <RocketText style={styles.rowTitle} variant="body">
                    1 hour
                  </RocketText>
                  <RocketText color="secondary" variant="caption">
                    Transit or gatherings
                  </RocketText>
                </View>
              </RocketPressable>

              {/* Duration: 8 hours */}
              <RocketPressable
                accessibilityHint="Share live location for 8 hours"
                accessibilityLabel="8 hours"
                onPress={() => void handleSelectLiveDuration(480)}
                style={[styles.row, { borderBottomColor: colors.borderSubtle }]}>
                <View style={[styles.iconWrap, { backgroundColor: colors.surfaceTertiary }]}>
                  <Text style={styles.durationGlyph}>8h</Text>
                </View>
                <View style={styles.textWrap}>
                  <RocketText style={styles.rowTitle} variant="body">
                    8 hours
                  </RocketText>
                  <RocketText color="secondary" variant="caption">
                    Full day out
                  </RocketText>
                </View>
              </RocketPressable>

              {/* Back to main */}
              <RocketPressable
                accessibilityHint="Back to location options"
                accessibilityLabel="Back"
                onPress={() => setStep('main')}
                style={styles.backRow}>
                <RocketText color="accent" style={styles.backText} variant="bodyMedium">
                  ← Back
                </RocketText>
              </RocketPressable>
            </View>
          )}

          {/* Cancel button */}
          <RocketPressable
            accessibilityHint="Closes location sheet"
            accessibilityLabel="Cancel"
            disabled={loading}
            onPress={handleClose}
            style={[styles.cancelBtn, { borderTopColor: colors.borderSubtle }]}>
            <RocketText color="secondary" variant="bodyMedium">
              Cancel
            </RocketText>
          </RocketPressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SpacingScale.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    paddingVertical: SpacingScale.md,
    paddingHorizontal: SpacingScale.md,
    borderBottomWidth: 1,
    alignItems: 'center',
  },
  title: {
    fontWeight: '700',
    fontSize: 16,
  },
  notice: {
    marginTop: 2,
    fontSize: 11,
  },
  actionsCol: {
    paddingHorizontal: SpacingScale.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SpacingScale.sm,
    paddingHorizontal: SpacingScale.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: SpacingScale.sm,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    fontSize: 20,
  },
  durationGlyph: {
    fontSize: 14,
    fontWeight: '700',
    color: '#208AEF',
  },
  textWrap: {
    flex: 1,
  },
  rowTitle: {
    fontWeight: '600',
  },
  backRow: {
    paddingVertical: SpacingScale.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: {
    fontWeight: '600',
  },
  loadingWrap: {
    paddingVertical: SpacingScale.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SpacingScale.sm,
  },
  loadingText: {
    marginTop: 4,
  },
  cancelBtn: {
    borderTopWidth: 1,
    paddingVertical: SpacingScale.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
