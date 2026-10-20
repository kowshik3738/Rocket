/**
 * Rocket Design System - Spacing Scale
 *
 * Provides a predictable, harmonious rhythm across the application.
 */

export const SpacingScale = {
  none: 0,
  xxs: 2, // 2px - micro borders, tick marks
  xs: 4, // 4px - badge spacing, tight gaps
  sm: 8, // 8px - standard element gap
  md: 12, // 12px - comfortable inner card padding
  lg: 16, // 16px - standard screen padding / row gap
  xl: 20, // 20px - container gutters
  xxl: 24, // 24px - large section margin
  xxxl: 32, // 32px - spacious hero padding
  huge: 40, // 40px - major separation
  massive: 48, // 48px - screen breaks
  epic: 64, // 64px - landing / hero separation
} as const;

/**
 * Backward-compatible mapping matching the legacy Spacing constants
 */
export const Spacing = {
  ...SpacingScale,
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export type SpacingKey = keyof typeof SpacingScale;
