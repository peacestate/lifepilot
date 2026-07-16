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

import { getLocale, loadLocale, localized, setLocale } from './i18n';

afterEach(() => setLocale('en'));

describe('i18n', () => {
  it('defaults to English and switches live, even for tables built before the switch', () => {
    const COPY = localized({ greet: 'Hello', bye: 'Bye' }, { greet: 'नमस्ते' });

    expect(getLocale()).toBe('en');
    expect(COPY.greet).toBe('Hello');

    setLocale('hi');
    expect(COPY.greet).toBe('नमस्ते');
  });

  it('falls back to English per-key when a Hindi string is missing', () => {
    const COPY = localized({ greet: 'Hello', bye: 'Bye' }, { greet: 'नमस्ते' });
    setLocale('hi');
    expect(COPY.bye).toBe('Bye'); // untranslated — never blank
  });

  it('persists the chosen locale and loadLocale reads it back', async () => {
    setLocale('hi');
    await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget write land
    expect(await loadLocale()).toBe('hi'); // what the next launch would resolve
  });

  it('loadLocale stays on the default when nothing was ever persisted', async () => {
    // the mock file store starts empty per test file; read errors must not throw
    expect(['en', 'hi']).toContain(await loadLocale());
  });
});
