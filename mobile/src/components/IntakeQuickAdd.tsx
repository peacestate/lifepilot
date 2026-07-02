/**
 * IntakeQuickAdd — one-tap logging (design spec §1): Glass / Bottle / Custom.
 * Calm pill buttons; whole row is generously tappable (≥44pt).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, radii, space, type } from '../theme/tokens';

type Props = {
  servingMl: number;          // "Glass" amount from the contract (default 250)
  formatMl: (ml: number) => string;
  onAdd: (ml: number) => void;
  onCustom: () => void;
};

export function IntakeQuickAdd({ servingMl, formatMl, onAdd, onCustom }: Props) {
  const glass = servingMl;
  const bottle = servingMl * 2;
  return (
    <View style={styles.row}>
      <Pill label="Glass" sub={formatMl(glass)} onPress={() => onAdd(glass)} />
      <Pill label="Bottle" sub={formatMl(bottle)} onPress={() => onAdd(bottle)} />
      <Pill label="Custom" sub="…" onPress={onCustom} />
    </View>
  );
}

function Pill({ label, sub, onPress }: { label: string; sub: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Add ${label}, ${sub}`}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
    >
      <Text style={styles.label} maxFontSizeMultiplier={1.4}>{label}</Text>
      <Text style={styles.sub} maxFontSizeMultiplier={1.4}>{sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space[3] },
  pill: {
    flex: 1, minHeight: 64, borderRadius: radii.lg, backgroundColor: color.surface,
    borderWidth: 1, borderColor: color.border, alignItems: 'center', justifyContent: 'center',
    paddingVertical: space[3],
  },
  pressed: { backgroundColor: color.surfaceAlt },
  label: { ...type.body, color: color.accent, fontWeight: '600' },
  sub: { ...type.caption, color: color.textTertiary, marginTop: 2 },
});

export default IntakeQuickAdd;
