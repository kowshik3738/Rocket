/**
 * Rocket Design System - Color Tokens
 *
 * Brand Identity: Rocket Orbit
 * Visual Style: Deep navy / near-black backgrounds, electric purple and electric blue accents,
 * controlled neon pink highlights, high contrast readable text.
 * Dark-first with complete light mode semantic mapping for future theme switching.
 */

export const RocketColorsDark = {
  // App & Backgrounds (Deep cosmic navy / near-black)
  background: '#080A11',
  backgroundElement: '#111625',
  backgroundSelected: '#1C2337',
  surface: '#111625',
  surfaceSecondary: '#182033',
  surfaceTertiary: '#232E47',
  surfaceElevated: '#1A2238',

  // Borders & Dividers
  border: '#1E283D',
  borderSubtle: '#151D2D',
  borderFocus: '#7052FF',
  divider: '#161D2C',

  // Brand Accents
  accent: '#7052FF', // Electric Purple / Violet (primary)
  primaryAccent: '#7052FF',
  primaryAccentPressed: '#5F40F5',
  primaryAccentSubtle: 'rgba(112, 82, 255, 0.16)',

  accentSecondary: '#38BDF8', // Electric Blue (orbit secondary)
  secondaryAccent: '#38BDF8',
  secondaryAccentPressed: '#0284C7',
  secondaryAccentSubtle: 'rgba(56, 189, 248, 0.16)',

  // Controlled Highlight (Cosmic Pink Spark)
  highlight: '#FF3E83',
  highlightPressed: '#E11D48',
  highlightSubtle: 'rgba(255, 62, 131, 0.16)',

  // Text & Typography
  text: '#F8FAFC',
  primaryText: '#F8FAFC',
  textSecondary: '#94A3B8',
  secondaryText: '#94A3B8',
  textMuted: '#64748B',
  mutedText: '#64748B',
  textInverse: '#080A11',

  // Functional / Status
  success: '#10B981', // Orbit green
  online: '#10B981',
  successSubtle: 'rgba(16, 185, 129, 0.16)',

  warning: '#F59E0B', // Amber
  warningSubtle: 'rgba(245, 158, 11, 0.16)',

  error: '#EF4444', // Crimson emergency
  emergency: '#EF4444',
  errorSubtle: 'rgba(239, 68, 68, 0.16)',
  emergencySubtle: 'rgba(239, 68, 68, 0.22)',

  // Overlays & Backdrops
  overlay: 'rgba(4, 6, 12, 0.78)',
  scrim: 'rgba(0, 0, 0, 0.65)',

  // Glows (Subtle, important states only)
  glowPrimary: 'rgba(112, 82, 255, 0.35)',
  glowSecondary: 'rgba(56, 189, 248, 0.35)',
  glowHighlight: 'rgba(255, 62, 131, 0.35)',
  glowEmergency: 'rgba(239, 68, 68, 0.45)',
} as const;

export const RocketColorsLight = {
  // App & Backgrounds (Clean modern high-contrast)
  background: '#F8FAFC',
  backgroundElement: '#FFFFFF',
  backgroundSelected: '#EDE9FE',
  surface: '#FFFFFF',
  surfaceSecondary: '#F1F5F9',
  surfaceTertiary: '#E2E8F0',
  surfaceElevated: '#FFFFFF',

  // Borders & Dividers
  border: '#E2E8F0',
  borderSubtle: '#F1F5F9',
  borderFocus: '#6344EE',
  divider: '#E2E8F0',

  // Brand Accents
  accent: '#6344EE',
  primaryAccent: '#6344EE',
  primaryAccentPressed: '#5132DC',
  primaryAccentSubtle: 'rgba(99, 68, 238, 0.12)',

  accentSecondary: '#0284C7',
  secondaryAccent: '#0284C7',
  secondaryAccentPressed: '#0369A1',
  secondaryAccentSubtle: 'rgba(2, 132, 199, 0.12)',

  // Controlled Highlight
  highlight: '#E11D48',
  highlightPressed: '#BE123C',
  highlightSubtle: 'rgba(225, 29, 72, 0.12)',

  // Text & Typography
  text: '#0F172A',
  primaryText: '#0F172A',
  textSecondary: '#475569',
  secondaryText: '#475569',
  textMuted: '#94A3B8',
  mutedText: '#94A3B8',
  textInverse: '#F8FAFC',

  // Functional / Status
  success: '#059669',
  online: '#059669',
  successSubtle: 'rgba(5, 150, 105, 0.12)',

  warning: '#D97706',
  warningSubtle: 'rgba(217, 119, 6, 0.12)',

  error: '#DC2626',
  emergency: '#DC2626',
  errorSubtle: 'rgba(220, 38, 38, 0.12)',
  emergencySubtle: 'rgba(220, 38, 38, 0.18)',

  // Overlays & Backdrops
  overlay: 'rgba(15, 23, 42, 0.45)',
  scrim: 'rgba(15, 23, 42, 0.6)',

  // Glows
  glowPrimary: 'rgba(99, 68, 238, 0.25)',
  glowSecondary: 'rgba(2, 132, 199, 0.25)',
  glowHighlight: 'rgba(225, 29, 72, 0.25)',
  glowEmergency: 'rgba(220, 38, 38, 0.35)',
} as const;

export type RocketColorTokens = {
  [K in keyof typeof RocketColorsDark]: string;
};
export type RocketColorKey = keyof typeof RocketColorsDark;

