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
  // §5 personalization check-in (docs/energy-predictor-model-contract.md §5.1) — a light
  // 1-tap signal so the forecast can learn this person's own bias over time.
  checkInPrompt: "How's your energy right now?",
  checkInLow: 'Low',
  checkInOk: 'OK',
  checkInHigh: 'High',
  checkInThanks: 'Got it — this helps tune your forecast.',
  // Manual entry fallback (Health Connect has no data, or the user chooses to log by hand)
  manualEntryTitle: "Let's get your forecast started",
  manualEntryIntro: "We couldn't find sleep or step data yet — no problem, just tell us:",
  manualSleepLabel: 'What time did you sleep? (24h, e.g. 23:00)',
  manualWakeLabel: 'What time did you wake up? (24h, e.g. 07:00)',
  manualStepsLabel: 'Roughly how many steps today?',
  manualSubmit: 'Get my forecast',
  manualSkip: 'Skip for now — use a general estimate',
  enterManually: 'Enter today manually',
  // step 7 — transparency panel ("Based on: ✅ Sleep... ⚠️ ...")
  basedOnTitle: 'Based on',
  sleepMeasured: (h: string) => `Sleep: ${h} last night`,
  sleepEstimated: 'Sleep: estimated from your recent nights',
  sleepMissing: 'Sleep: no data yet',
  stepsMeasured: (n: string) => `Steps: ${n} yesterday`,
  stepsEstimated: 'Steps: estimated from your recent days',
  stepsMissing: 'Steps: no data yet',
  heartRateMeasured: (bpm: number) => `Resting heart rate: ${bpm} bpm`,
  heartRateMissing: 'Resting heart rate: unavailable',
  // step 8 — Monday weekly health insight card
  weeklyHealthTitle: 'Last week',
  weeklySleepBelow: (avg: string, target: string) => `Average sleep: ${avg} (below your ${target} target)`,
  weeklySleepAt: (avg: string, target: string) => `Average sleep: ${avg} (at your ${target} target)`,
  weeklySleepAbove: (avg: string, target: string) => `Average sleep: ${avg} (above your ${target} target)`,
  weeklyStepsGood: (avg: string, baseline: string) => `Average steps: ${avg} (good — above ${baseline} baseline)`,
  weeklyStepsBelow: (avg: string, baseline: string) => `Average steps: ${avg} (below ${baseline} baseline)`,
  weeklyHRImproving: (delta: number) => `Resting heart rate trend: improving (${delta} bpm vs last week)`,
  weeklyHRWorsening: (delta: number) => `Resting heart rate trend: up ${delta} bpm vs last week`,
  weeklyHRSteady: 'Resting heart rate trend: steady vs last week',
  weeklyBestWorstEnergy: (best: string, worst: string) => `Your best energy day: ${best}. Your worst: ${worst}.`,
  weeklySleepUplift: (pct: number) => `Your energy is ${pct}% higher on days you sleep 7+ hours`,
} as const;
