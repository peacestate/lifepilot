/**
 * StepList — card-with-dividers holding the numbered, checkable steps. Spec §2e.
 * One surface card, hairline dividers between rows. Numbering derived from index.
 *
 * "Go deeper" feature: each step can be broken into sub-steps. When `breakdowns`
 * + `onBreakDown` are supplied (results state only), each row shows a quiet
 * "Break this into smaller steps" control; tapping it streams sub-steps in
 * underneath. Omit those props (e.g. while the main list is still streaming) and
 * the list behaves exactly as before.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Breakdowns, OverwhelmStep } from '../features/overwhelm/types';
import { color, elevation, radii, space, type } from '../theme/tokens';
import { StepItem } from './StepItem';

type BreakdownLabels = {
  cta: string;
  loading: string;
  empty: string;
  error: string;
};

type Props = {
  steps: OverwhelmStep[];
  onToggle: (id: string) => void;
  breakdowns?: Breakdowns;
  onBreakDown?: (stepId: string, text: string) => void;
  labels?: BreakdownLabels;
};

export function StepList({
  steps,
  onToggle,
  breakdowns,
  onBreakDown,
  labels,
}: Props) {
  const canBreakDown = !!onBreakDown && !!labels;

  return (
    <View style={styles.card}>
      {steps.map((s, i) => {
        const bd = breakdowns?.[s.id];
        return (
          <View key={s.id}>
            {i > 0 && <View style={styles.divider} />}
            <StepItem
              number={i + 1}
              text={s.text}
              checked={s.done}
              onToggle={() => onToggle(s.id)}
            />

            {/* Streamed sub-steps */}
            {bd?.steps.map((sub) => (
              <View key={sub.id}>
                <View style={styles.subDivider} />
                <StepItem
                  variant="sub"
                  number={0}
                  text={sub.text}
                  checked={sub.done}
                  onToggle={() => onToggle(sub.id)}
                />
              </View>
            ))}

            {/* Per-step breakdown control / status (results state only) */}
            {canBreakDown && (
              <BreakdownControl
                status={bd?.status}
                checked={s.done}
                labels={labels!}
                onPress={() => onBreakDown!(s.id, s.text)}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

function BreakdownControl({
  status,
  checked,
  labels,
  onPress,
}: {
  status?: Breakdowns[string]['status'];
  checked: boolean;
  labels: BreakdownLabels;
  onPress: () => void;
}) {
  if (status === 'loading') {
    return (
      <Text style={styles.statusLine} accessibilityLiveRegion="polite">
        {labels.loading}
      </Text>
    );
  }
  if (status === 'empty') {
    return <Text style={styles.statusLine}>{labels.empty}</Text>;
  }
  // 'done' → offer a quiet re-split; 'error' → offer retry; 'idle'/undefined → cta.
  // Hide the prompt once a step is checked off (it's handled — no need to deepen).
  if (checked && status !== 'error') return null;

  const label = status === 'error' ? labels.error : labels.cta;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [styles.ctaRow, pressed && styles.ctaPressed]}
    >
      <Text style={styles.ctaText}>
        {status === 'done' ? '↻ ' : '⌄ '}
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: color.border,
    overflow: 'hidden',
    ...elevation.e1,
  },
  divider: {
    height: 1,
    backgroundColor: color.border,
  },
  subDivider: {
    height: 1,
    marginLeft: space[7],
    backgroundColor: color.border,
  },
  ctaRow: {
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    paddingLeft: space[7],
  },
  ctaPressed: { backgroundColor: color.surfaceAlt },
  ctaText: {
    ...type.caption,
    color: color.accent,
  },
  statusLine: {
    ...type.caption,
    color: color.textTertiary,
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    paddingLeft: space[7],
  },
});

export default StepList;
