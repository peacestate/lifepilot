/**
 * SecondaryButton — text button, no fill ("Start over", "Try again", "Edit").
 * Spec §2g. Accent label, weight 600, height 44.
 */
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { color, space, type } from '../theme/tokens';

type Props = {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
};

export function SecondaryButton({ label, onPress, accessibilityLabel }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={8}
      style={({ pressed }) => [styles.base, pressed && styles.pressed]}
    >
      <Text style={styles.label} maxFontSizeMultiplier={1.6}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space[2],
  },
  pressed: { opacity: 0.6 },
  label: {
    ...type.body,
    fontSize: 16,
    fontWeight: '600',
    color: color.accent,
  },
});

export default SecondaryButton;
