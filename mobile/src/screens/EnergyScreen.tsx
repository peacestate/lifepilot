/**
 * EnergyScreen — feature #2. One calm screen: the day's energy curve, peak/dip,
 * best-focus & wind-down windows, one gentle insight. Cold-start shows a ghost curve.
 * Spec: design/energy/screen-spec.md. Model/contract: docs/energy-predictor-model-contract.md.
 *
 * Dumb screen — all logic in useEnergyPredictor. The curve comes from the on-device
 * ExecuTorch model (heuristic fallback before export). NO network anywhere.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EnergyCurve } from '../components/EnergyCurve';
import { ManualEnergyEntryForm } from '../components/ManualEnergyEntryForm';
import { PrivacyFootnote } from '../components/PrivacyFootnote';
import { ENERGY_SLEEP_TARGET_H } from '../features/energy/energyCalibration';
import type { WeeklyHealthInsight } from '../features/energy/energyCalibration';
import type { DataSourceSummary, FieldStatus } from '../features/energy/healthSource';
import { energyStore } from '../features/energy/energyStore';
import { useEnergyPredictor } from '../features/energy/useEnergyPredictor';
import type { EnergyWindow } from '../features/energy/types';
import { color, layout, radii, space, type } from '../theme/tokens';
import { ENERGY_COPY as C } from './energyCopy';

const STEPS_BASELINE = 7000;

const fmtHour = (h: number) => {
  const x = h % 12 === 0 ? 12 : h % 12;
  return `${x} ${h < 12 ? 'AM' : 'PM'}`;
};

export function EnergyScreen() {
  const {
    loading, forecast, needsManualEntry, recordCheckIn, submitManualEntry, skipManualEntry,
    dataSources, weeklyInsight, refresh,
  } = useEnergyPredictor();
  const [checkedIn, setCheckedIn] = useState(false);
  const [manualOverride, setManualOverride] = useState(false);
  const [laptopWorkDay, setLaptopWorkDay] = useState(() => energyStore.isLaptopWorkDay());

  useEffect(() => {
    void energyStore.ready();
  }, []);

  const handleLaptopToggle = async (value: boolean) => {
    setLaptopWorkDay(value);
    energyStore.setLaptopWorkDay(value);
    await refresh();
  };

  const onCheckIn = (actual: number) => {
    setCheckedIn(true);
    void recordCheckIn(actual);
  };

  const onManualSubmit = (sleepH: number, wakeH: number, steps: number) => {
    setManualOverride(false);
    void submitManualEntry(sleepH, wakeH, steps);
  };

  const summary = useMemo(() => {
    if (!forecast) return '';
    return `${C.peakLead} ${fmtHour(forecast.peak.hour)} ${C.dipLead} ${fmtHour(forecast.dip.hour)}.`;
  }, [forecast]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.center}><Text style={styles.dim}>{C.settingUp}</Text></View>
      </SafeAreaView>
    );
  }

  // Health Connect + manual entry both empty, or the user chose to log by hand — same form
  // either way (Integration Flow: "no permission / no data → show manual entry screen").
  if (needsManualEntry || manualOverride) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.content}>
            <Text style={styles.manualIntro}>{C.manualEntryIntro}</Text>
            <ManualEnergyEntryForm
              title={C.manualEntryTitle}
              sleepLabel={C.manualSleepLabel}
              wakeLabel={C.manualWakeLabel}
              stepsLabel={C.manualStepsLabel}
              submitLabel={C.manualSubmit}
              onSubmit={onManualSubmit}
              onSkip={() => void skipManualEntry()}
              skipLabel={C.manualSkip}
            />
            <PrivacyFootnote text={C.privacy} />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!forecast) return null; // unreachable in practice: !loading && !needsManualEntry implies a forecast

  const f = forecast;
  const calibrating = f.calibrating;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <Text style={styles.title} accessibilityRole="header">
            {calibrating ? C.calibratingTitle : C.title}
          </Text>

          {!calibrating && (
            <View style={styles.contextToggle}>
              <View style={styles.contextLabel}>
                <Text style={styles.contextLabelText} maxFontSizeMultiplier={1.4}>
                  Spent day on laptop?
                </Text>
                <Text style={styles.contextHint} maxFontSizeMultiplier={1.3}>
                  Helps adjust accuracy when phone didn't move much
                </Text>
              </View>
              <Switch
                value={laptopWorkDay}
                onValueChange={handleLaptopToggle}
                trackColor={{ false: color.surfaceAlt, true: color.accent }}
                thumbColor={color.surface}
                accessibilityLabel="Laptop work day"
              />
            </View>
          )}

          <View style={styles.curveWrap} accessibilityLabel={calibrating ? undefined : summary}>
            <EnergyCurve
              points={f.points}
              peakHour={f.peak.hour}
              dipHour={f.dip.hour}
              dashed={calibrating}
            />
          </View>

          {calibrating ? (
            <Text style={styles.calibrating} accessibilityLiveRegion="polite">
              {C.calibrating(f.daysCollected, 3)}
            </Text>
          ) : (
            <>
              <Text style={styles.summary}>{summary}</Text>

              <View style={styles.cards}>
                {f.windows.map((w) => (
                  <WindowCard key={w.kind} w={w} />
                ))}
              </View>

              <View style={styles.insight}>
                <Text style={styles.insightText}>
                  {C.insightDip(fmtHour(f.dip.hour))}
                </Text>
              </View>

              {f.basis === 'heuristic' && (
                <Text style={styles.basis}>{C.basisEstimate}</Text>
              )}
            </>
          )}

          {dataSources && (
            <View style={styles.gap}>
              <DataSourcesPanel sources={dataSources} />
            </View>
          )}

          {new Date().getDay() === 1 && weeklyInsight && (
            <View style={styles.gap}>
              <WeeklyHealthCard insight={weeklyInsight} />
            </View>
          )}

          <Pressable onPress={() => setManualOverride(true)} hitSlop={8} style={styles.enterManuallyLink}>
            <Text style={styles.enterManuallyText}>{C.enterManually}</Text>
          </Pressable>

          <View style={styles.checkIn}>
            {checkedIn ? (
              <Text style={styles.checkInThanks} accessibilityLiveRegion="polite">
                {C.checkInThanks}
              </Text>
            ) : (
              <>
                <Text style={styles.checkInPrompt}>{C.checkInPrompt}</Text>
                <View style={styles.checkInRow}>
                  <CheckInPill label={C.checkInLow} onPress={() => onCheckIn(20)} />
                  <CheckInPill label={C.checkInOk} onPress={() => onCheckIn(55)} />
                  <CheckInPill label={C.checkInHigh} onPress={() => onCheckIn(85)} />
                </View>
              </>
            )}
          </View>

          <PrivacyFootnote text={C.privacy} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function CheckInPill({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Energy check-in: ${label}`}
      style={({ pressed }) => [styles.checkInPill, pressed && styles.checkInPillPressed]}
    >
      <Text style={styles.checkInPillLabel}>{label}</Text>
    </Pressable>
  );
}

function WindowCard({ w }: { w: EnergyWindow }) {
  return (
    <View style={[styles.card, w.kind === 'rest' && styles.cardRest]}>
      <Text style={styles.cardLabel}>{w.kind === 'focus' ? C.focusCard : C.restCard}</Text>
      <Text style={styles.cardRange}>{C.windowRange(fmtHour(w.startHour), fmtHour(w.endHour))}</Text>
    </View>
  );
}

/** Step 7 — "no black box": shows exactly which real data fed today's forecast. */
function DataSourcesPanel({ sources }: { sources: DataSourceSummary }) {
  const sleepLine =
    sources.sleepStatus === 'measured' && sources.sleepHours != null
      ? C.sleepMeasured(`${sources.sleepHours.toFixed(1)} hours`)
      : sources.sleepStatus === 'estimated'
      ? C.sleepEstimated
      : C.sleepMissing;

  const stepsLine =
    sources.stepsStatus === 'measured' && sources.steps != null
      ? C.stepsMeasured(sources.steps.toLocaleString())
      : sources.stepsStatus === 'estimated'
      ? C.stepsEstimated
      : C.stepsMissing;

  const hrLine =
    sources.heartRateStatus === 'measured' && sources.restingHeartRate != null
      ? C.heartRateMeasured(sources.restingHeartRate)
      : C.heartRateMissing;

  return (
    <View style={styles.sourcesCard}>
      <Text style={styles.sourcesTitle}>{C.basedOnTitle}</Text>
      <SourceRow status={sources.sleepStatus} text={sleepLine} />
      <SourceRow status={sources.stepsStatus} text={stepsLine} />
      <SourceRow status={sources.heartRateStatus} text={hrLine} />
    </View>
  );
}

function SourceRow({ status, text }: { status: FieldStatus; text: string }) {
  const ok = status === 'measured';
  return (
    <View style={styles.sourceRow}>
      <Text style={[styles.sourceGlyph, !ok && styles.sourceGlyphWarn]}>{ok ? '✓' : '!'}</Text>
      <Text style={styles.sourceText}>{text}</Text>
    </View>
  );
}

/** Step 8 — Monday-only weekly health summary, including a real sleep→energy correlation. */
function WeeklyHealthCard({ insight }: { insight: WeeklyHealthInsight }) {
  const targetH = ENERGY_SLEEP_TARGET_H.toFixed(1);
  const sleepLine = insight.avgSleepH != null
    ? insight.avgSleepH < ENERGY_SLEEP_TARGET_H - 0.05
      ? C.weeklySleepBelow(`${insight.avgSleepH}h`, `${targetH}h`)
      : insight.avgSleepH > ENERGY_SLEEP_TARGET_H + 0.05
      ? C.weeklySleepAbove(`${insight.avgSleepH}h`, `${targetH}h`)
      : C.weeklySleepAt(`${insight.avgSleepH}h`, `${targetH}h`)
    : undefined;

  const stepsLine = insight.avgSteps != null
    ? insight.avgSteps >= STEPS_BASELINE
      ? C.weeklyStepsGood(insight.avgSteps.toLocaleString(), STEPS_BASELINE.toLocaleString())
      : C.weeklyStepsBelow(insight.avgSteps.toLocaleString(), STEPS_BASELINE.toLocaleString())
    : undefined;

  const hrLine = insight.restingHRTrend === 'improving' && insight.restingHRDeltaBpm != null
    ? C.weeklyHRImproving(insight.restingHRDeltaBpm)
    : insight.restingHRTrend === 'worsening' && insight.restingHRDeltaBpm != null
    ? C.weeklyHRWorsening(insight.restingHRDeltaBpm)
    : insight.restingHRTrend === 'steady'
    ? C.weeklyHRSteady
    : undefined;

  return (
    <View style={styles.weeklyCard}>
      <Text style={styles.weeklyTitle}>{C.weeklyHealthTitle}</Text>
      {sleepLine && <Text style={styles.weeklyLine}>{sleepLine}</Text>}
      {stepsLine && <Text style={styles.weeklyLine}>{stepsLine}</Text>}
      {hrLine && <Text style={styles.weeklyLine}>{hrLine}</Text>}
      {insight.bestEnergyDayLabel && insight.worstEnergyDayLabel && (
        <Text style={styles.weeklyLine}>
          {C.weeklyBestWorstEnergy(insight.bestEnergyDayLabel, insight.worstEnergyDayLabel)}
        </Text>
      )}
      {insight.sleepEnergyUpliftPct != null && insight.sleepEnergyUpliftPct > 0 && (
        <Text style={styles.weeklyInsightLine}>{C.weeklySleepUplift(insight.sleepEnergyUpliftPct)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dim: { ...type.subtext, color: color.textSecondary },
  scroll: { flexGrow: 1, paddingHorizontal: layout.screenPaddingH, paddingTop: space[3], paddingBottom: space[7] },
  content: { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' },
  title: { ...type.h1, color: color.textPrimary },
  contextToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space[5],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    backgroundColor: color.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: color.border,
    minHeight: layout.minTouchTarget,
  },
  contextLabel: { flex: 1 },
  contextLabelText: { ...type.body, color: color.textPrimary },
  contextHint: { ...type.caption, color: color.textSecondary, marginTop: 2 },
  curveWrap: { marginTop: space[6], alignItems: 'center' },
  calibrating: { ...type.subtext, color: color.textSecondary, textAlign: 'center', marginTop: space[5] },
  summary: { ...type.subtext, color: color.textSecondary, marginTop: space[5], textAlign: 'center' },
  cards: { flexDirection: 'row', gap: space[3], marginTop: space[6] },
  card: {
    flex: 1, backgroundColor: color.surface, borderRadius: radii.lg, borderWidth: 1,
    borderColor: color.border, padding: space[4],
  },
  cardRest: { backgroundColor: color.surfaceAlt },
  cardLabel: { ...type.captionStrong, color: color.accent },
  cardRange: { ...type.body, color: color.textPrimary, marginTop: space[1] },
  insight: { marginTop: space[6], backgroundColor: color.surfaceAlt, borderRadius: radii.lg, padding: space[4] },
  insightText: { ...type.body, color: color.textPrimary },
  basis: { ...type.caption, color: color.textTertiary, textAlign: 'center', marginTop: space[5] },
  manualIntro: { ...type.subtext, color: color.textSecondary, marginBottom: space[5] },
  enterManuallyLink: { alignSelf: 'center', marginTop: space[6], minHeight: 32, justifyContent: 'center' },
  enterManuallyText: { ...type.caption, color: color.accent, fontWeight: '600' as const },
  checkIn: { marginTop: space[6], alignItems: 'center' },
  checkInPrompt: { ...type.caption, color: color.textSecondary },
  checkInRow: { flexDirection: 'row', gap: space[3], marginTop: space[3] },
  checkInPill: {
    minHeight: 40, minWidth: 64, borderRadius: radii.pill, borderWidth: 1,
    borderColor: color.border, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: space[4],
  },
  checkInPillPressed: { backgroundColor: color.surfaceAlt },
  checkInPillLabel: { ...type.caption, fontWeight: '600' as const, color: color.accent },
  checkInThanks: { ...type.caption, color: color.textSecondary },
  gap: { marginTop: space[5] },
  sourcesCard: {
    backgroundColor: color.surface, borderRadius: radii.lg, borderWidth: 1,
    borderColor: color.border, padding: space[4],
  },
  sourcesTitle: { ...type.captionStrong, color: color.textSecondary, marginBottom: space[2] },
  sourceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2], marginTop: space[1] },
  sourceGlyph: { ...type.body, color: color.accent, fontWeight: '600' as const, width: 16 },
  sourceGlyphWarn: { color: color.textTertiary },
  sourceText: { ...type.body, color: color.textPrimary, flex: 1 },
  weeklyCard: {
    backgroundColor: color.surface, borderRadius: radii.lg, borderWidth: 1,
    borderColor: color.border, padding: space[4],
  },
  weeklyTitle: { ...type.captionStrong, color: color.accent, marginBottom: space[2] },
  weeklyLine: { ...type.body, color: color.textPrimary, marginTop: space[1] },
  weeklyInsightLine: { ...type.body, color: color.textPrimary, marginTop: space[3], fontWeight: '600' as const },
});

export default EnergyScreen;
