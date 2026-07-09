/**
 * expenseStore + expenseCategorizor persistence tests — simulate an app restart
 * (fresh module registry, same "disk") and assert nothing the user saved or taught
 * is lost. The expo-file-system mock is an in-memory Map standing in for the
 * sandboxed documentDirectory.
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

type ExpenseStoreModule = typeof import('./expenseStore');
type CategorizorModule = typeof import('./expenseCategorizor');

/** "Restart the app": a fresh module registry reading the same mock disk. */
function freshExpenseStore(): ExpenseStoreModule['expenseStore'] {
  let mod: ExpenseStoreModule | undefined;
  jest.isolateModules(() => {
    mod = jest.requireActual<ExpenseStoreModule>('./expenseStore');
  });
  return mod!.expenseStore;
}

function freshCategorizor(): CategorizorModule['expenseCategorizor'] {
  let mod: CategorizorModule | undefined;
  jest.isolateModules(() => {
    mod = jest.requireActual<CategorizorModule>('./expenseCategorizor');
  });
  return mod!.expenseCategorizor;
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).__mockFsFiles = new Map<string, string>();
});

describe('expenseStore persistence', () => {
  it('saved records survive a restart', async () => {
    const s1 = freshExpenseStore();
    await s1.ready();
    s1.add({ merchant: 'Max Health Hospital', dateISO: '2026-07-08', amount: 750, currency: 'INR', category: 'Health' });
    await s1.flush();

    const s2 = freshExpenseStore();
    await s2.ready();
    expect(s2.all()).toHaveLength(1);
    expect(s2.all()[0]).toMatchObject({ merchant: 'Max Health Hospital', amount: 750, currency: 'INR' });
  });

  it('removals survive a restart', async () => {
    const s1 = freshExpenseStore();
    await s1.ready();
    const kept = s1.add({ merchant: 'Cafe', dateISO: null, amount: 5, currency: 'USD', category: 'Food' });
    const gone = s1.add({ merchant: 'Oops', dateISO: null, amount: 1, currency: 'USD', category: 'Other' });
    s1.remove(gone.id);
    await s1.flush();

    const s2 = freshExpenseStore();
    await s2.ready();
    expect(s2.all().map((r) => r.id)).toEqual([kept.id]);
  });

  it('a record added before the disk load resolves is not lost', async () => {
    const s1 = freshExpenseStore();
    await s1.ready();
    s1.add({ merchant: 'Old', dateISO: null, amount: 1, currency: 'USD', category: 'Other' });
    await s1.flush();

    const s2 = freshExpenseStore();
    s2.add({ merchant: 'New', dateISO: null, amount: 2, currency: 'USD', category: 'Other' }); // before ready()
    await s2.ready();
    expect(s2.all().map((r) => r.merchant).sort()).toEqual(['New', 'Old']);
  });
});

describe('expenseCategorizor persistence', () => {
  it('a locked merchant→category mapping survives a restart', async () => {
    const c1 = freshCategorizor();
    await c1.ready();
    c1.recordCorrection('Max Health Hospital', 'Other', 'Health');
    c1.recordCorrection('Max Health Hospital', 'Other', 'Health');
    c1.recordCorrection('Max Health Hospital', 'Other', 'Health'); // 3rd → locks
    expect(c1.suggest('max health hospital')).toBe('Health');
    await c1.flush();

    const c2 = freshCategorizor();
    await c2.ready();
    expect(c2.suggest('Max Health Hospital')).toBe('Health');
  });

  it('pending (not-yet-locked) corrections survive a restart and complete the lock', async () => {
    const c1 = freshCategorizor();
    await c1.ready();
    c1.recordCorrection('Cafe Mumbai', 'Other', 'Food');
    c1.recordCorrection('Cafe Mumbai', 'Other', 'Food');
    await c1.flush();

    const c2 = freshCategorizor();
    await c2.ready();
    expect(c2.suggest('Cafe Mumbai')).toBeNull(); // not locked yet
    c2.recordCorrection('Cafe Mumbai', 'Other', 'Food'); // 3rd, after "restart"
    expect(c2.suggest('Cafe Mumbai')).toBe('Food');
  });
});
