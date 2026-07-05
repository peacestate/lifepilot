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
import { CameraSheet } from '../features/expense/CameraSheet';
import { buildMonthlySummary } from '../features/expense/expenseInsights';
import { useExpenseScanner } from '../features/expense/useExpenseScanner';
import type { ExpenseFields } from '../features/expense/types';
import { color, layout, radii, space, type } from '../theme/tokens';
import { EXPENSE_COPY as C } from './expenseCopy';

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
            <ReviewBody fields={s.fields} onSave={s.save} onRetake={openCamera} />
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
              dateLabel={C.manualDate}
              submitLabel={C.manualSubmit}
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
  const trend =
    summary.deltaPct == null ? null
      : summary.deltaVsLastMonth > 0 ? C.insightsUp(`$${summary.deltaVsLastMonth.toFixed(0)}`)
      : summary.deltaVsLastMonth < 0 ? C.insightsDown(`$${Math.abs(summary.deltaVsLastMonth).toFixed(0)}`)
      : C.insightsFlat;

  return (
    <View style={styles.insightsCard}>
      <Text style={styles.insightsTitle}>{C.insightsTitle}</Text>
      <Text style={styles.insightsTotal}>${summary.totalThisMonth.toFixed(2)}</Text>
      {top && <Text style={styles.insightsLine}>{C.insightsTopCategory(top.category, top.pct)}</Text>}
      {trend && <Text style={styles.insightsLine}>{trend}</Text>}
      {summary.usualMonthlyAverage > 0 && (
        <Text style={styles.insightsLine}>
          {C.insightsProjection(`$${summary.projectedTotal.toFixed(0)}`, `$${summary.usualMonthlyAverage.toFixed(0)}`)}
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
  return (
    <View>
      <Text style={styles.title} accessibilityRole="header">{C.title}</Text>
      {records.length > 0 && <Text style={styles.subtle}>{C.totalThisList(`$${total.toFixed(2)}`)}</Text>}

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

function ReviewBody({ fields, onSave, onRetake }: {
  fields: ExpenseFields;
  onSave: ReturnType<typeof useExpenseScanner>['save'];
  onRetake: () => void;
}) {
  const [merchant, setMerchant] = useState(fields.merchant.value ?? '');
  const [amount, setAmount] = useState(fields.total.value ? String(fields.total.value.amount) : '');
  const [dateISO, setDateISO] = useState(fields.date.value ?? '');
  const [category, setCategory] = useState(fields.category.value ?? 'Other');
  const currency = fields.total.value?.currency ?? 'USD';
  const flag = (k: 'merchant' | 'date' | 'total' | 'category') => fields.reviewFields.includes(k);

  return (
    <View>
      <Text style={styles.title} accessibilityRole="header">{C.reviewTitle}</Text>
      <Text style={styles.subtle}>{C.reviewSub}</Text>

      <EditField label={C.merchant} value={merchant} onChange={setMerchant} flagged={flag('merchant')} />
      <EditField label={C.amount} value={amount} onChange={setAmount} keyboardType="decimal-pad" flagged={flag('total')} />
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
  scroll: { flexGrow: 1, paddingHorizontal: layout.screenPaddingH, paddingTop: space[6], paddingBottom: space[7] },
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
});

export default ExpenseScreen;
