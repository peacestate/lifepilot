/**
 * CustomAmountModal — lets the user type a specific intake amount instead of
 * the fixed Glass/Bottle servings. Replaces the earlier "Custom" stub that
 * silently logged a default serving on every tap with no visible feedback.
 */
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ozToMl } from '../features/hydration/HydrationEngine';
import { color, radii, space, type } from '../theme/tokens';

type Props = {
  visible: boolean;
  units: 'ml' | 'oz';
  onCancel: () => void;
  onConfirm: (ml: number) => void;
};

const MIN_ML = 1;
const MAX_ML = 5000;

export function CustomAmountModal({ visible, units, onCancel, onConfirm }: Props) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (visible) setText('');
  }, [visible]);

  const parsed = Number(text);
  const validAmount = text.trim().length > 0 && Number.isFinite(parsed) && parsed > 0;
  const ml = validAmount ? Math.round(units === 'oz' ? ozToMl(parsed) : parsed) : 0;
  const canConfirm = validAmount && ml >= MIN_ML && ml <= MAX_ML;

  const confirm = () => {
    if (!canConfirm) return;
    onConfirm(ml);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title} accessibilityRole="header">
            Add a custom amount
          </Text>
          <View style={styles.inputRow}>
            <TextInput
              value={text}
              onChangeText={setText}
              keyboardType="numeric"
              placeholder={units === 'oz' ? 'oz' : 'mL'}
              placeholderTextColor={color.textTertiary}
              autoFocus
              maxLength={5}
              maxFontSizeMultiplier={1.6}
              accessibilityLabel={`Amount in ${units === 'oz' ? 'ounces' : 'milliliters'}`}
              style={styles.input}
              onSubmitEditing={confirm}
              returnKeyType="done"
            />
            <Text style={styles.unit}>{units === 'oz' ? 'oz' : 'mL'}</Text>
          </View>

          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              hitSlop={8}
              style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
            >
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={confirm}
              disabled={!canConfirm}
              accessibilityRole="button"
              accessibilityLabel="Add"
              accessibilityState={{ disabled: !canConfirm }}
              hitSlop={8}
              style={({ pressed }) => [
                styles.action,
                canConfirm && pressed && styles.actionPressed,
              ]}
            >
              <Text style={[styles.addLabel, !canConfirm && styles.addLabelDisabled]}>Add</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(44,50,46,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[6],
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: color.surface,
    borderRadius: radii.xl,
    padding: space[5],
  },
  title: { ...type.h2, color: color.textPrimary },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space[4],
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radii.md,
    paddingHorizontal: space[4],
  },
  input: {
    flex: 1,
    ...type.body,
    color: color.textPrimary,
    paddingVertical: space[3],
  },
  unit: { ...type.body, color: color.textTertiary },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: space[5],
    gap: space[5],
  },
  action: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[2] },
  actionPressed: { opacity: 0.6 },
  cancelLabel: { ...type.body, fontWeight: '600' as const, color: color.textSecondary },
  addLabel: { ...type.body, fontWeight: '600' as const, color: color.accent },
  addLabelDisabled: { color: color.textTertiary },
});

export default CustomAmountModal;
