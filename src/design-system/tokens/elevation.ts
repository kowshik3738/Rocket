/**
 * Rocket Design System - Elevation & Shadows
 *
 * Engineered with Android performance at the forefront.
 * Uses lightweight native elevation on Android and subtle shadow properties on iOS,
 * avoiding expensive real-time raster blurs on high-frequency components.
 */

import { Platform, ViewStyle } from 'react-native';

export const Elevation: Record<'none' | 'subtle' | 'low' | 'medium' | 'high', ViewStyle> = {
  none: {
    ...Platform.select({
      android: { elevation: 0 },
      ios: {
        shadowColor: 'transparent',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0,
        shadowRadius: 0,
      },
      default: {},
    }),
  },

  // Subtle - for secondary cards and list tiles
  subtle: {
    ...Platform.select({
      android: { elevation: 1 },
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.12,
        shadowRadius: 2,
      },
      default: {},
    }),
  },

  // Low - for standard interactive cards
  low: {
    ...Platform.select({
      android: { elevation: 2 },
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.16,
        shadowRadius: 4,
      },
      default: {},
    }),
  },

  // Medium - for dropdowns, popovers, floating bars
  medium: {
    ...Platform.select({
      android: { elevation: 4 },
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.22,
        shadowRadius: 8,
      },
      default: {},
    }),
  },

  // High - for modals, bottom sheets, emergency alerts
  high: {
    ...Platform.select({
      android: { elevation: 8 },
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.32,
        shadowRadius: 16,
      },
      default: {},
    }),
  },
};

export type ElevationLevel = keyof typeof Elevation;
