/**
 * Rocket Design System - Corner Radius Tokens
 *
 * Distinctive rounded surfaces that embody the Rocket Orbit aesthetic.
 */

export const Radius = {
  none: 0,
  xs: 6, // Micro tags, inline chips
  sm: 10, // Small badges, compact pill buttons
  md: 14, // Form inputs, secondary buttons
  lg: 20, // Standard cards, dialogs, sheets
  xl: 26, // Large hero surfaces, feature cards
  xxl: 34, // Prominent orbital containers
  full: 9999, // Circular avatars, pills, orbit rings
} as const;

export type RadiusKey = keyof typeof Radius;
