import React, { useState } from 'react';
import {
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { useRocketTheme } from '../hooks/useRocketTheme';
import { Radius } from '../tokens/radius';
import { SpacingScale } from '../tokens/spacing';

export interface RocketInputProps extends TextInputProps {
  label?: string;
  error?: string;
  helper?: string;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

/**
 * Foundation Input Field for Rocket.
 * Clean, accessible text field with focus highlighting, helper text, and error states.
 */
export function RocketInput({
  label,
  error,
  helper,
  iconLeft,
  iconRight,
  containerStyle,
  inputStyle,
  multiline = false,
  onFocus,
  onBlur,
  placeholderTextColor,
  ...rest
}: RocketInputProps) {
  const { colors } = useRocketTheme();
  const [isFocused, setIsFocused] = useState(false);

  const handleFocus: TextInputProps['onFocus'] = (e) => {
    setIsFocused(true);
    onFocus?.(e);
  };

  const handleBlur: TextInputProps['onBlur'] = (e) => {
    setIsFocused(false);
    onBlur?.(e);
  };

  const resolvedBorderColor = (() => {
    if (error) return colors.error;
    if (isFocused) return colors.primaryAccent;
    return colors.border;
  })();

  return (
    <View style={[styles.wrapper, containerStyle]}>
      {label ? (
        <Text style={[styles.label, { color: colors.secondaryText }]}>
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: colors.surfaceSecondary,
            borderColor: resolvedBorderColor,
          },
          multiline && styles.multilineContainer,
        ]}>
        {iconLeft ? <View style={styles.iconLeftSlot}>{iconLeft}</View> : null}

        <TextInput
          accessibilityLabel={label}
          multiline={multiline}
          onBlur={handleBlur}
          onFocus={handleFocus}
          placeholderTextColor={placeholderTextColor || colors.secondaryText}
          style={[
            styles.input,
            { color: colors.primaryText },
            multiline && styles.multilineInput,
            inputStyle,
          ]}
          textAlignVertical={multiline ? 'top' : 'center'}
          {...rest}
        />

        {iconRight ? <View style={styles.iconRightSlot}>{iconRight}</View> : null}
      </View>

      {error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.feedbackText, { color: colors.error }]}>
          {error}
        </Text>
      ) : helper ? (
        <Text style={[styles.feedbackText, { color: colors.mutedText }]}>
          {helper}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 7,
    marginBottom: SpacingScale.lg,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  inputContainer: {
    minHeight: 54,
    borderRadius: Radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SpacingScale.lg,
  },
  multilineContainer: {
    minHeight: 110,
    alignItems: 'flex-start',
    paddingVertical: SpacingScale.md,
  },
  input: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    paddingVertical: 0,
  },
  multilineInput: {
    minHeight: 88,
  },
  iconLeftSlot: {
    marginRight: SpacingScale.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconRightSlot: {
    marginLeft: SpacingScale.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  feedbackText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    marginTop: 2,
  },
});
