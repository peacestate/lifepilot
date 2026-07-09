/**
 * ExpenseScreen — feature #4. List of expenses + scan→review→save flow, all on-device.
 * Spec: design/expense/screen-spec.md. Extraction: docs/expense-model-contract.md.
 *
 * Capture/OCR is stubbed (ocrSource) until the native Vision/ML Kit module is wired;
 * extraction is the deterministic parser (ExpenseService), with the ExecuTorch models
 * layering in via the same ExpenseFields shape. NO network anywhere.
 */
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { PrivacyFootnote } from '../components/PrivacyFootnote';
import { ManualExpenseEntryForm } from '../components/ManualExpenseEntryForm';
import { moneyLabel, EXPENSE } from '../features/expense/ExpenseService';
import { CODE_TO_SYMBOL, ISO_CODE_SET } from '../features/expense/currencies';
import { CameraSheet } from '../features/expense/CameraSheet';
import { buildMonthlySummary } from '../features/expense/expenseInsights';
import { useExpenseScanner } from '../features/expense/useExpenseScanner';
import type { ExpenseFields } from '../features/expense/types';
import { color, layout, radii, space, type } from '../theme/tokens';
import { EXPENSE_COPY as C } from './expenseCopy';

/** Dominant currency across a set of records — for aggregate totals that would
 * otherwise hardcode "$" even when every receipt is in ₹. */
function mainCcy(records: ReadonlyArray<{ currency: string }>): string {
  const counts = new Map<string, number>();
  for (const r of records) counts.set(r.currency, (counts.get(r.currency) ?? 0) + 1);
  let best = records[0]?.currency ?? 'INR';
  let bestN = 0;
  for (const [c, n] of counts) if (n > bestN) { best = c; bestN = n; }
  return best;
}

export function ExpenseScreen() {
  const s = useExpenseScanner();
  const [showCamera, setShowCamera] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const openCamera = () => setShowCamera(true);
  const onCapture = (uri: string) => {
    setShowCamera(false);
    void s.scan(uri);
  };
  const onSubmitManual: React.ComponentProps<typeof ManualExpenseEntryForm>['onSubmit'] = (entry) => {
    setShowManual(false);
    s.saveManual(entry);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          {s.state === 'reading' ? (
            <View style={styles.center}><Text style={styles.dim} accessibilityLiveRegion="polite">{C.reading}</Text></View>
          ) : s.state === 'review' && s.fields ? (
            <ReviewBody fields={s.fields} onSave={s.save} onRetake={openCamera} defaultCurrency={s.records[0]?.currency} />
          ) : s.state === 'error' ? (
            <View style={styles.center}>
              <Text style={styles.dim}>{C.error}</Text>
              <View style={{ height: space[4] }} />
              <SecondaryButton label={C.retake} onPress={openCamera} />
            </View>
          ) : (
            <ListBody
              records={s.records}
              nudge={s.nudge}
              onDismissNudge={s.dismissNudge}
              onScan={openCamera}
              onUpload={s.scanFromFile}
              onManual={() => setShowManual(true)}
            />
          )}
        </View>
      </ScrollView>

      <CameraSheet
        visible={showCamera}
        onCapture={onCapture}
        onClose={() => setShowCamera(false)}
      />

      <Modal visible={showManual} animationType="slide" transparent onRequestClose={() => setShowManual(false)}>
        <View style={styles.manualBackdrop}>
          <View style={styles.manualSheet}>
            <ManualExpenseEntryForm
              categories={EXPENSE.CATEGORIES}
              onSubmit={onSubmitManual}
              title={C.manualTitle}
              merchantLabel={C.manualMerchant}
              amountLabel={C.manualAmount}
              categoryLabel={C.manualCategory}
              currencyLabel={C.manualCurrency}
              dateLabel={C.manualDate}
              submitLabel={C.manualSubmit}
              defaultCurrency={s.records[0]?.currency}
            />
            <View style={styles.manualCancelGap}>
              <SecondaryButton label="Cancel" onPress={() => setShowManual(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function NudgeBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <View style={styles.nudge}>
      <Text style={styles.nudgeText}>{message}</Text>
      <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8}>
        <Text style={styles.nudgeDismiss}>✕</Text>
      </Pressable>
    </View>
  );
}

function InsightsCard({ records }: { records: ReturnType<typeof useExpenseScanner>['records'] }) {
  const summary = useMemo(() => buildMonthlySummary(records), [records]);
  if (summary.totalThisMonth <= 0) return null;
  const top = summary.byCategory[0];
  const cur = mainCcy(records);
  const sym = CODE_TO_SYMBOL[cur];
  const money0 = (n: number) => (sym ? `${sym}${Math.round(n)}` : `${cur} ${Math.round(n)}`);
  const trend =
    summary.deltaPct == null ? null
      : summary.deltaVsLastMonth > 0 ? C.insightsUp(money0(summary.deltaVsLastMonth))
      : summary.deltaVsLastMonth < 0 ? C.insightsDown(money0(Math.abs(summary.deltaVsLastMonth)))
      : C.insightsFlat;

  return (
    <View style={styles.insightsCard}>
      <Text style={styles.insightsTitle}>{C.insightsTitle}</Text>
      <Text style={styles.insightsTotal}>{moneyLabel({ amount: summary.totalThisMonth, currency: cur, currencyAssumed: false })}</Text>
      {top && <Text style={styles.insightsLine}>{C.insightsTopCategory(top.category, top.pct)}</Text>}
      {trend && <Text style={styles.insightsLine}>{trend}</Text>}
      {summary.usualMonthlyAverage > 0 && (
        <Text style={styles.insightsLine}>
          {C.insightsProjection(money0(summary.projectedTotal), money0(summary.usualMonthlyAverage))}
        </Text>
      )}
    </View>
  );
}

function ListBody({ records, nudge, onDismissNudge, onScan, onUpload, onManual }: {
  records: ReturnType<typeof useExpenseScanner>['records'];
  nudge: ReturnType<typeof useExpenseScanner>['nudge'];
  onDismissNudge: () => void;
  onScan: () => void;
  onUpload: () => void;
  onManual: () => void;
}) {
  const total = useMemo(() => records.reduce((a, r) => a + r.amount, 0), [records]);
  const cur = mainCcy(records);
  return (
    <View>
      <Text style={styles.title} accessibilityRole="header">{C.title}</Text>
      {records.length > 0 && <Text style={styles.subtle}>{C.totalThisList(moneyLabel({ amount: total, currency: cur, currencyAssumed: false }))}</Text>}

      {nudge && <NudgeBanner message={nudge.message} onDismiss={onDismissNudge} />}
      <InsightsCard records={records} />

      <View style={styles.ctaGap}><PrimaryButton label={C.scanCta} onPress={onScan} /></View>
      <View style={styles.uploadGap}><SecondaryButton label="Upload PDF or image" onPress={onUpload} /></View>
      <View style={styles.uploadGap}><SecondaryButton label={C.enterManually} onPress={onManual} /></View>

      {records.length === 0 ? (
        <Text style={styles.empty}>{C.empty}</Text>
      ) : (
        <View style={styles.card}>
          {records.map((r, i) => (
            <View key={r.id} style={[styles.row, i > 0 && styles.rowBorder]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowMerchant}>{r.merchant}</Text>
                <Text style={styles.rowMeta}>{r.category}{r.dateISO ? ` · ${r.dateISO}` : ''}{r.manualEntry ? ` · ${C.enterManually.toLowerCase()}` : ''}</Text>
              </View>
              <Text style={styles.rowAmount}>{moneyLabel({ amount: r.amount, currency: r.currency, currencyAssumed: false })}</Text>
            </View>
          ))}
        </View>
      )}
      <PrivacyFootnote text={C.privacy} />
    </View>
  );
}

/** Quick-pick currencies for the review screen; any other ISO 4217 code via "Other". */
const QUICK_CCY = ['INR', 'USD', 'EUR', 'GBP'] as const;
const ccyLabel = (code: string) => {
  const sym = CODE_TO_SYMBOL[code];
  return sym && sym !== code ? `${sym} ${code}` : code;
};

function ReviewBody({ fields, onSave, onRetake, defaultCurrency }: {
  fields: ExpenseFields;
  onSave: ReturnType<typeof useExpenseScanner>['save'];
  onRetake: () => void;
  defaultCurrency?: string;
}) {
  const [merchant, setMerchant] = useState(fields.merchant.value ?? '');
  const [amount, setAmount] = useState(fields.total.value ? String(fields.total.value.amount) : '');
  const [dateISO, setDateISO] = useState(fields.date.value ?? '');
  const [category, setCategory] = useState(fields.category.value ?? 'Other');
  const flag = (k: 'merchant' | 'date' | 'total' | 'category') => fields.reviewFields.includes(k);

  // Currency: trust the OCR-detected code only when it wasn't assumed; otherwise fall
  // back to the user's last-used currency, and finally to INR (India-first) — the
  // extractor's own USD default stays put for eval parity, but the human-facing review
  // shouldn't silently stamp $ on a rupee receipt when nothing was actually detected.
  const detected = fields.total.value?.currency;
  const assumed = fields.total.value?.currencyAssumed ?? true;
  const initialCcy =
    detected && !assumed ? detected
      : defaultCurrency && ISO_CODE_SET.has(defaultCurrency) ? defaultCurrency
        : 'INR';
  const [ccyText, setCcyText] = useState(initialCcy);
  const [showOtherCcy, setShowOtherCcy] = useState(!(QUICK_CCY as readonly string[]).includes(initialCcy));
  const currency = ISO_CODE_SET.has(ccyText.trim().toUpperCase()) ? ccyText.trim().toUpperCase() : initialCcy;

  return (
    <View>
      <Text style={styles.title} accessibilityRole="header">{C.reviewTitle}</Text>
      <Text style={styles.subtle}>{C.reviewSub}</Text>

      <EditField label={C.merchant} value={merchant} onChange={setMerchant} flagged={flag('merchant')} />
      <EditField label={C.amount} value={amount} onChange={setAmount} keyboardType="decimal-pad" flagged={flag('total')} />

      <Text style={styles.fieldLabel}>{C.manualCurrency}{assumed ? `  · ${C.checkThis}` : ''}</Text>
      <View style={styles.chips}>
        {QUICK_CCY.map((c) => {
          const on = !showOtherCcy && currency === c;
          return (
            <Pressable key={c} onPress={() => { setCcyText(c); setShowOtherCcy(false); }}
              accessibilityRole="button" accessibilityState={{ selected: on }}
              style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{ccyLabel(c)}</Text>
            </Pressable>
          );
        })}
        <Pressable onPress={() => { setShowOtherCcy(true); setCcyText(''); }}
          accessibilityRole="button" accessibilityState={{ selected: showOtherCcy }}
          style={[styles.chip, showOtherCcy && styles.chipOn]}>
          <Text style={[styles.chipText, showOtherCcy && styles.chipTextOn]}>Other</Text>
        </Pressable>
      </View>
      {showOtherCcy && (
        <TextInput
          style={[styles.input, { marginTop: space[2] }, !ISO_CODE_SET.has(ccyText.trim().toUpperCase()) && styles.inputFlagged]}
          value={ccyText}
          onChangeText={setCcyText}
          placeholder="e.g. JPY"
          placeholderTextColor={color.textTertiary}
          autoCapitalize="characters"
          maxLength={3}
        />
      )}

      <EditField label={C.date} value={dateISO} onChange={setDateISO} placeholder="YYYY-MM-DD" flagged={flag('date')} />

      <Text style={styles.fieldLabel}>{C.category}{flag('category') ? `  · ${C.checkThis}` : ''}</Text>
      <View style={styles.chips}>
        {EXPENSE.CATEGORIES.map((c) => (
          <Pressable key={c} onPress={() => setCategory(c)}
            style={[styles.chip, category === c && styles.chipOn]}>
            <Text style={[styles.chipText, category === c && styles.chipTextOn]}>{c}</Text>
          </Pressable>
        ))}
      </View>

      {fields.lineItems.length > 0 && (
        <View style={styles.itemsCard}>
          <Text style={styles.fieldLabel}>{C.itemsDetected}</Text>
          {fields.lineItems.map((it, i) => (
            <View key={`${it.description}-${i}`} style={styles.itemRow}>
              <Text style={styles.itemDesc} numberOfLines={1}>{it.description || '—'}</Text>
              <Text style={styles.itemAmount}>{moneyLabel({ amount: it.amount, currency, currencyAssumed: false })}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.ctaGap}>
        <PrimaryButton label={C.save}
          onPress={() => onSave({ merchant, amount: parseFloat(amount) || 0, dateISO: dateISO || null, currency, category })} />
      </View>
      <View style={{ height: space[3] }} />
      <SecondaryButton label={C.retake} onPress={onRetake} />
      <PrivacyFootnote text={C.privacy} />
    </View>
  );
}

function EditField({ label, value, onChange, flagged, keyboardType, placeholder }: {
  label: string; value: string; onChange: (t: string) => void; flagged?: boolean;
  keyboardType?: 'default' | 'decimal-pad'; placeholder?: string;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}{flagged ? `  · ${C.checkThis}` : ''}</Text>
      <TextInput
        style={[styles.input, flagged && styles.inputFlagged]}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType ?? 'default'}
        placeholder={placeholder}
        placeholderTextColor={color.textTertiary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  scroll: { flexGrow: 1, paddingHorizontal: layout.screenPaddingH, paddingTop: space[3], paddingBottom: space[7] },
  content: { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' },
  center: { paddingTop: space[8], alignItems: 'center' },
  dim: { ...type.subtext, color: color.textSecondary, textAlign: 'center' },
  title: { ...type.h1, color: color.textPrimary },
  subtle: { ...type.subtext, color: color.textSecondary, marginTop: space[2] },
  empty: { ...type.body, color: color.textSecondary, marginTop: space[6], textAlign: 'center' },
  ctaGap: { marginTop: space[5] },
  uploadGap: { marginTop: space[3], alignItems: 'center' },
  card: { marginTop: space[5], backgroundColor: color.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: color.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', padding: space[4], gap: space[3] },
  rowBorder: { borderTopWidth: 1, borderTopColor: color.border },
  rowMerchant: { ...type.body, color: color.textPrimary },
  rowMeta: { ...type.caption, color: color.textSecondary, marginTop: 1 },
  rowAmount: { ...type.body, color: color.textPrimary, fontWeight: '600' },
  fieldWrap: { marginTop: space[5] },
  fieldLabel: { ...type.caption, color: color.textSecondary, marginBottom: space[2], marginTop: space[5] },
  input: { ...type.body, color: color.textPrimary, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: radii.md, paddingHorizontal: space[4], paddingVertical: space[3] },
  inputFlagged: { borderColor: color.accent },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { paddingHorizontal: space[4], paddingVertical: space[2], borderRadius: radii.pill, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface },
  chipOn: { backgroundColor: color.accent, borderColor: color.accent },
  chipText: { ...type.subtext, color: color.textSecondary },
  chipTextOn: { color: color.onAccent, fontWeight: '600' },
  nudge: {
    marginTop: space[5], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: space[3], backgroundColor: color.surface, borderRadius: radii.lg, borderWidth: 1,
    borderColor: color.accent, padding: space[4],
  },
  nudgeText: { ...type.subtext, color: color.textPrimary, flex: 1 },
  nudgeDismiss: { ...type.body, color: color.textSecondary },
  insightsCard: {
    marginTop: space[5], backgroundColor: color.surface, borderRadius: radii.lg,
    borderWidth: 1, borderColor: color.border, padding: space[4],
  },
  insightsTitle: { ...type.caption, color: color.textSecondary },
  insightsTotal: { ...type.h1, color: color.textPrimary, marginTop: space[1] },
  insightsLine: { ...type.subtext, color: color.textSecondary, marginTop: space[2] },
  manualBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  manualSheet: {
    backgroundColor: color.background, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl,
    padding: layout.screenPaddingH, paddingBottom: space[7],
  },
  manualCancelGap: { marginTop: space[3] },
  itemsCard: { marginTop: space[2] },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space[3], paddingVertical: space[1] },
  itemDesc: { ...type.subtext, color: color.textSecondary, flex: 1 },
  itemAmount: { ...type.subtext, color: color.textPrimary },
});

export default ExpenseScreen;
