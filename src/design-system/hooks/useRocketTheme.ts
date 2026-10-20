import { useColorScheme } from '@/hooks/use-color-scheme';
import { RocketColorsDark, RocketColorsLight, RocketColorTokens } from '../tokens/colors';
import { SpacingScale } from '../tokens/spacing';
import { Radius } from '../tokens/radius';
import { Typography } from '../tokens/typography';
import { Elevation } from '../tokens/elevation';
import { AnimationDurations, AnimationSprings, AnimationScales } from '../tokens/animation';
import { useReducedMotion } from './useReducedMotion';

export interface RocketTheme {
  isDark: boolean;
  colors: RocketColorTokens;
  spacing: typeof SpacingScale;
  radius: typeof Radius;
  typography: typeof Typography;
  elevation: typeof Elevation;
  animation: {
    durations: typeof AnimationDurations;
    springs: typeof AnimationSprings;
    scales: typeof AnimationScales;
  };
  reducedMotion: boolean;
}

/**
 * Hook providing access to Rocket design system tokens.
 * Defaults to Dark theme per brand direction (Rocket Orbit).
 */
export function useRocketTheme(): RocketTheme {
  const scheme = useColorScheme();
  const isDark = scheme !== 'light'; // Dark-first
  const colors = isDark ? RocketColorsDark : RocketColorsLight;
  const reducedMotion = useReducedMotion();

  return {
    isDark,
    colors,
    spacing: SpacingScale,
    radius: Radius,
    typography: Typography,
    elevation: Elevation,
    animation: {
      durations: AnimationDurations,
      springs: AnimationSprings,
      scales: AnimationScales,
    },
    reducedMotion,
  };
}
