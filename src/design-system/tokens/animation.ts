/**
 * Rocket Design System - Animation Constants
 *
 * Interaction timing, spring physics, and easing profiles.
 * Designed for a premium, snappy feel that stays fast and responsive
 * without feeling bouncy or cartoonish.
 */

export const AnimationDurations = {
  // Fast - Button press-down, micro-interactions, toggles
  fast: 110,

  // Normal - State transitions, dropdown reveals, tab switches
  normal: 220,

  // Slow - Modal dialogs, screen fades, bottom sheet presentations
  slow: 360,

  // Orbit - Continuous rotation loop for Rocket Orbit Loader
  orbitLoop: 2600,

  // Spark - Central spark pulsing period
  sparkPulse: 1500,
} as const;

export const AnimationSprings = {
  // Snappy press spring - quick release with zero overshoot
  press: {
    tension: 340,
    friction: 18,
    useNativeDriver: true,
  },

  // Interactive card release - slightly softer but still crisp
  card: {
    tension: 280,
    friction: 20,
    useNativeDriver: true,
  },

  // Modal / sheet entry
  dialog: {
    tension: 220,
    friction: 22,
    useNativeDriver: true,
  },
} as const;

export const AnimationScales = {
  pressedButton: 0.975,
  pressedCard: 0.985,
  pressedIcon: 0.92,
  sparkPulseMin: 0.85,
  sparkPulseMax: 1.15,
} as const;

export const AnimationOpacities = {
  pressed: 0.82,
  disabled: 0.45,
  glowMin: 0.5,
  glowMax: 0.95,
} as const;
