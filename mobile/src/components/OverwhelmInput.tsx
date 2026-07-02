/**
 * OverwhelmInput — multiline text box. Spec §2a / §5a.
 * - Auto-grows from ~3 lines (min height 96); scrolls internally beyond ~6.
 * - returnKeyType "default" and blurOnSubmit false → Return inserts a newline,
 *   it does NOT submit (multiline; submit only via the CTA).
 * - maxLength 500.
 */
import React, { useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';

import { color, elevation, radii, space, type } from '../theme/tokens';

type Props = {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  editable?: boolean;
};

const MAX_LENGTH = 500;

export function OverwhelmInput({ value, onChangeText, placeholder, editable = true }: Props) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={color.textTertiary}
      editable={editable}
      multiline
      // Return inserts a newline — never submits (§5a).
      returnKeyType="default"
      blurOnSubmit={false}
      maxLength={MAX_LENGTH}
      textAlignVertical="top"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      maxFontSizeMultiplier={1.8}
      accessibilityLabel="Describe what's overwhelming you"
      accessibilityHint="Type the situation you want broken into steps"
      style={[styles.input, focused && styles.focused]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 96, // ~3 lines
    maxHeight: 168, // ~6 lines, then scrolls internally
    backgroundColor: color.surface,
    borderColor: color.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: space[4],
    ...type.body,
    color: color.textPrimary,
  },
  focused: {
    borderColor: color.accent,
    ...elevation.e1,
  },
});

export default OverwhelmInput;
