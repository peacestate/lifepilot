/**
 * StepItem — one row: number badge · step text · checkbox. Spec §2e.
 * The ENTIRE row toggles (bigger target). Checked => strikethrough + dim text
 * (animated 150ms via layout color change). Row min height 56.
 *
 * Numbering is presentation-only (UI owns it) — `number` comes from the list
 * index, never from the model (spec §5g, contract §4).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, space, type } from '../theme/tokens';
import { StepCheckbox } from './StepCheckbox';

type Props = {
  number: number;
  text: string;
  checked: boolean;
  onToggle: () => void;
  /** 'step' = top-level numbered row; 'sub' = indented sub-step with a dot. */
  variant?: 'step' | 'sub';
};

export function StepItem({
  number,
  text,
  checked,
  onToggle,
  variant = 'step',
}: Props) {
  const isSub = variant === 'sub';
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={
        isSub ? `Sub-step: ${text}` : `Step ${number}: ${text}`
      }
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => [
        styles.row,
        isSub && styles.rowSub,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.badge, isSub && styles.badgeSub]} maxFontSizeMultiplier={1.6}>
        {isSub ? '•' : number}
      </Text>
      <View style={styles.textWrap}>
        <Text
          style={[styles.text, isSub && styles.textSub, checked && styles.textChecked]}
          maxFontSizeMultiplier={1.8}
        >
          {text}
        </Text>
      </View>
      <StepCheckbox checked={checked} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    gap: space[3],
  },
  rowSub: {
    paddingLeft: space[7], // indent sub-steps under their parent
    minHeight: 48,
    backgroundColor: color.surfaceAlt,
  },
  pressed: { backgroundColor: color.surfaceAlt },
  badge: {
    ...type.captionStrong,
    color: color.textTertiary,
    width: 24,
    textAlign: 'center',
  },
  badgeSub: { ...type.body, color: color.accent },
  textWrap: { flex: 1 },
  text: {
    ...type.body,
    color: color.textPrimary,
  },
  textSub: { ...type.subtext, color: color.textSecondary },
  textChecked: {
    color: color.textTertiary,
    textDecorationLine: 'line-through',
  },
});

export default StepItem;
