import React from 'react';
import { StyleProp, Text, TextStyle } from 'react-native';

import { useRocketTheme } from '@/design-system';

export interface RocketSearchHighlightTextProps {
  text: string;
  query: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  highlightColor?: string;
  highlightBackground?: string;
}

/**
 * Text component that highlights occurrences of a search query case-insensitively,
 * preserving original casing and parent typography.
 */
export function RocketSearchHighlightText({
  text,
  query,
  style,
  numberOfLines,
  highlightColor,
  highlightBackground,
}: RocketSearchHighlightTextProps) {
  const { colors } = useRocketTheme();

  const trimmed = query.trim();
  if (!trimmed || !text) {
    return (
      <Text numberOfLines={numberOfLines} style={style}>
        {text}
      </Text>
    );
  }

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));

  const resolvedHighlightColor = highlightColor || colors.primaryAccent;
  const resolvedHighlightBackground =
    highlightBackground ||
    (colors.primaryAccent ? `${colors.primaryAccent}44` : 'rgba(0, 240, 255, 0.28)');

  return (
    <Text numberOfLines={numberOfLines} style={style}>
      {parts.map((part, index) => {
        const isMatch = part.toLowerCase() === trimmed.toLowerCase();
        if (isMatch) {
          return (
            <Text
              key={index}
              style={{
                backgroundColor: resolvedHighlightBackground,
                color: resolvedHighlightColor,
                fontWeight: '700',
              }}>
              {part}
            </Text>
          );
        }
        return <React.Fragment key={index}>{part}</React.Fragment>;
      })}
    </Text>
  );
}
