/**
 * HomeScreen — feature hub. Four cards navigate to each feature; gear opens Settings.
 * Deliberately minimal — no live data, just navigation affordances.
 */
import React from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { color, elevation, layout, radii, space, type } from '../theme/tokens';

export type FeatureKey = 'overwhelm' | 'energy' | 'hydration' | 'expense' | 'healthImport';
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
  {
    key: 'healthImport',
    glyph: '◍',
    title: 'Health Import',
    sub: 'Import your own health PDFs — parsed privately on your phone',
  },
];

export function HomeScreen({ onNavigate }: Props) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
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

          {/* feature cards */}
          <View style={styles.cards}>
            {CARDS.map((card) => (
              <FeatureCard key={card.key} card={card} onPress={() => onNavigate(card.key)} />
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
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
