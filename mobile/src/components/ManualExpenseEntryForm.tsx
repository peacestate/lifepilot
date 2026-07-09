/**
 * ManualExpenseEntryForm — the Expense Scanner's fallback for receipts that won't scan
 * (crumpled paper, bad lighting, handwritten). 4 fields only: merchant, amount, category,
 * date (defaults to today). Saves through the exact same ExpenseRecord shape as a scanned
 * receipt — the user never notices the difference in reports.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { CODE_TO_SYMBOL, ISO_CODE_SET } from '../features/expense/currencies';
import { color, radii, space, type } from '../theme/tokens';
import { PrimaryButton } from './PrimaryButton';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidIsoDate(v: string): boolean {
  const m = DATE_RE.exec(v.trim());
  if (!m) return false;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  return date.getFullYear() === Number(y) && date.getMonth() === Number(mo) - 1 && date.getDate() === Number(d);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export type ManualExpenseEntry = { merchant: string; amount: number; category: string; dateISO: string; currency: string };

/** Quick-pick currencies; any other active ISO 4217 code goes through the "Other" input. */
const QUICK_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'] as const;

const currencyChipLabel = (code: string) => {
  const sym = CODE_TO_SYMBOL[code];
  return sym && sym !== code ? `${sym} ${code}` : code;
};

type Props = {
  categories: readonly string[];
  onSubmit: (entry: ManualExpenseEntry) => void;
  title: string;
  merchantLabel: string;
  amountLabel: string;
  categoryLabel: string;
  currencyLabel: string;
  dateLabel: string;
  submitLabel: string;
  /** Preselected currency (e.g. the most recently saved record's). */
  defaultCurrency?: string;
};

export function ManualExpenseEntryForm({
  categories,
  onSubmit,
  title,
  merchantLabel,
  amountLabel,
  categoryLabel,
  currencyLabel,
  dateLabel,
  submitLabel,
  defaultCurrency = 'USD',
}: Props) {
  const initialCurrency = ISO_CODE_SET.has(defaultCurrency) ? defaultCurrency : 'USD';
  const [merchant, setMerchant] = useState('');
  const [amountText, setAmountText] = useState('');
  const [category, setCategory] = useState(categories[categories.length - 1] ?? 'Other');
  const [dateISO, setDateISO] = useState(todayIso());
  const [currencyText, setCurrencyText] = useState(initialCurrency);
  const [showOtherCurrency, setShowOtherCurrency] = useState(
    !(QUICK_CURRENCIES as readonly string[]).includes(initialCurrency),
  );

  const currency = currencyText.trim().toUpperCase();
  const validCurrency = ISO_CODE_SET.has(currency);
  const amount = Number(amountText);
  const validAmount = amountText.trim().length > 0 && Number.isFinite(amount) && amount > 0;
  const validMerchant = merchant.trim().length > 0;
  const validDate = isValidIsoDate(dateISO);
  const canSubmit = validAmount && validMerchant && validDate && validCurrency;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({ merchant: merchant.trim(), amount, category, dateISO, currency });
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">{title}</Text>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{merchantLabel}</Text>
        <TextInput
          value={merchant}
          onChangeText={setMerchant}
          placeholder="Merchant name"
          placeholderTextColor={color.textTertiary}
          maxFontSizeMultiplier={1.6}
          accessibilityLabel={merchantLabel}
          style={styles.input}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{amountLabel}</Text>
        <TextInput
          value={amountText}
          onChangeText={setAmountText}
          placeholder="0.00"
          placeholderTextColor={color.textTertiary}
          keyboardType="decimal-pad"
          maxFontSizeMultiplier={1.6}
          accessibilityLabel={amountLabel}
          style={styles.input}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{categoryLabel}</Text>
        <View style={styles.chips}>
          {categories.map((c) => (
            <Pressable
              key={c}
              onPress={() => setCategory(c)}
              accessibilityRole="button"
              accessibilityState={{ selected: category === c }}
              style={[styles.chip, category === c && styles.chipOn]}
            >
              <Text style={[styles.chipText, category === c && styles.chipTextOn]}>{c}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{currencyLabel}</Text>
        <View style={styles.chips}>
          {QUICK_CURRENCIES.map((c) => (
            <Pressable
              key={c}
              onPress={() => { setCurrencyText(c); setShowOtherCurrency(false); }}
              accessibilityRole="button"
              accessibilityState={{ selected: !showOtherCurrency && currency === c }}
              style={[styles.chip, !showOtherCurrency && currency === c && styles.chipOn]}
            >
              <Text style={[styles.chipText, !showOtherCurrency && currency === c && styles.chipTextOn]}>
                {currencyChipLabel(c)}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => { setShowOtherCurrency(true); setCurrencyText(''); }}
            accessibilityRole="button"
            accessibilityState={{ selected: showOtherCurrency }}
            style={[styles.chip, showOtherCurrency && styles.chipOn]}
          >
            <Text style={[styles.chipText, showOtherCurrency && styles.chipTextOn]}>Other</Text>
          </Pressable>
        </View>
        {showOtherCurrency && (
          <TextInput
            value={currencyText}
            onChangeText={setCurrencyText}
            placeholder="e.g. JPY"
            placeholderTextColor={color.textTertiary}
            autoCapitalize="characters"
            maxLength={3}
            maxFontSizeMultiplier={1.6}
            accessibilityLabel={currencyLabel}
            style={[styles.input, styles.currencyInput, !validCurrency && styles.inputInvalid]}
          />
        )}
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{dateLabel}</Text>
        <TextInput
          value={dateISO}
          onChangeText={setDateISO}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={color.textTertiary}
          maxFontSizeMultiplier={1.6}
          accessibilityLabel={dateLabel}
          style={[styles.input, !validDate && styles.inputInvalid]}
        />
      </View>

      <View style={styles.submitGap}>
        <PrimaryButton label={submitLabel} disabled={!canSubmit} onPress={submit} />
      </View>
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
  fieldLabel: { ...type.caption, color: color.textSecondary, marginBottom: space[2] },
  input: {
    minHeight: 44, borderWidth: 1, borderColor: color.border, borderRadius: radii.md,
    paddingHorizontal: space[4], ...type.body, color: color.textPrimary,
  },
  inputInvalid: { borderColor: color.accent },
  currencyInput: { marginTop: space[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { paddingHorizontal: space[4], paddingVertical: space[2], borderRadius: radii.pill, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface },
  chipOn: { backgroundColor: color.accent, borderColor: color.accent },
  chipText: { ...type.subtext, color: color.textSecondary },
  chipTextOn: { color: color.onAccent, fontWeight: '600' },
  submitGap: { marginTop: space[5] },
});

export default ManualExpenseEntryForm;
