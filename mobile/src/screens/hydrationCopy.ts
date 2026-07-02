/**
 * Hydration Tracker microcopy — from design/hydration/screen-spec.md.
 * Warm, plain, second person. Non-alarmist about AQI. Privacy-forward.
 */
export const HYDRATION_COPY = {
  title: 'Water today',
  ofTarget: (done: string, target: string) => `${done} of ${target}`,
  remaining: (left: string) => `${left} to go`,
  goalMet: 'You hit your goal. Nicely paced.',
  overTarget: "Past your goal — listen to your body, no need to push.",
  whyToday: "Why today's goal",
  addGlass: 'Glass',
  addBottle: 'Bottle',
  addCustom: 'Custom',
  undo: 'Undo',
  // status chips
  statusNormal: 'A normal day',
  statusElevated: 'A bit higher today',
  statusHigh: 'Aim higher today',
  // weather/why one-liners (designer §2)
  whyHotHazy: 'Hot and hazy — aim a little higher.',
  whyHot: "It's warm out — a little extra helps.",
  whyActive: 'You moved a lot — replace what you sweated.',
  whyMild: 'Mild day — your usual is plenty.',
  // privacy
  offlineNote: 'Fully on your device. Live weather is off — your goal uses your saved climate.',
  liveNote: 'Live weather is on (coarse area only — never your exact location).',
  disclaimer: 'A gentle estimate for healthy adults — not medical advice.',
  // states
  settingUp: 'Setting up your day…',
} as const;
