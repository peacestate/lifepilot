/**
 * i18n — hand-rolled locale layer, deliberately dependency-free.
 *
 * WHY hand-rolled: an i18n library would mean an npm install into a native tree that
 * is pinned and fragile on purpose (CLAUDE.md "Known pinned/fragile dependencies" —
 * react-native-reanimated must never appear). Locale selection over static copy
 * tables is ~60 lines; that's the cheaper trade, same reasoning as sha256.ts.
 *
 * DESIGN: each *Copy.ts passes its English table plus a (possibly partial) Hindi
 * table to localized(). Reads resolve per-key at ACCESS time against the current
 * locale, falling back to English for any untranslated key — so translation coverage
 * can grow screen by screen without ever showing a blank string. Components keep
 * reading `COPY.foo` statically; a locale change re-renders via App.tsx re-keying
 * the screen tree, so no subscription machinery is needed.
 *
 * The locale itself is an app preference, not user data; it persists to a tiny local
 * JSON file (same pattern as persistence.ts flags). No network anywhere.
 */
import * as FileSystem from 'expo-file-system';

export type Locale = 'en' | 'hi';
export const LOCALES: readonly Locale[] = ['en', 'hi'] as const;

const LOCALE_PATH = `${FileSystem.documentDirectory}lp_locale.json`;

let current: Locale = 'en';

export function getLocale(): Locale {
  return current;
}

/**
 * Load the persisted locale into memory. App.tsx awaits this before leaving the
 * 'loading' screen so the first render of any localized copy is already correct.
 */
export async function loadLocale(): Promise<Locale> {
  try {
    const raw = await FileSystem.readAsStringAsync(LOCALE_PATH);
    const l = (JSON.parse(raw) as { locale?: string }).locale;
    if (l === 'en' || l === 'hi') current = l;
  } catch {
    /* first run — stay on the 'en' default */
  }
  return current;
}

/** Switch locale now and persist it for the next launch. */
export function setLocale(l: Locale): void {
  current = l;
  void FileSystem.writeAsStringAsync(LOCALE_PATH, JSON.stringify({ locale: l })).catch(() => {
    /* persistence is best-effort; the in-memory switch already took effect */
  });
}

/**
 * A copy table whose values follow the current locale. Property reads are live
 * (getter-based), so a table created at module load time still reflects a locale
 * set later — which is exactly the situation for every `export const COPY = ...`.
 */
export function localized<T extends Record<string, string>>(en: T, hi: Partial<T>): T {
  const out = {} as T;
  for (const k of Object.keys(en) as (keyof T & string)[]) {
    Object.defineProperty(out, k, {
      enumerable: true,
      get: () => (current === 'hi' ? (hi[k] ?? en[k]) : en[k]),
    });
  }
  return out;
}
