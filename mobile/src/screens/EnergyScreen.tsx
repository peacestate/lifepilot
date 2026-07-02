/**
 * EnergyScreen — feature #2. One calm screen: the day's energy curve, peak/dip,
 * best-focus & wind-down windows, one gentle insight. Cold-start shows a ghost curve.
 * Spec: design/energy/screen-spec.md. Model/contract: docs/energy-predictor-model-contract.md.
 *
 * Dumb screen — all logic in useEnergyPredictor. The curve comes from the on-device
 * ExecuTorch model (heuristic fallback before export). NO network anywhere.
 */
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EnergyCurve } from '../components/EnergyCurve';
import { PrivacyFootnote } from '../components/PrivacyFootnote';
import { useEnergyPredictor } from '../features/energy/useEnergyPredictor';
import type { EnergyWindow } from '../features/energy/types';
import { color, layout, radii, space, type } from '../theme/tokens';
import { ENERGY_COPY as C } from './energyCopy';

const fmtHour = (h: number) => {
  const x = h % 12 === 0 ? 12 : h % 12;
  return `${x} ${h < 12 ? 'AM' : 'PM'}`;
};

export function EnergyScreen() {
  const { loading, forecast } = useEnergyPredictor();

  const summary = useMemo(() => {
    if (!forecast) return '';
    return `${C.peakLead} ${fmtHour(forecast.peak.hour)} ${C.dipLead} ${fmtHour(forecast.dip.hour)}.`;
  }, [forecast]);

  if (loading || !forecast) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.center}><Text style={styles.dim}>{C.settingUp}</Text></View>
      </SafeAreaView>
    );
  }

  const f = forecast;
  const calibrating = f.calibrating;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <Text style={styles.title} accessibilityRole="header">
            {calibrating ? C.calibratingTitle : C.title}
          </Text>

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

          <PrivacyFootnote text={C.privacy} />
        </View>
      </ScrollView>
    </SafeAreaView>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dim: { ...type.subtext, color: color.textSecondary },
  scroll: { flexGrow: 1, paddingHorizontal: layout.screenPaddingH, paddingTop: space[6], paddingBottom: space[7] },
  content: { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' },
  title: { ...type.h1, color: color.textPrimary },
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
});

export default EnergyScreen;
