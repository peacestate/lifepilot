/**
 * HomeScreen — feature hub. Four cards navigate to each feature; gear opens Settings.
 * Mostly navigation affordances, plus one cross-feature insight card (lifeEngine.ts) when
 * there's something real to say — the only "live data" this screen shows, and it's a pure
 * read of what other features already computed, not a new inference pass.
 */
import React, { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { computeLifeInsight, type LifeInsight } from '../core/lifeEngine';
import { insightSignature, lifeInsightDismissal } from '../core/lifeInsightDismissal';
import { color, elevation, layout, radii, space, type } from '../theme/tokens';

export type FeatureKey = 'overwhelm' | 'energy' | 'hydration' | 'expense';
type Props = {
  onNavigate: (screen: FeatureKey | 'settings') => void;
};

type Card = {
  key: FeatureKey;
  glyph: string;
  title: string;
  sub: string;
};

const CARDS: Card[] = [
  {
    key: 'overwhelm',
    glyph: '◎',
    title: 'Overwhelm Manager',
    sub: 'Break any task into calm steps — gets smarter with use',
  },
  {
    key: 'energy',
    glyph: '◐',
    title: 'Energy Planner',
    sub: 'See your focus & wind-down windows for today',
  },
  {
    key: 'hydration',
    glyph: '◉',
    title: 'Hydration',
    sub: 'Stay on pace with a personalized daily target',
  },
  {
    key: 'expense',
    glyph: '◈',
    title: 'Expense Scanner',
    sub: 'Scan receipts or upload PDFs — all on-device',
  },
];

export function HomeScreen({ onNavigate }: Props) {
  const [insight, setInsight] = useState<LifeInsight | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const i = await computeLifeInsight();
      await lifeInsightDismissal.ready();
      if (!alive) return;
      // Hide it if this exact insight was dismissed before; a changed insight shows again.
      setInsight(i && lifeInsightDismissal.isDismissed(insightSignature(i.sentences)) ? undefined : i);
    })();
    return () => { alive = false; };
  }, []);

  const dismissInsight = () => {
    if (insight) lifeInsightDismissal.dismiss(insightSignature(insight.sentences));
    setInsight(undefined);
  };

  // RN's built-in SafeAreaView is a no-op on Android (same lesson as App.tsx's
  // FeatureShell), so the wordmark rendered flush under the status bar on-device.
  // Pad by the real inset instead — owner asked for the header to sit lower (2026-07-08).
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.safe}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + space[6] }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          {/* header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.wordmark} maxFontSizeMultiplier={1.4}>LifePilot</Text>
              <Text style={styles.tagline} maxFontSizeMultiplier={1.4}>
                All on-device · nothing leaves your phone
              </Text>
            </View>
            <Pressable
              onPress={() => onNavigate('settings')}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Settings"
              style={({ pressed }) => [styles.gear, pressed && styles.gearPressed]}
            >
              <Text style={styles.gearGlyph}>⚙</Text>
            </Pressable>
          </View>

          {insight && <LifeInsightCard insight={insight} onDismiss={dismissInsight} />}

          {/* feature cards */}
          <View style={styles.cards}>
            {CARDS.map((card) => (
              <FeatureCard key={card.key} card={card} onPress={() => onNavigate(card.key)} />
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

/** The cross-feature insight — Energy + Hydration + Overwhelm talking to each other. */
function LifeInsightCard({ insight, onDismiss }: { insight: LifeInsight; onDismiss: () => void }) {
  return (
    <View style={styles.insightCard} accessibilityRole="summary">
      <View style={styles.insightBody}>
        {insight.sentences.map((s, i) => (
          <Text key={i} style={styles.insightText} maxFontSizeMultiplier={1.4}>{s}</Text>
        ))}
      </View>
      <Pressable
        onPress={onDismiss}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={({ pressed }) => [styles.insightDismiss, pressed && styles.gearPressed]}
      >
        <Text style={styles.insightDismissGlyph}>×</Text>
      </Pressable>
    </View>
  );
}

function FeatureCard({ card, onPress }: { card: Card; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${card.title} — ${card.sub}`}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardLeft}>
        <Text style={styles.cardGlyph} aria-hidden>{card.glyph}</Text>
        <View style={styles.cardText}>
          <Text style={styles.cardTitle} maxFontSizeMultiplier={1.4}>{card.title}</Text>
          <Text style={styles.cardSub} maxFontSizeMultiplier={1.4}>{card.sub}</Text>
        </View>
      </View>
      <Text style={styles.chevron} aria-hidden>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: space[7],
    paddingBottom: space[8],
  },
  content: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: space[7],
  },
  wordmark: {
    ...type.h1,
    color: color.textPrimary,
  },
  tagline: {
    ...type.caption,
    color: color.textTertiary,
    marginTop: space[1],
  },
  gear: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearPressed: { opacity: 0.5 },
  gearGlyph: { fontSize: 22, color: color.textSecondary },
  insightCard: {
    backgroundColor: color.surfaceAlt,
    borderRadius: radii.lg,
    padding: space[4],
    marginBottom: space[5],
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
  },
  insightBody: { flex: 1, gap: space[1] },
  insightText: { ...type.body, color: color.textPrimary },
  insightDismiss: {
    width: 28,
    height: 28,
    marginTop: -space[1],
    marginRight: -space[1],
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightDismissGlyph: { fontSize: 22, color: color.textTertiary, lineHeight: 24 },
  cards: { gap: space[3] },
  card: {
    backgroundColor: color.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: color.border,
    paddingVertical: space[5],
    paddingHorizontal: space[5],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...elevation.e1,
    minHeight: layout.minTouchTarget,
  },
  cardPressed: { backgroundColor: color.surfaceAlt },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: space[4], flex: 1 },
  cardGlyph: { fontSize: 26, color: color.accent, width: 32 },
  cardText: { flex: 1 },
  cardTitle: { ...type.body, fontWeight: '600', color: color.textPrimary },
  cardSub: { ...type.caption, color: color.textSecondary, marginTop: 2 },
  chevron: { fontSize: 22, color: color.textTertiary, marginLeft: space[2] },
});

export default HomeScreen;
