/**
 * TaskSummary — two variants (spec §2c):
 *  - variant="chip"    (Loading/Error): "You asked:" + 1-line truncated task.
 *  - variant="summary" (Results): the task as H2, full text, no truncation.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { color, radii, space, type } from '../theme/tokens';

type Props = {
  text: string;
  variant: 'chip' | 'summary';
};

export function TaskSummary({ text, variant }: Props) {
  if (variant === 'summary') {
    return (
      <View style={styles.summaryWrap}>
        <Text style={styles.summary} maxFontSizeMultiplier={1.6}>
          {text}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.chip} accessible accessibilityLabel={`You asked: ${text}`}>
      <Text style={styles.chipLabel} maxFontSizeMultiplier={1.6}>
        You asked:
      </Text>
      <Text style={styles.chipText} numberOfLines={1} maxFontSizeMultiplier={1.6}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: color.surfaceAlt,
    borderRadius: radii.md,
    padding: space[3],
  },
  chipLabel: {
    ...type.caption,
    color: color.textSecondary,
    marginBottom: space[1],
  },
  chipText: {
    ...type.subtext,
    color: color.textPrimary,
  },
  summaryWrap: {
    marginBottom: space[3],
  },
  summary: {
    ...type.h2,
    color: color.textPrimary,
  },
});

export default TaskSummary;
