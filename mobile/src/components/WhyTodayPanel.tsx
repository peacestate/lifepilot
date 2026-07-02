/**
 * WhyTodayPanel — collapsible "why today's goal" breakdown (design spec §2).
 * Words-first, readings as quiet support; the items sum to the target (contract §4),
 * so the panel always adds up. Non-alarmist. Tap the header to expand/collapse.
 */
import React, { useState } from 'react';
import { LayoutAnimation, Platform, Pressable, StyleSheet, Text, UIManager, View } from 'react-native';

import type { BreakdownItem } from '../features/hydration/types';
import { color, radii, space, type } from '../theme/tokens';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Props = {
  headline: string;            // e.g. "Hot and hazy — aim a little higher."
  breakdown: BreakdownItem[];
  formatMl: (ml: number) => string;
};

export function WhyTodayPanel({ headline, breakdown, formatMl }: Props) {
  const [open, setOpen] = useState(false);
  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((o) => !o);
  };

  return (
    <View style={styles.card}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Why today's goal: ${headline}`}
        style={styles.header}
      >
        <Text style={styles.headline} maxFontSizeMultiplier={1.6}>{headline}</Text>
        <Text style={styles.chev}>{open ? '⌃' : '⌄'}</Text>
      </Pressable>

      {open && (
        <View style={styles.body}>
          {breakdown.map((b, i) => {
            const sign = b.amountMl < 0 ? '−' : '+';
            const isBase = b.key === 'baseline';
            return (
              <View key={b.key} style={[styles.row, i > 0 && styles.rowBorder]}>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel} maxFontSizeMultiplier={1.6}>{b.label}</Text>
                  <Text style={styles.rowWhy} maxFontSizeMultiplier={1.6}>{b.why}</Text>
                </View>
                <Text style={[styles.amount, isBase && styles.amountBase]} maxFontSizeMultiplier={1.4}>
                  {isBase ? '' : sign}{formatMl(Math.abs(b.amountMl))}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface, borderRadius: radii.lg, borderWidth: 1,
    borderColor: color.border, overflow: 'hidden',
  },
  header: { flexDirection: 'row', alignItems: 'center', padding: space[4], gap: space[3] },
  headline: { ...type.subtext, color: color.textPrimary, flex: 1 },
  chev: { ...type.h2, color: color.textTertiary },
  body: { paddingHorizontal: space[4], paddingBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space[3], gap: space[3] },
  rowBorder: { borderTopWidth: 1, borderTopColor: color.border },
  rowText: { flex: 1 },
  rowLabel: { ...type.body, color: color.textPrimary },
  rowWhy: { ...type.caption, color: color.textSecondary, marginTop: 1 },
  amount: { ...type.body, color: color.textSecondary },
  amountBase: { color: color.textPrimary, fontWeight: '600' },
});

export default WhyTodayPanel;
