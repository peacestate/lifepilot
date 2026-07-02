/**
 * Energy Predictor microcopy — from design/energy/screen-spec.md. Warm, second person,
 * never clinical. Energy is shown as shape + words, not numbers.
 */
export const ENERGY_COPY = {
  title: 'Your energy today',
  calibratingTitle: 'Learning your rhythm',
  calibrating: (have: number, need: number) =>
    `${have} of ${need} nights collected. A clearer forecast is on the way.`,
  peakLead: 'You usually peak around',
  dipLead: 'and dip around',
  focusCard: 'Best focus',
  restCard: 'Wind down',
  windowRange: (a: string, b: string) => `${a} – ${b}`,
  insightDip: (t: string) => `Your energy tends to dip around ${t} — plan lighter work then.`,
  insightPeak: (t: string) => `Around ${t} is your sweet spot for anything that needs focus.`,
  privacy: 'Your sleep and activity stay on your device. Nothing is sent anywhere.',
  basisEstimate: 'Early estimate — improves as it learns your week.',
  settingUp: 'Reading your last few days…',
} as const;
