/**
 * The i18n layer's one hard requirement: a partially translated table must never
 * show a blank — untranslated keys fall back to English, and tables created at
 * module load time still follow a locale set later (getter-based reads).
 */

jest.mock('expo-file-system', () => {
  const files = new Map<string, string>();
  return {
    documentDirectory: 'file:///docs/',
    readAsStringAsync: async (uri: string) => {
      const v = files.get(uri);
      if (v == null) throw new Error(`ENOENT ${uri}`);
      return v;
    },
    writeAsStringAsync: async (uri: string, data: string) => {
      files.set(uri, data);
    },
  };
});

import { getLocale, loadLocale, localized, setLocale, LOCALES } from './i18n';

afterEach(() => setLocale('en'));

describe('i18n', () => {
  it('defaults to English and switches live, even for tables built before the switch', () => {
    const COPY = localized({ greet: 'Hello', bye: 'Bye' }, { hi: { greet: 'नमस्ते' } });

    expect(getLocale()).toBe('en');
    expect(COPY.greet).toBe('Hello');

    setLocale('hi');
    expect(COPY.greet).toBe('नमस्ते');
  });

  it('resolves each locale to its own table', () => {
    const COPY = localized(
      { greet: 'Hello' },
      { es: { greet: 'Hola' }, fr: { greet: 'Bonjour' }, pt: { greet: 'Olá' } },
    );
    setLocale('es');
    expect(COPY.greet).toBe('Hola');
    setLocale('fr');
    expect(COPY.greet).toBe('Bonjour');
    setLocale('pt');
    expect(COPY.greet).toBe('Olá');
  });

  it('falls back to English per-key when a translation is missing', () => {
    const COPY = localized({ greet: 'Hello', bye: 'Bye' }, { hi: { greet: 'नमस्ते' } });
    setLocale('hi');
    expect(COPY.bye).toBe('Bye'); // untranslated key — never blank

    setLocale('de'); // locale with NO table at all — every key falls back
    expect(COPY.greet).toBe('Hello');
  });

  it('persists the chosen locale and loadLocale reads it back', async () => {
    setLocale('pt');
    await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget write land
    expect(await loadLocale()).toBe('pt'); // what the next launch would resolve
  });

  it('loadLocale stays on a known locale when nothing was ever persisted', async () => {
    // the mock file store starts empty per test file; read errors must not throw
    expect(LOCALES).toContain(await loadLocale());
  });
});
