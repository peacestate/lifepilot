/**
 * SettingsScreen — cross-cutting settings only: nudges, per-feature toggles, quiet
 * hours, weather mode, and About. The Hydration profile (body mass, wake/sleep, units)
 * lives with its feature now — set on first open of the Hydration screen and editable
 * there via "Edit profile" — so Settings no longer skews hydration-heavy.
 *
 * Compact horizontal layout: label left, control right. The header/back button uses the
 * same safe-area top inset as FeatureShell so it doesn't crowd the status bar.
 */
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { nudgeCenter } from '../core/nudges/NudgeCenter';
import type { NudgeFeature, NudgeSettings } from '../core/nudges/NudgeCenter';
import { hydrationStore } from '../features/hydration/hydrationStore';
import { color, layout, radii, space, type } from '../theme/tokens';

type Props = { onBack: () => void };

export function SettingsScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [nudge, setNudge] = useState<NudgeSettings>(() => nudgeCenter.getSettings());
  const [weatherLive, setWeatherLive] = useState(
    () => hydrationStore.getProfile().weatherMode === 'live',
  );

  const patchNudge = useCallback((patch: Partial<NudgeSettings>) => {
    nudgeCenter.configure(patch);
    setNudge({ ...nudgeCenter.getSettings() });
  }, []);

  const toggleFeature = (f: NudgeFeature) => {
    patchNudge({ perFeature: { ...nudge.perFeature, [f]: !nudge.perFeature[f] } });
  };

  const toggleWeather = (val: boolean) => {
    hydrationStore.setProfile({ weatherMode: val ? 'live' : 'offline' });
    setWeatherLive(val);
  };

  return (
    <View style={styles.root}>
      {/* Header: "‹ Settings" as one vertically-centered row (matches FeatureShell's
          "‹ Hydration"), padded below the status bar so it doesn't crowd the clock. */}
      <View style={[styles.header, { paddingTop: insets.top + space[5] }]}>
        <Pressable
          onPress={onBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [styles.backRow, pressed && styles.backPressed]}
        >
          <Text style={styles.backChevron}>‹</Text>
          <Text style={styles.headerTitle} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
            Settings
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {/* Nudges section */}
          <Section title="Nudges">
            <Row
              label="Nudges enabled"
              sub="Quiet reminders for hydration, energy, and focus"
              value={nudge.enabled}
              onToggle={(v) => patchNudge({ enabled: v })}
            />
          </Section>

          <Section title="Per feature">
            <Row
              label="Hydration"
              sub="Water-pace reminders"
              value={nudge.perFeature.hydration}
              onToggle={() => toggleFeature('hydration')}
              disabled={!nudge.enabled}
            />
            <Row
              label="Energy"
              sub="Focus and wind-down window alerts"
              value={nudge.perFeature.energy}
              onToggle={() => toggleFeature('energy')}
              disabled={!nudge.enabled}
            />
            <Row
              label="Overwhelm"
              sub="Next-step read-aloud to glasses"
              value={nudge.perFeature.overwhelm}
              onToggle={() => toggleFeature('overwhelm')}
              disabled={!nudge.enabled}
            />
          </Section>

          <Section title="Quiet hours">
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel} maxFontSizeMultiplier={1.4}>No nudges from</Text>
              <Text style={styles.infoValue} maxFontSizeMultiplier={1.4}>
                {nudge.quietFromHour}:00 – {nudge.quietToHour}:00
              </Text>
            </View>
            <Text style={styles.infoHint} maxFontSizeMultiplier={1.4}>
              Configurable quiet-hour editor coming in v1.1.
            </Text>
          </Section>

          {/* Privacy section */}
          <Section title="Privacy">
            <Row
              label="Live weather (opt-in)"
              sub="Improves hydration target accuracy. Only your coarse location is fetched — no personal data sent."
              value={weatherLive}
              onToggle={toggleWeather}
            />
          </Section>

          {/* About */}
          <Section title="About">
            <Text style={styles.aboutText} maxFontSizeMultiplier={1.4}>
              LifePilot v0.1.0{'\n'}
              All AI features run fully on-device via ExecuTorch.{'\n'}
              No accounts. No servers. No data collection.
            </Text>
          </Section>

          {/* Attribution — required by the Llama 3.2 Community License (the Overwhelm
              Manager runs Meta's Llama 3.2 1B on-device). "Built with Llama" + the
              copyright notice keep the app commercially compliant. */}
          <Section title="Credits">
            <Text style={styles.aboutText} maxFontSizeMultiplier={1.4}>
              Built with Llama.{'\n'}
              The Overwhelm Manager runs Meta's Llama 3.2 1B, licensed under the Llama 3.2
              Community License, Copyright © Meta Platforms, Inc. All Rights Reserved.
            </Text>
          </Section>
        </View>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={sectionStyles.wrap}>
      <Text style={sectionStyles.title} maxFontSizeMultiplier={1.2}>{title}</Text>
      <View style={sectionStyles.card}>{children}</View>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  wrap: { marginBottom: space[6] },
  title: { ...type.captionStrong, color: color.textSecondary, marginBottom: space[2], textTransform: 'uppercase', letterSpacing: 0.6 },
  card: { backgroundColor: color.surface, borderRadius: radii.md, borderWidth: 1, borderColor: color.border, overflow: 'hidden' },
});

function Row({
  label, sub, value, onToggle, disabled,
}: {
  label: string;
  sub?: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={rowStyles.row}>
      <View style={rowStyles.text}>
        <Text style={[rowStyles.label, disabled && rowStyles.dimmed]} maxFontSizeMultiplier={1.4}>
          {label}
        </Text>
        {sub && (
          <Text style={[rowStyles.sub, disabled && rowStyles.dimmed]} maxFontSizeMultiplier={1.4}>
          {sub}
          </Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ false: color.surfaceAlt, true: color.accent }}
        thumbColor={color.surface}
        accessibilityLabel={label}
      />
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space[4],
    paddingVertical: space[4],
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    gap: space[4],
    minHeight: layout.minTouchTarget,
  },
  text: { flex: 1 },
  label: { ...type.body, color: color.textPrimary },
  sub: { ...type.caption, color: color.textSecondary, marginTop: 2 },
  dimmed: { color: color.textTertiary },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  header: {
    paddingHorizontal: layout.screenPaddingH,
    paddingBottom: space[4],
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space[1],
    minHeight: layout.minTouchTarget,
    paddingRight: space[3],
  },
  backPressed: { opacity: 0.5 },
  // fontSize 26 optically pairs the chevron with the h2 title; padding off + the row's
  // alignItems:center keep "‹" and "Settings" on the same line.
  backChevron: { fontSize: 26, color: color.accent, includeFontPadding: false },
  // translateY nudges "Settings" down onto the chevron's center axis — the tight text
  // box (includeFontPadding off) otherwise rides ~2px high because of the "g" descender.
  headerTitle: { ...type.h2, color: color.textPrimary, includeFontPadding: false, transform: [{ translateY: 2 }] },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: space[4],
    paddingBottom: space[6],
  },
  content: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
  },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space[4], paddingVertical: space[4] },
  infoLabel: { ...type.body, color: color.textPrimary },
  infoValue: { ...type.body, color: color.textSecondary },
  infoHint: { ...type.caption, color: color.textTertiary, paddingHorizontal: space[4], paddingBottom: space[3] },
  aboutText: { ...type.caption, color: color.textSecondary, paddingHorizontal: space[4], paddingVertical: space[4], lineHeight: 20 },
});

export default SettingsScreen;
