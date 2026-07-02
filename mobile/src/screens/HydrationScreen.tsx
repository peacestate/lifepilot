/**
 * HydrationScreen — feature #3. One calm screen: the ring, today's goal, the "why",
 * one-tap logging. Spec: design/hydration/screen-spec.md. Engine/model + privacy:
 * docs/hydration-engine-contract.md (§11 ExecuTorch model, §12 dual-mode weather).
 *
 * The screen is dumb — all logic lives in useHydrationTracker. The target comes from
 * the on-device ExecuTorch model (falling back to the deterministic engine offline).
 * NO network here; weather (opt-in only) is isolated in the feature's weatherSource.
 */
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HydrationRing } from '../components/HydrationRing';
import { IntakeQuickAdd } from '../components/IntakeQuickAdd';
import { PrivacyFootnote } from '../components/PrivacyFootnote';
import { WhyTodayPanel } from '../components/WhyTodayPanel';
import { mlToOz } from '../features/hydration/HydrationEngine';
import { useHydrationTracker } from '../features/hydration/useHydrationTracker';
import { color, layout, radii, space, type } from '../theme/tokens';
import { HYDRATION_COPY as C } from './hydrationCopy';

export function HydrationScreen() {
  const h = useHydrationTracker();
  const units = h.profile.units;

  const fmt = useMemo(() => {
    return (ml: number) => {
      if (units === 'oz') return `${Math.round(mlToOz(ml))} oz`;
      return ml >= 1000 ? `${(ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 1)} L` : `${Math.round(ml)} mL`;
    };
  }, [units]);

  if (h.loading || !h.target) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.center}>
          <Text style={styles.dim} accessibilityLiveRegion="polite">{C.settingUp}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const t = h.target;
  const goalMet = h.loggedMl >= t.targetMl;
  const over = h.loggedMl > t.targetMl;

  const statusLabel =
    t.status === 'high' ? C.statusHigh : t.status === 'elevated' ? C.statusElevated : C.statusNormal;

  // headline for the "why" panel (non-alarmist)
  const hot = (h.conditions?.temperatureC ?? 0) >= 28;
  const hazy = (h.conditions?.aqi ?? 0) > 100;
  const active = (t.breakdown.find((b) => b.key === 'activity')?.amountMl ?? 0) > 200;
  const headline = hazy && hot ? C.whyHotHazy : hot ? C.whyHot : active ? C.whyActive : C.whyMild;

  const remaining = Math.max(0, t.targetMl - h.loggedMl);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <Text style={styles.title} accessibilityRole="header">{C.title}</Text>

          <View style={styles.ringWrap}>
            <HydrationRing
              progress={h.progress}
              centerTop={fmt(h.loggedMl)}
              centerSub={`of ${fmt(t.targetMl)}`}
            />
          </View>

          {/* status + progress text (also the screen-reader summary for the ring) */}
          <Text
            style={styles.statusLine}
            accessibilityLabel={`${fmt(h.loggedMl)} of ${fmt(t.targetMl)}. ${
              over ? C.overTarget : goalMet ? C.goalMet : C.remaining(fmt(remaining))
            }`}
            maxFontSizeMultiplier={1.6}
          >
            <Text style={styles.statusChip}>{statusLabel}</Text>
            {'  ·  '}
            {over ? C.overTarget : goalMet ? C.goalMet : C.remaining(fmt(remaining))}
          </Text>

          <View style={styles.gap}>
            <WhyTodayPanel headline={headline} breakdown={t.breakdown} formatMl={fmt} />
          </View>

          <View style={styles.gap}>
            <IntakeQuickAdd
              servingMl={t.servingMl}
              formatMl={fmt}
              onAdd={(ml) => h.addIntake(ml)}
              onCustom={() => h.addIntake(t.servingMl) /* TODO: custom-amount sheet */}
            />
          </View>

          <Text style={styles.disclaimer} maxFontSizeMultiplier={1.6}>{C.disclaimer}</Text>
          <PrivacyFootnote
            text={h.profile.weatherMode === 'live' ? C.liveNote : C.offlineNote}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dim: { ...type.subtext, color: color.textSecondary },
  scroll: { flexGrow: 1, paddingHorizontal: layout.screenPaddingH, paddingTop: space[6], paddingBottom: space[7] },
  content: { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' },
  title: { ...type.h1, color: color.textPrimary },
  ringWrap: { marginTop: space[6], marginBottom: space[5] },
  statusLine: { ...type.subtext, color: color.textSecondary, textAlign: 'center' },
  statusChip: {
    ...type.captionStrong, color: color.accent, backgroundColor: color.surfaceAlt,
    borderRadius: radii.pill, overflow: 'hidden',
  },
  gap: { marginTop: space[5] },
  disclaimer: { ...type.caption, color: color.textTertiary, textAlign: 'center', marginTop: space[6] },
});

export default HydrationScreen;
