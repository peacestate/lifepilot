/**
 * download() must reject a file whose *contents* are wrong, not just one whose
 * length is wrong. Two model builds have already collided at the exact same byte
 * size (the pre-AMD and AMD energy models, both 44,512 bytes) — a size-only check
 * activates the stale weights and nothing downstream ever notices. A rejected file
 * must also be deleted, so a later activate() can't see the staged garbage.
 */

jest.mock('expo-file-system', () => {
  const disk = () =>
    (globalThis as Record<string, unknown>).__disk as Map<string, Uint8Array>;
  const origin = () =>
    (globalThis as Record<string, unknown>).__origin as Map<string, Uint8Array>;

  return {
    documentDirectory: 'file:///docs/',
    EncodingType: { Base64: 'base64' },
    getInfoAsync: async (uri: string) => {
      const e = disk().get(uri);
      return e ? { exists: true, uri, size: e.length } : { exists: false, uri };
    },
    makeDirectoryAsync: async () => {},
    deleteAsync: async (uri: string) => {
      disk().delete(uri);
    },
    readAsStringAsync: async (uri: string) => {
      const e = disk().get(uri);
      if (!e) throw new Error(`ENOENT ${uri}`);
      return Buffer.from(e).toString('base64');
    },
    writeAsStringAsync: async (uri: string, data: string) => {
      disk().set(uri, new Uint8Array(Buffer.from(data, 'utf8')));
    },
    downloadAsync: async (url: string, dest: string) => {
      const asset = url.slice(url.lastIndexOf('/') + 1);
      const body = origin().get(asset);
      if (!body) throw new Error(`404 ${url}`);
      disk().set(dest, body);
      return { status: 200, uri: dest };
    },
  };
});

import { createHash } from 'crypto';

import { ModelRegistry } from './ModelRegistry';
import type { ModelDescriptor } from './types';

const g = globalThis as Record<string, unknown>;
const disk = () => g.__disk as Map<string, Uint8Array>;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

const GOOD = new Uint8Array(64).map((_, i) => (i * 13) % 256);
// Same length as GOOD, different bytes — the case a size check waves through.
const STALE = new Uint8Array(64).map((_, i) => (i * 17) % 256);

function descriptor(over?: Partial<ModelDescriptor>): ModelDescriptor {
  return {
    id: 'energy-tcn',
    feature: 'energy',
    version: '1.1.0',
    channel: 'stable',
    executorchVersion: '0.6.0', // matches the bundled runtime pin
    files: { model: 'energy_predictor.pte' },
    bytes: { model: GOOD.length },
    sha256: { model: sha(GOOD) },
    source: { type: 'remote', baseUrl: 'https://example.test/models' },
    ...over,
  };
}

const STAGED = 'file:///docs/models/energy-tcn/1.1.0/energy_predictor.pte';

beforeEach(() => {
  g.__disk = new Map<string, Uint8Array>();
  g.__origin = new Map<string, Uint8Array>([['energy_predictor.pte', GOOD]]);
});

describe('ModelRegistry.download verification', () => {
  it('accepts a file whose size and sha256 both match', async () => {
    await new ModelRegistry().download(descriptor());
    expect(disk().get(STAGED)).toEqual(GOOD);
  });

  it('rejects and deletes a right-size wrong-content file (the stale-weights case)', async () => {
    (g.__origin as Map<string, Uint8Array>).set('energy_predictor.pte', STALE);
    await expect(new ModelRegistry().download(descriptor())).rejects.toThrow(/sha256/);
    expect(disk().has(STAGED)).toBe(false);
  });

  it('rejects and deletes a truncated file by size before hashing', async () => {
    (g.__origin as Map<string, Uint8Array>).set('energy_predictor.pte', GOOD.slice(0, 10));
    await expect(new ModelRegistry().download(descriptor())).rejects.toThrow(/size 10/);
    expect(disk().has(STAGED)).toBe(false);
  });

  it('skips the hash for files past the JS-hashable bound, keeping the size guard', async () => {
    const big = new Uint8Array(9 * 1024 * 1024).map((_, i) => i % 251);
    (g.__origin as Map<string, Uint8Array>).set('energy_predictor.pte', big);
    // Deliberately wrong hash: it must not be consulted for a file this large.
    const d = descriptor({ bytes: { model: big.length }, sha256: { model: sha(GOOD) } });
    await new ModelRegistry().download(d);
    // Cheap equality: toEqual on a 9M-element typed array OOMs the jest worker.
    const staged = disk().get(STAGED);
    expect(staged?.length).toBe(big.length);
    expect(staged?.[1234567]).toBe(big[1234567]);
  });

  it('still verifies by size alone when a descriptor carries no sha256', async () => {
    (g.__origin as Map<string, Uint8Array>).set('energy_predictor.pte', STALE);
    await new ModelRegistry().download(descriptor({ sha256: undefined }));
    // Documents the limitation: without a hash, same-size stale bytes pass.
    expect(disk().get(STAGED)).toEqual(STALE);
  });
});
