/**
 * PrimaryButton — full-width CTA ("Break it down"). Spec §2b.
 * Height 52, radius lg, accent bg; disabled => accentMuted + tertiary label.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, radii, space, type } from '../theme/tokens';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
};

export function PrimaryButton({ label, onPress, disabled, accessibilityLabel }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.base,
        disabled
          ? styles.disabled
          : pressed
            ? styles.pressed
            : styles.enabled,
      ]}
    >
      <View>
        <Text
          style={[styles.label, disabled && styles.labelDisabled]}
          maxFontSizeMultiplier={1.6}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52, // ≥ 44pt touch target (§5d)
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[5],
  },
  enabled: { backgroundColor: color.accent },
  pressed: { backgroundColor: color.accentPressed, opacity: 0.85 },
  disabled: { backgroundColor: color.accentMuted },
  label: {
    ...type.body,
    fontWeight: '600',
    color: color.onAccent,
  },
  labelDisabled: { color: color.textTertiary },
});

export default PrimaryButton;
