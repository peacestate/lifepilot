/**
 * Network-ban for the Overwhelm feature (integration doc §5.1).
 *
 * The privacy promise is enforced in code, not just policy: there is NOTHING for
 * this feature to call. User input + model output never leave the device.
 *
 * STATUS: these `overrides` were never merged into a main ESLint config (the app
 * has none — `eslint .` has no config to load). The ban is instead enforced by
 * `src/features/overwhelm/networkBan.test.ts`, which scans every source file in
 * the feature for the same primitives and fails `npm test` on any hit. That test
 * is the live check; this file is kept as the rule's canonical statement, ready
 * to drop into an ESLint config if one is ever added.
 */
module.exports = {
  overrides: [
    {
      files: [
        'src/features/overwhelm/**/*.{ts,tsx}',
        'src/screens/Overwhelm*.{ts,tsx}',
        'src/screens/overwhelmCopy.ts',
        'src/components/{OverwhelmInput,PrimaryButton,SecondaryButton,TaskSummary,PulseIndicator,StepProgress,StepList,StepItem,StepCheckbox,MessageBlock,PrivacyFootnote}.{ts,tsx}',
      ],
      rules: {
        'no-restricted-globals': [
          'error',
          { name: 'fetch', message: 'No network in the Overwhelm feature (golden rule).' },
          { name: 'XMLHttpRequest', message: 'No network in the Overwhelm feature (golden rule).' },
          { name: 'WebSocket', message: 'No network in the Overwhelm feature (golden rule).' },
        ],
        'no-restricted-imports': [
          'error',
          {
            paths: [
              { name: 'axios', message: 'No HTTP client in the Overwhelm feature.' },
              { name: 'node-fetch', message: 'No HTTP client in the Overwhelm feature.' },
            ],
            patterns: [
              { group: ['**/api/*', '**/network/*'], message: 'No network layer in the Overwhelm feature.' },
            ],
          },
        ],
        'no-restricted-properties': [
          'error',
          { object: 'navigator', property: 'sendBeacon', message: 'No telemetry of user content.' },
        ],
      },
    },
  ],
};
