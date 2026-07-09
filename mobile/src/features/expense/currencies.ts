/**
 * currencies — full ISO 4217 active currency set + symbol maps for the Expense Scanner.
 *
 * Covers every UN member state's currency (~157 active codes; many countries share one,
 * e.g. EUR / USD / XOF / XAF / XCD). Mirrored 1:1 in ml/test/expense_eval.py — if you
 * add/remove a code or symbol here, change it there too (parity rule, contract §2).
 */

/** Every active ISO 4217 currency code. Used for detection (digit-adjacent only) and
 * for validating manual-entry input. */
export const ISO_CURRENCY_CODES = [
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN',
  'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BRL',
  'BSD', 'BTN', 'BWP', 'BYN', 'BZD',
  'CAD', 'CDF', 'CHF', 'CLP', 'CNY', 'COP', 'CRC', 'CUP', 'CVE', 'CZK',
  'DJF', 'DKK', 'DOP', 'DZD',
  'EGP', 'ERN', 'ETB', 'EUR',
  'FJD', 'FKP',
  'GBP', 'GEL', 'GHS', 'GIP', 'GMD', 'GNF', 'GTQ', 'GYD',
  'HKD', 'HNL', 'HTG', 'HUF',
  'IDR', 'ILS', 'INR', 'IQD', 'IRR', 'ISK',
  'JMD', 'JOD', 'JPY',
  'KES', 'KGS', 'KHR', 'KMF', 'KPW', 'KRW', 'KWD', 'KYD', 'KZT',
  'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD',
  'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR',
  'MWK', 'MXN', 'MYR', 'MZN',
  'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD',
  'OMR',
  'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG',
  'QAR',
  'RON', 'RSD', 'RUB', 'RWF',
  'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP', 'SLE', 'SOS', 'SRD',
  'SSP', 'STN', 'SYP', 'SZL',
  'THB', 'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS',
  'UAH', 'UGX', 'USD', 'UYU', 'UZS',
  'VES', 'VND', 'VUV',
  'WST',
  'XAF', 'XCD', 'XOF', 'XPF',
  'YER',
  'ZAR', 'ZMW', 'ZWG',
] as const;

export const ISO_CODE_SET: ReadonlySet<string> = new Set(ISO_CURRENCY_CODES);

/** Alternation source string for building detection regexes ("AED|AFN|…"). */
export const ISO_CODE_ALTERNATION = ISO_CURRENCY_CODES.join('|');

/** Distinctive currency symbols → ISO code. Ambiguous signs resolve to the most
 * common currency using them ($→USD, ₨/Rs→INR, ¥→JPY). */
export const SYMBOL_TO_CODE: Record<string, string> = {
  '₹': 'INR', '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₩': 'KRW',
  '₺': 'TRY', '₽': 'RUB', '₫': 'VND', '₴': 'UAH', '₦': 'NGN', '₱': 'PHP',
  '฿': 'THB', '₲': 'PYG', '₪': 'ILS', '₡': 'CRC', '₸': 'KZT', '₮': 'MNT',
  '₭': 'LAK', '֏': 'AMD', '₼': 'AZN', '₾': 'GEL', '৳': 'BDT', '₨': 'INR',
  'US$': 'USD', 'R$': 'BRL', 'A$': 'AUD', 'CA$': 'CAD', 'NZ$': 'NZD',
  'HK$': 'HKD', 'NT$': 'TWD', 'S$': 'SGD',
};

/** ISO code → display symbol (falls back to "CODE " prefix when a currency has no
 * widely-recognized single symbol). */
export const CODE_TO_SYMBOL: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', KRW: '₩',
  TRY: '₺', RUB: '₽', VND: '₫', UAH: '₴', NGN: '₦', PHP: '₱', THB: '฿',
  PYG: '₲', ILS: '₪', CRC: '₡', KZT: '₸', MNT: '₮', LAK: '₭', AMD: '֏',
  AZN: '₼', GEL: '₾', BDT: '৳', BRL: 'R$', AUD: 'A$', CAD: 'CA$',
  NZD: 'NZ$', HKD: 'HK$', TWD: 'NT$', SGD: 'S$',
};

/** ISO 4217 zero-decimal currencies — amounts are whole numbers (¥500, ₩5000). */
export const ZERO_DECIMAL_CODES: ReadonlySet<string> = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF',
  'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);
