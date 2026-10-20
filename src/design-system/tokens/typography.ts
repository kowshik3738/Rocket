/**
 * Rocket Design System - Typography Tokens
 *
 * Clean, readable, high-contrast typography hierarchy built for modern social interaction.
 */

import { TextStyle } from 'react-native';

export const Typography: Record<string, TextStyle> = {
  // Display - Hero titles, welcome screen impact
  display: {
    fontSize: 38,
    lineHeight: 44,
    fontWeight: '900',
    letterSpacing: -1.2,
  },

  // Screen Title - Top of main screens
  screenTitle: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
    letterSpacing: -0.6,
  },

  // Section Title - List sections, card group headers
  sectionTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    letterSpacing: -0.3,
  },

  // Subtitle / Kicker - Category headers, author subtext
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // Body - Standard readable paragraph and feed post content
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
    letterSpacing: -0.1,
  },

  // Body Medium - Emphasized body text
  bodyMedium: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: -0.1,
  },

  // Secondary Body - Descriptive subtexts, helper notices
  bodySecondary: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '400',
    letterSpacing: 0,
  },

  // Caption - Timestamps, counters, badges
  caption: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500',
    letterSpacing: 0.2,
  },

  // Caption Bold - Small labels, status tags
  captionBold: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  // Button - Standard CTA buttons
  button: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
    letterSpacing: -0.2,
  },

  // Button Small - Compact action buttons
  buttonSmall: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    letterSpacing: 0,
  },

  // Chat / Message Bubble Text - Optimized for continuous reading
  chatMessage: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '400',
    letterSpacing: -0.1,
  },

  // Chat Metadata - Bubble timestamp, read receipt label
  chatMeta: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    letterSpacing: 0.1,
  },

  // Chat System - Encryption notice, join/leave message
  chatSystem: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
} as const;

export type TypographyVariant = keyof typeof Typography;
