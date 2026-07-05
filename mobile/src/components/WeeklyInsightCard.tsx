/**
 * WeeklyInsightCard — the Monday "last week" summary on the Overwhelm Manager home
 * screen. Presentational only; overwhelmInsights.ts does the actual math.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { WeeklyInsight } from '../features/overwhelm/overwhelmInsights';
import { color, radii, space, type } from '../theme/tokens';

export function WeeklyInsightCard({ insight }: { insight: WeeklyInsight }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">Last week</Text>
      <Row emoji="✅" text={`You broke down ${insight.tasksBrokenDown} task${insight.tasksBrokenDown === 1 ? '' : 's'}`} />
      {insight.mostProductiveDay && (
        <Row emoji="🔥" text={`Most productive on ${insight.mostProductiveDay}`} />
      )}
      {insight.topCategory && (
        <Row emoji="📂" text={`Most tasks were ${insight.topCategory} related`} />
      )}
      <Row emoji="⚡" text={`Average ${insight.avgSteps} steps per task`} />
      <Row emoji="💪" text={`You completed ${insight.completionPct}% of all steps`} />
    </View>
  );
}

function Row({ emoji, text }: { emoji: string; text: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={styles.rowText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surfaceAlt,
    borderRadius: radii.lg,
    padding: space[4],
    gap: space[2],
  },
  title: { ...type.captionStrong, color: color.accent, marginBottom: space[1] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  emoji: { fontSize: 15 },
  rowText: { ...type.subtext, color: color.textPrimary, flex: 1 },
});

export default WeeklyInsightCard;
