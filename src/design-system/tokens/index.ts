export * from './colors';
export * from './spacing';
export * from './radius';
export * from './typography';
export * from './elevation';
export * from './animation';

import { RocketColorsDark, RocketColorsLight } from './colors';
import { Spacing, SpacingScale } from './spacing';
import { Radius } from './radius';
import { Typography } from './typography';
import { Elevation } from './elevation';
import {
  AnimationDurations,
  AnimationSprings,
  AnimationScales,
  AnimationOpacities,
} from './animation';

export const tokens = {
  colors: {
    dark: RocketColorsDark,
    light: RocketColorsLight,
  },
  spacing: Spacing,
  spacingScale: SpacingScale,
  radius: Radius,
  typography: Typography,
  elevation: Elevation,
  animation: {
    durations: AnimationDurations,
    springs: AnimationSprings,
    scales: AnimationScales,
    opacities: AnimationOpacities,
  },
} as const;

export type RocketTokens = typeof tokens;
