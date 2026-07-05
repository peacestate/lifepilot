/**
 * ManualEnergyEntryForm — the Energy Predictor's fallback: 3 inputs only ("what time did
 * you sleep? what time did you wake up? roughly how many steps today?"), a Submit button,
 * nothing else. Shown when Health Connect has no data, or when the user opts to log a day
 * manually. Feeds the exact same model input Health Connect would (see manualDayEntry.ts).
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { color, radii, space, type } from '../theme/tokens';
import { PrimaryButton } from './PrimaryButton';

type Props = {
  onSubmit: (sleepTimeH: number, wakeTimeH: number, steps: number) => void;
  title: string;
  sleepLabel: string;
  wakeLabel: string;
  stepsLabel: string;
  submitLabel: string;
  /** Level 4 of the degradation chain — lets the user get a generic forecast without typing. */
  onSkip?: () => void;
  skipLabel?: string;
};

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function parseTime(v: string): number | null {
  const m = TIME_RE.exec(v.trim());
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}

export function ManualEnergyEntryForm({
  onSubmit, title, sleepLabel, wakeLabel, stepsLabel, submitLabel, onSkip, skipLabel,
}: Props) {
  const [sleepText, setSleepText] = useState('');
  const [wakeText, setWakeText] = useState('');
  const [stepsText, setStepsText] = useState('');

  const sleepH = parseTime(sleepText);
  const wakeH = parseTime(wakeText);
  const steps = Number(stepsText);
  const validSteps = stepsText.trim().length > 0 && Number.isFinite(steps) && steps >= 0;
  const canSubmit = sleepH != null && wakeH != null && validSteps;

  return (
    <View style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">{title}</Text>

      <Field label={sleepLabel} value={sleepText} onChangeText={setSleepText} placeholder="23:00" />
      <Field label={wakeLabel} value={wakeText} onChangeText={setWakeText} placeholder="07:00" />
      <Field
        label={stepsLabel}
        value={stepsText}
        onChangeText={setStepsText}
        placeholder="6000"
        keyboardType="numeric"
      />

      <View style={styles.submitGap}>
        <PrimaryButton
          label={submitLabel}
          disabled={!canSubmit}
          onPress={() => canSubmit && onSubmit(sleepH!, wakeH!, steps)}
        />
      </View>

      {onSkip && (
        <Pressable onPress={onSkip} hitSlop={8} style={styles.skipLink} accessibilityRole="button">
          <Text style={styles.skipLinkText}>{skipLabel ?? 'Skip for now'}</Text>
        </Pressable>
      )}
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  keyboardType?: 'numeric';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={color.textTertiary}
        keyboardType={keyboardType}
        maxLength={5}
        maxFontSizeMultiplier={1.6}
        accessibilityLabel={label}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface, borderRadius: radii.xl, borderWidth: 1,
    borderColor: color.border, padding: space[5],
  },
  title: { ...type.h2, color: color.textPrimary },
  field: { marginTop: space[4] },
  fieldLabel: { ...type.caption, color: color.textSecondary, marginBottom: space[1] },
  input: {
    minHeight: 44, borderWidth: 1, borderColor: color.border, borderRadius: radii.md,
    paddingHorizontal: space[4], ...type.body, color: color.textPrimary,
  },
  submitGap: { marginTop: space[5] },
  skipLink: { alignSelf: 'center', marginTop: space[4], minHeight: 32, justifyContent: 'center' },
  skipLinkText: { ...type.caption, color: color.textSecondary, textDecorationLine: 'underline' as const },
});

export default ManualEnergyEntryForm;
