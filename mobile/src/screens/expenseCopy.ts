/**
 * OCR Expense microcopy — from design/expense/screen-spec.md. Calm, minimal.
 */
export const EXPENSE_COPY = {
  title: 'Expenses',
  totalThisList: (t: string) => `${t} tracked`,
  empty: 'No receipts yet. Scan one to start — it never leaves your phone.',
  scanCta: 'Scan a receipt',
  reading: 'Reading your receipt, on your device…',
  reviewTitle: 'Looks right?',
  reviewSub: 'Tap any field to fix it. Flagged ones are worth a glance.',
  merchant: 'Where',
  date: 'When',
  amount: 'Amount',
  category: 'Category',
  save: 'Save expense',
  retake: 'Scan again',
  checkThis: 'check this',
  privacy: 'The photo and everything read from it stay on your phone.',
  error: "Couldn't read that one — try another shot, or add it by hand.",

  // Manual entry fallback
  enterManually: 'Enter manually',
  manualTitle: 'Add an expense',
  manualMerchant: 'Merchant',
  manualAmount: 'Amount',
  manualCategory: 'Category',
  manualCurrency: 'Currency',
  manualDate: 'Date',
  manualSubmit: 'Save expense',

  // Review screen — detected line items (read-only)
  itemsDetected: 'Items we spotted',

  // Monthly insights card
  insightsTitle: 'This month',
  insightsTopCategory: (cat: string, pct: number) => `${cat}: ${pct}% — your biggest category`,
  insightsUp: (amount: string) => `Up ${amount} from last month`,
  insightsDown: (amount: string) => `Down ${amount} from last month`,
  insightsFlat: 'About the same as last month',
  insightsProjection: (projected: string, usual: string) =>
    `At this rate you'll spend ${projected} this month vs your ${usual} usual average`,
} as const;
