/**
 * HydrationProfileModal — the one place the user sets the inputs that personalize
 * their water target (body mass, age, sex, wake/sleep hours, units). Shown once the
 * first time Hydration is opened (firstRun), and re-openable any time via "Edit
 * profile" on the screen. Pre-filled with sensible defaults so it reads as
 * "confirm & adjust", not a blank form. A footnote states it's hydration-only and
 * on-device — nothing here leaves the phone.
 */
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { HydrationProfile, Sex, Units } from '../features/hydration/types';
import { color, radii, space, type } from '../theme/tokens';

type Props = {
  visible: boolean;
  /** true → first open (secondary button reads "Skip"); false → editing (reads "Cancel"). */
  firstRun: boolean;
  /** Current values to seed the form with. */
  initial: HydrationProfile;
  /** Persist the edited fields (the screen also marks the profile complete). */
  onSave: (patch: Partial<HydrationProfile>) => void;
  /** Close without saving field edits (Skip / Cancel). */
  onDismiss: () => void;
};

const MASS_MIN = 30;
const MASS_MAX = 250;

export function HydrationProfileModal({ visible, firstRun, initial, onSave, onDismiss }: Props) {
  const [massKg, setMassKg] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<Sex | undefined>(undefined);
  const [wakeHour, setWakeHour] = useState('');
  const [bedHour, setBedHour] = useState('');
  const [units, setUnits] = useState<Units>('ml');

  // Seed from current profile each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setMassKg(String(initial.bodyMassKg));
    setAge(initial.ageYears ? String(initial.ageYears) : '');
    setSex(initial.sex);
    setWakeHour(String(initial.wakeHour));
    setBedHour(String(initial.bedHour));
    setUnits(initial.units);
  }, [visible, initial]);

  const mass = parseFloat(massKg);
  const massValid = !isNaN(mass) && mass >= MASS_MIN && mass <= MASS_MAX;

  const clampHour = (t: string, fallback: number) => {
    const n = parseInt(t, 10);
    return !isNaN(n) && n >= 0 && n <= 23 ? n : fallback;
  };

  const save = () => {
    if (!massValid) return;
    const ageNum = age ? parseInt(age, 10) : undefined;
    onSave({
      bodyMassKg: Math.round(mass),
      ageYears: ageNum && !isNaN(ageNum) && ageNum > 0 ? ageNum : undefined,
      sex,
      wakeHour: clampHour(wakeHour, initial.wakeHour),
      bedHour: clampHour(bedHour, initial.bedHour),
      units,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.title} accessibilityRole="header">
                {firstRun ? 'Personalize hydration' : 'Edit hydration profile'}
              </Text>
              <Text style={styles.intro} maxFontSizeMultiplier={1.4}>
                A few details tune your daily water target.
              </Text>

              <Field label="Body mass" unit="kg">
                <TextInput
                  style={styles.input}
                  value={massKg}
                  onChangeText={setMassKg}
                  keyboardType="decimal-pad"
                  placeholder="70"
                  placeholderTextColor={color.textTertiary}
                  maxLength={3}
                />
              </Field>

              <Field label="Age" sub="optional">
                <TextInput
                  style={styles.input}
                  value={age}
                  onChangeText={setAge}
                  keyboardType="number-pad"
                  placeholder="—"
                  placeholderTextColor={color.textTertiary}
                  maxLength={3}
                />
              </Field>

              <Field label="Sex" sub="optional">
                <View style={styles.group}>
                  <Choice label="M" active={sex === 'male'} onPress={() => setSex(sex === 'male' ? undefined : 'male')} />
                  <Choice label="F" active={sex === 'female'} onPress={() => setSex(sex === 'female' ? undefined : 'female')} />
                </View>
              </Field>

              <Field label="Wake" clock>
                <TextInput
                  style={styles.input}
                  value={wakeHour}
                  onChangeText={setWakeHour}
                  keyboardType="number-pad"
                  placeholder="7"
                  placeholderTextColor={color.textTertiary}
                  maxLength={2}
                />
              </Field>

              <Field label="Sleep" clock>
                <TextInput
                  style={styles.input}
                  value={bedHour}
                  onChangeText={setBedHour}
                  keyboardType="number-pad"
                  placeholder="23"
                  placeholderTextColor={color.textTertiary}
                  maxLength={2}
                />
              </Field>

              <Field label="Units">
                <View style={styles.group}>
                  <Choice label="mL" active={units === 'ml'} onPress={() => setUnits('ml')} />
                  <Choice label="oz" active={units === 'oz'} onPress={() => setUnits('oz')} />
                </View>
              </Field>

              <Text style={styles.footnote} maxFontSizeMultiplier={1.4}>
                Used only to personalize your hydration target. Stays on your device — nothing is sent anywhere.
              </Text>

              <View style={styles.actions}>
                <Pressable
                  onPress={onDismiss}
                  accessibilityRole="button"
                  accessibilityLabel={firstRun ? 'Skip' : 'Cancel'}
                  hitSlop={8}
                  style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
                >
                  <Text style={styles.dismissLabel}>{firstRun ? 'Skip' : 'Cancel'}</Text>
                </Pressable>
                <Pressable
                  onPress={save}
                  disabled={!massValid}
                  accessibilityRole="button"
                  accessibilityLabel="Save"
                  accessibilityState={{ disabled: !massValid }}
                  hitSlop={8}
                  style={({ pressed }) => [styles.action, massValid && pressed && styles.actionPressed]}
                >
                  <Text style={[styles.saveLabel, !massValid && styles.saveLabelDisabled]}>Save</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  label, sub, unit, clock, children,
}: {
  label: string;
  sub?: string;
  unit?: string;
  clock?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLabel}>
        <Text style={type.body} maxFontSizeMultiplier={1.3}>{label}</Text>
        {sub && <Text style={styles.rowSub} maxFontSizeMultiplier={1.2}>{sub}</Text>}
      </View>
      <View style={styles.rowControl}>
        {children}
        {/* ":00" renders the hour as a clock time (e.g. "7" → "7:00"). */}
        {clock && <Text style={styles.clock} maxFontSizeMultiplier={1.2}>:00</Text>}
        {unit && <Text style={styles.unit} maxFontSizeMultiplier={1.2}>{unit}</Text>}
      </View>
    </View>
  );
}

function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.choice, active && styles.choiceActive, pressed && styles.choicePressed]}
    >
      <Text
        style={[type.caption, { color: active ? color.onAccent : color.textPrimary }]}
        maxFontSizeMultiplier={1.2}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(44,50,46,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[6],
  },
  card: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '86%',
    backgroundColor: color.surface,
    borderRadius: radii.xl,
    padding: space[5],
  },
  title: { ...type.h2, color: color.textPrimary },
  intro: { ...type.caption, color: color.textSecondary, marginTop: space[1], marginBottom: space[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space[3],
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    gap: space[3],
  },
  rowLabel: { flex: 1 },
  rowSub: { ...type.caption, color: color.textTertiary },
  rowControl: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  input: {
    width: 72,
    height: 36,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radii.sm,
    paddingHorizontal: space[2],
    paddingVertical: 0,
    color: color.textPrimary,
    textAlign: 'center',
    // Android vertical centering (no lineHeight spread — it clips glyphs).
    textAlignVertical: 'center',
    includeFontPadding: false,
    fontSize: type.body.fontSize,
    fontWeight: type.body.fontWeight,
  },
  // height + lineHeight matched to the 36px input, with Android font padding off, so
  // the unit label ("kg") / clock suffix (":00") centers against the number beside it.
  clock: {
    ...type.body,
    color: color.textSecondary,
    marginLeft: -space[1],
    height: 36,
    lineHeight: 36,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  unit: {
    ...type.body,
    color: color.textSecondary,
    minWidth: 24,
    height: 36,
    lineHeight: 36,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  group: { flexDirection: 'row', gap: space[1] },
  choice: {
    width: 40,
    height: 36,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radii.sm,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: color.surface,
  },
  choiceActive: { backgroundColor: color.accent, borderColor: color.accent },
  choicePressed: { opacity: 0.7 },
  footnote: { ...type.caption, color: color.textTertiary, marginTop: space[4], lineHeight: 18 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: space[5], gap: space[5] },
  action: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[2] },
  actionPressed: { opacity: 0.6 },
  dismissLabel: { ...type.body, fontWeight: '600' as const, color: color.textSecondary },
  saveLabel: { ...type.body, fontWeight: '600' as const, color: color.accent },
  saveLabelDisabled: { color: color.textTertiary },
});

export default HydrationProfileModal;
