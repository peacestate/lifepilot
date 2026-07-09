/**
 * hydrationStore persistence tests — the user's profile (body mass, weather mode) and
 * today's intake log must survive an app restart; yesterday's log must NOT leak into
 * today. Restart = fresh module registry over the same mock disk.
 */

jest.mock('expo-file-system', () => {
  const g = globalThis as Record<string, unknown>;
  const files = (g.__mockFsFiles as Map<string, string>) ?? new Map<string, string>();
  g.__mockFsFiles = files;
  return {
    documentDirectory: 'file:///docs/',
    readAsStringAsync: async (p: string) => {
      const f = (globalThis as Record<string, unknown>).__mockFsFiles as Map<string, string>;
      if (!f.has(p)) throw new Error('ENOENT');
      return f.get(p) as string;
    },
    writeAsStringAsync: async (p: string, s: string) => {
      ((globalThis as Record<string, unknown>).__mockFsFiles as Map<string, string>).set(p, s);
    },
  };
});

type HydrationStoreModule = typeof import('./hydrationStore');

function freshStore(): HydrationStoreModule['hydrationStore'] {
  let mod: HydrationStoreModule | undefined;
  jest.isolateModules(() => {
    mod = jest.requireActual<HydrationStoreModule>('./hydrationStore');
  });
  return mod!.hydrationStore;
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).__mockFsFiles = new Map<string, string>();
});

describe('hydrationStore persistence', () => {
  it('profile changes survive a restart', async () => {
    const s1 = freshStore();
    await s1.ready();
    s1.setProfile({ bodyMassKg: 82, weatherMode: 'live' });
    await s1.flush();

    const s2 = freshStore();
    await s2.ready();
    expect(s2.getProfile()).toMatchObject({ bodyMassKg: 82, weatherMode: 'live' });
  });

  it("today's intake survives a restart on the same day", async () => {
    const s1 = freshStore();
    await s1.ready();
    s1.addIntake(250);
    s1.addIntake(300);
    await s1.flush();

    const s2 = freshStore();
    await s2.ready();
    expect(s2.loggedMl()).toBe(550);
    expect(s2.getToday()).toHaveLength(2);
  });

  it('removed drinks stay removed after a restart', async () => {
    const s1 = freshStore();
    await s1.ready();
    const e = s1.addIntake(250);
    s1.addIntake(300);
    s1.removeIntake(e.id);
    await s1.flush();

    const s2 = freshStore();
    await s2.ready();
    expect(s2.loggedMl()).toBe(300);
  });

  it("yesterday's log does not leak into today", async () => {
    const s1 = freshStore();
    await s1.ready();
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    s1.addIntake(500, yesterday); // rolls the store's day to yesterday, persists under that key
    await s1.flush();

    const s2 = freshStore();
    await s2.ready();
    expect(s2.loggedMl()).toBe(0); // fresh day, no leak
    expect(s2.getProfile().bodyMassKg).toBe(70); // profile untouched by the roll
  });
});
