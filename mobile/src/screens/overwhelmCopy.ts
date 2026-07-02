/**
 * Overwhelm Manager microcopy — verbatim from design/overwhelm/screen-spec.md §4.
 * Single source so the screen stays declarative. Tone rules (§4): warm, plain,
 * second person; never "server/upload/cloud/internet" except to reassure.
 */
export const COPY = {
  promptH1: "What's overwhelming you today?",
  subtext:
    "Type it out. I'll break it into small, doable steps — right here on your phone.",
  placeholder: 'e.g. "Plan my sister\'s birthday next weekend"',
  submitCta: 'Break it down',
  privacyFootnote: 'Runs fully on your device. Nothing is sent anywhere.',
  loadingTitle: 'Thinking this through on your device…',
  loadingOffline: 'Works in airplane mode. Your words never leave this phone.',
  // shown while the model is still loading/warming on first entry (integration §4.5)
  preparingTitle: 'Getting things ready, fully on your device.',
  taskChipLabel: 'You asked:',
  stopButton: 'Stop',
  allComplete: 'Nicely done. You handled it, one step at a time.',
  emptyResult:
    "I couldn't break that one down just now. Let's try again — or tweak the wording.",
  error: "Something hiccuped on this end. Your text is safe — let's try again.",
  retryButton: 'Try again',
  editButton: 'Edit',
  startOverButton: 'Start over',
  // "tap a step to go deeper" feature
  breakDownStepCta: 'Break this into smaller steps',
  breakingDownStep: 'Breaking this down on your device…',
  breakdownEmpty: "This one's already about as small as it gets.",
  breakdownError: "Couldn't split that one — try again.",
} as const;
