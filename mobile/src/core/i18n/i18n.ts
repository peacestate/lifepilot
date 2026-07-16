/**
 * i18n — hand-rolled locale layer, deliberately dependency-free.
 *
 * WHY hand-rolled: an i18n library would mean an npm install into a native tree that
 * is pinned and fragile on purpose (CLAUDE.md "Known pinned/fragile dependencies" —
 * react-native-reanimated must never appear). Locale selection over static copy
 * tables is ~80 lines; that's the cheaper trade, same reasoning as sha256.ts.
 *
 * DESIGN: each *Copy.ts passes its English table plus (possibly partial) tables for
 * any other locale to localized(). Reads resolve per-key at ACCESS time against the
 * current locale, falling back to English for any untranslated key — so translation
 * coverage can grow screen by screen without ever showing a blank string. Components
 * keep reading `COPY.foo` statically; a locale change re-renders via App.tsx re-keying
 * the screen tree, so no subscription machinery is needed.
 *
 * WHICH languages: exactly the eight Llama 3.2 officially supports — the Overwhelm
 * Manager generates steps in the app language, so offering a language the on-device
 * model can't write would break the core feature, not just the chrome.
 *
 * The locale itself is an app preference, not user data; it persists to a tiny local
 * JSON file (same pattern as persistence.ts flags). No network anywhere.
 */
import * as FileSystem from 'expo-file-system';

export type Locale = 'en' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'hi' | 'th';

/** Display metadata for the Settings language dropdown, in menu order. */
export const LANGUAGES: readonly { code: Locale; nativeName: string; englishName: string }[] = [
  { code: 'en', nativeName: 'English', englishName: 'English' },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish' },
  { code: 'fr', nativeName: 'Français', englishName: 'French' },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German' },
  { code: 'it', nativeName: 'Italiano', englishName: 'Italian' },
  { code: 'pt', nativeName: 'Português', englishName: 'Portuguese' },
  { code: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi' },
  { code: 'th', nativeName: 'ไทย', englishName: 'Thai' },
] as const;

export const LOCALES: readonly Locale[] = LANGUAGES.map((l) => l.code);

const LOCALE_PATH = `${FileSystem.documentDirectory}lp_locale.json`;

let current: Locale = 'en';

export function getLocale(): Locale {
  return current;
}

function isLocale(l: unknown): l is Locale {
  return typeof l === 'string' && (LOCALES as readonly string[]).includes(l);
}

/**
 * Load the persisted locale into memory. App.tsx awaits this before leaving the
 * 'loading' screen so the first render of any localized copy is already correct.
 */
export async function loadLocale(): Promise<Locale> {
  try {
    const raw = await FileSystem.readAsStringAsync(LOCALE_PATH);
    const l = (JSON.parse(raw) as { locale?: string }).locale;
    if (isLocale(l)) current = l;
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

/** Translation tables for every non-English locale; each may be partial. */
export type Translations<T> = Partial<Record<Exclude<Locale, 'en'>, Partial<T>>>;

/**
 * A copy table whose values follow the current locale. Property reads are live
 * (getter-based), so a table created at module load time still reflects a locale
 * set later — which is exactly the situation for every `export const COPY = ...`.
 */
export function localized<T extends Record<string, string>>(en: T, translations: Translations<T>): T {
  const out = {} as T;
  for (const k of Object.keys(en) as (keyof T & string)[]) {
    Object.defineProperty(out, k, {
      enumerable: true,
      get: () => (current === 'en' ? en[k] : (translations[current]?.[k] ?? en[k])),
    });
  }
  return out;
}
