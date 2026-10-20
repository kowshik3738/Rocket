import React, { useRef } from 'react';
import {
  Animated,
  GestureResponderEvent,
  Insets,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { AnimationDurations, AnimationSprings, AnimationScales, AnimationOpacities } from '../tokens/animation';
import { useReducedMotion } from '../hooks/useReducedMotion';

export interface RocketPressableProps extends Omit<PressableProps, 'style'> {
  children: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
  style?: StyleProp<ViewStyle>;
  pressedStyle?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  pressScale?: number;
  pressOpacity?: number;
  hitSlop?: Insets | number;
  disabled?: boolean;
}

/**
 * Foundation pressable component for Rocket.
 * Provides a subtle, premium press-down and spring-release feel.
 * Respects reduced-motion preferences and enforces accessible touch targets.
 */
export function RocketPressable({
  children,
  style,
  pressedStyle,
  contentContainerStyle,
  pressScale = AnimationScales.pressedButton,
  pressOpacity = AnimationOpacities.pressed,
  hitSlop = 8,
  disabled = false,
  onPressIn,
  onPressOut,
  ...rest
}: RocketPressableProps) {
  const reducedMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const handlePressIn = (e: GestureResponderEvent) => {
    if (disabled) return;

    if (!reducedMotion) {
      Animated.timing(scale, {
        toValue: pressScale,
        duration: AnimationDurations.fast,
        useNativeDriver: true,
      }).start();
    }

    Animated.timing(opacity, {
      toValue: pressOpacity,
      duration: AnimationDurations.fast,
      useNativeDriver: true,
    }).start();

    onPressIn?.(e);
  };

  const handlePressOut = (e: GestureResponderEvent) => {
    if (!reducedMotion) {
      Animated.spring(scale, {
        toValue: 1,
        tension: AnimationSprings.press.tension,
        friction: AnimationSprings.press.friction,
        useNativeDriver: true,
      }).start();
    }

    Animated.timing(opacity, {
      toValue: 1,
      duration: AnimationDurations.fast,
      useNativeDriver: true,
    }).start();

    onPressOut?.(e);
  };

  return (
    <Pressable
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={({ pressed }) => [
        styles.base,
        disabled && styles.disabled,
        typeof style === 'function' ? null : style,
        pressed && pressedStyle,
      ]}
      {...rest}>
      {({ pressed }) => (
        <Animated.View
          style={[
            styles.animatedContainer,
            contentContainerStyle,
            {
              transform: [{ scale }],
              opacity: disabled ? AnimationOpacities.disabled : opacity,
            },
          ]}>
          {typeof children === 'function' ? children({ pressed }) : children}
        </Animated.View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  animatedContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabled: {
    opacity: AnimationOpacities.disabled,
  },
});
