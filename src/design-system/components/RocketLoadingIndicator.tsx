import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { useRocketTheme } from '../hooks/useRocketTheme';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { AnimationDurations } from '../tokens/animation';
import { RocketSpark } from './RocketSpark';

export type RocketLoadingSize = 'small' | 'normal' | 'large';

export interface RocketLoadingIndicatorProps {
  size?: RocketLoadingSize;
  color?: string;
  sparkColor?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

interface SizeDimensions {
  containerSize: number;
  sparkSize: number;
  orbitRingSize: number;
  primarySatelliteSize: number;
  secondarySatelliteSize: number;
  borderWidth: number;
}

const SIZE_MAP: Record<RocketLoadingSize, SizeDimensions> = {
  small: {
    containerSize: 24,
    sparkSize: 10,
    orbitRingSize: 22,
    primarySatelliteSize: 4,
    secondarySatelliteSize: 3,
    borderWidth: 1,
  },
  normal: {
    containerSize: 48,
    sparkSize: 18,
    orbitRingSize: 44,
    primarySatelliteSize: 7,
    secondarySatelliteSize: 5,
    borderWidth: 1.5,
  },
  large: {
    containerSize: 72,
    sparkSize: 26,
    orbitRingSize: 66,
    primarySatelliteSize: 10,
    secondarySatelliteSize: 7,
    borderWidth: 2,
  },
};

/**
 * Rocket Orbit Loader
 *
 * Unique visual foundation loader for Rocket.
 * - Central celestial spark stays centered and subtly pulses
 * - Lightweight satellite elements smoothly rotate on the orbit ring
 * - Highly optimized for Android 60fps native execution
 * - Fully respects reduced-motion accessibility preference
 */
export function RocketLoadingIndicator({
  size = 'normal',
  color,
  sparkColor,
  style,
  accessibilityLabel = 'Loading',
}: RocketLoadingIndicatorProps) {
  const { colors } = useRocketTheme();
  const reducedMotion = useReducedMotion();

  const rotationAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const dims = SIZE_MAP[size] || SIZE_MAP.normal;
  const primaryColor = color || colors.primaryAccent;
  const secondaryColor = colors.secondaryAccent;
  const sparkColorResolved = sparkColor || colors.highlight;

  useEffect(() => {
    if (reducedMotion) {
      rotationAnim.setValue(0);
      pulseAnim.setValue(1);
      return;
    }

    // Continuous smooth rotation for the orbit ring satellites
    const rotateLoop = Animated.loop(
      Animated.timing(rotationAnim, {
        toValue: 1,
        duration: AnimationDurations.orbitLoop,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    // Subtle breathing pulse for the central spark
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.18,
          duration: AnimationDurations.sparkPulse / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.88,
          duration: AnimationDurations.sparkPulse / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    rotateLoop.start();
    pulseLoop.start();

    return () => {
      rotateLoop.stop();
      pulseLoop.stop();
    };
  }, [reducedMotion, rotationAnim, pulseAnim]);

  const spin = rotationAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View
      style={[
        styles.container,
        {
          width: dims.containerSize,
          height: dims.containerSize,
        },
        style,
      ]}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite">
      {/* Static Translucent Orbit Track */}
      <View
        style={[
          styles.orbitTrack,
          {
            width: dims.orbitRingSize,
            height: dims.orbitRingSize,
            borderRadius: dims.orbitRingSize / 2,
            borderWidth: dims.borderWidth,
            borderColor: colors.borderSubtle,
          },
        ]}
      />

      {/* Rotating Orbit Ring with Satellites */}
      <Animated.View
        style={[
          styles.rotatingOrbit,
          {
            width: dims.orbitRingSize,
            height: dims.orbitRingSize,
            transform: reducedMotion ? [] : [{ rotate: spin }],
          },
        ]}>
        {/* Primary Satellite (Electric Violet/Blue) */}
        <View
          style={[
            styles.satellite,
            {
              top: -dims.primarySatelliteSize / 2,
              left: (dims.orbitRingSize - dims.primarySatelliteSize) / 2,
              width: dims.primarySatelliteSize,
              height: dims.primarySatelliteSize,
              borderRadius: dims.primarySatelliteSize / 2,
              backgroundColor: primaryColor,
              shadowColor: primaryColor,
              shadowOpacity: 0.6,
              shadowRadius: 4,
            },
          ]}
        />

        {/* Secondary Orbiting Spark (Cosmic Blue or Pink) */}
        <View
          style={[
            styles.satellite,
            {
              bottom: (dims.orbitRingSize - dims.secondarySatelliteSize) / 3,
              right: -dims.secondarySatelliteSize / 2,
              width: dims.secondarySatelliteSize,
              height: dims.secondarySatelliteSize,
              borderRadius: dims.secondarySatelliteSize / 2,
              backgroundColor: secondaryColor,
              shadowColor: secondaryColor,
              shadowOpacity: 0.4,
              shadowRadius: 3,
            },
          ]}
        />
      </Animated.View>

      {/* Central Pulsing Spark */}
      <Animated.View
        style={[
          styles.centerSparkContainer,
          {
            transform: reducedMotion ? [] : [{ scale: pulseAnim }],
          },
        ]}>
        <RocketSpark
          size={dims.sparkSize}
          color={sparkColorResolved}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  orbitTrack: {
    position: 'absolute',
    borderStyle: 'solid',
    opacity: 0.6,
  },
  rotatingOrbit: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  satellite: {
    position: 'absolute',
  },
  centerSparkContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
