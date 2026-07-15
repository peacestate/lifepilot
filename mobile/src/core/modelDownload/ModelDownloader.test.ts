/**
 * The download must be resumable *byte-wise*, and these tests exist to prove it costs
 * what it claims to.
 *
 * The model set is 1.5 GB and one 1.2 GB file dominates it. Downloads happen over mobile
 * data, on connections that drop. If an interrupted file restarted from zero, a blip at
 * 90% would re-spend a gigabyte of the user's data — three times over, with retries. So
 * the assertions here are mostly about *bytes transferred*, not just about ending up with
 * the right file: getting the right file by downloading it twice is still a failure.
 *
 * The other half is corruption. Resuming appends to whatever prefix is on disk, so a
 * `.part` left behind by a different model version, or a server that ignores our Range
 * header, could yield a file of exactly the right length whose contents are spliced
 * garbage — which a size check waves through and the native runtime then crashes on.
 */

jest.mock('../../models/downloadCatalog.json', () => {
  const { createHash } = require('crypto') as typeof import('crypto');
  const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

  // Mirrors the real shape: one file far past the hash bound (the Llama's role — size
  // checked only, and the one that makes resume matter), one below it (hash-verified).
  const big = new Uint8Array(9 * 1024 * 1024).map((_, i) => i % 251);
  const small = new Uint8Array(32).map((_, i) => (i * 7) % 256);

  (globalThis as Record<string, unknown>).__origin = new Map([
    ['overwhelm__big.pte', big],
    ['energy__small.pte', small],
  ]);

  return {
    baseUrl: 'https://example.test/dl/',
    totalBytes: big.length + small.length,
    files: [
      { feature: 'overwhelm', target: 'big.pte', asset: 'overwhelm__big.pte', bytes: big.length, sha256: sha(big) },
      { feature: 'energy', target: 'small.pte', asset: 'energy__small.pte', bytes: small.length, sha256: sha(small) },
    ],
  };
});

jest.mock('expo-file-system', () => {
  // No named type alias in here: babel-plugin-jest-hoist reads one as an out-of-scope
  // variable reference and refuses to hoist the factory.
  const disk = () =>
    (globalThis as Record<string, unknown>).__disk as Map<string, { size: number; data: Uint8Array }>;

  return {
    documentDirectory: 'file:///docs/',
    EncodingType: { Base64: 'base64' },
    getInfoAsync: async (uri: string) => {
      const e = disk().get(uri);
      return e ? { exists: true, uri, size: e.size } : { exists: false, uri };
    },
    makeDirectoryAsync: async () => {},
    readDirectoryAsync: async (dir: string) => {
      const names: string[] = [];
      for (const k of disk().keys()) if (k.startsWith(`${dir}/`)) names.push(k.slice(dir.length + 1));
      return names;
    },
    deleteAsync: async (uri: string) => {
      disk().delete(uri);
    },
    moveAsync: async ({ from, to }: { from: string; to: string }) => {
      const e = disk().get(from);
      if (!e) throw new Error(`ENOENT ${from}`);
      disk().set(to, e);
      disk().delete(from);
    },
    readAsStringAsync: async (uri: string) => {
      const e = disk().get(uri);
      if (!e) throw new Error(`ENOENT ${uri}`);
      return Buffer.from(e.data).toString('base64');
    },
    createDownloadResumable: (
      url: string,
      fileUri: string,
      _o: unknown,
      cb: (p: { totalBytesWritten: number }) => void,
      resumeData?: string,
      // `mock`-prefixed names are the one kind of out-of-scope reference the hoist
      // plugin allows, so the fake server is reachable from in here.
    ) => mockNewTask(url, fileUri, cb, resumeData),
  };
});

import { createHash } from 'crypto';

type Entry = { size: number; data: Uint8Array };
type Disk = Map<string, Entry>;
type DownloadTask = {
  downloadAsync: () => Promise<{ status: number; uri: string } | undefined>;
  pauseAsync: () => Promise<{ resumeData: string }>;
};
type NewTask = (
  url: string,
  fileUri: string,
  cb: (p: { totalBytesWritten: number }) => void,
  resumeData?: string,
) => DownloadTask;

/** The fake origin server, reached from inside the jest.mock factory. */
let mockNewTask: NewTask;

type Server = {
  /** Bytes actually put on the wire — the user's data bill. */
  transferred: number;
  /** Drop the connection after this many bytes of the *next* request's body. */
  dropAfter: number | null;
  /** A server (or proxy) that ignores Range and always sends the whole body. */
  ignoreRange: boolean;
  requests: { asset: string; resumeData?: string }[];
};

const DOCS = 'file:///docs/';
const g = globalThis as Record<string, unknown>;
const disk = () => g.__disk as Disk;
const origin = () => g.__origin as Map<string, Uint8Array>;
let server: Server;

/** Installs a fake DownloadResumable that behaves like expo's Android implementation. */
function installServer(): Server {
  server = { transferred: 0, dropAfter: null, ignoreRange: false, requests: [] };

  mockNewTask = (url, fileUri, cb, resumeData) => {
    let cancelled = false;
    return {
      pauseAsync: async () => {
        cancelled = true;
        return { resumeData: String(disk().get(fileUri)?.size ?? 0) };
      },
      downloadAsync: async () => {
        const asset = url.slice('https://example.test/dl/'.length);
        server.requests.push({ asset, resumeData });
        const body = origin().get(asset);
        if (!body) return { status: 404, uri: fileUri };

        // Native opens the file in append mode exactly when resumeData was supplied.
        const isResume = resumeData != null;
        const prefix = isResume ? (disk().get(fileUri)?.data ?? new Uint8Array()) : new Uint8Array();

        // Range honoured -> only the remainder is sent. Ignored -> the whole body is sent
        // and appended onto the prefix, which is how a size-correct corrupt file is born.
        const offset = isResume && !server.ignoreRange ? Number(resumeData) : 0;
        const chunk = body.slice(offset);

        const limit = server.dropAfter;
        server.dropAfter = null;

        // Stream it, like OkHttp does: bytes land on disk as they arrive, so a drop or a
        // cancel leaves a genuine partial file behind rather than all-or-nothing.
        const buf = new Uint8Array(prefix.length + chunk.length);
        buf.set(prefix);
        let len = prefix.length;
        let sent = 0;
        const commit = () => disk().set(fileUri, { size: len, data: buf.subarray(0, len) });
        commit();

        const STEP = 1024 * 1024;
        while (sent < chunk.length) {
          if (cancelled) return undefined; // expo resolves undefined for a cancelled task
          if (limit != null && sent >= limit) throw new Error('network dropped');

          const room = limit == null ? STEP : Math.min(STEP, limit - sent);
          const n = Math.min(room, chunk.length - sent);
          buf.set(chunk.subarray(sent, sent + n), len);
          len += n;
          sent += n;
          server.transferred += n;
          commit();
          cb({ totalBytesWritten: len });
          await Promise.resolve(); // yield, so a cancel from the progress handler can land
        }

        if (cancelled) return undefined;
        return { status: isResume && !server.ignoreRange ? 206 : 200, uri: fileUri };
      },
    };
  };
  return server;
}

type Mod = typeof import('./ModelDownloader');
/** A fresh module over the same mock disk — i.e. the app relaunching mid-setup. */
function relaunch(): Mod {
  let mod: Mod | undefined;
  jest.isolateModules(() => {
    mod = jest.requireActual<Mod>('./ModelDownloader');
  });
  return mod!;
}

/**
 * Compare files by digest, not by deep-equality on the bytes: jest's toEqual walks a
 * 9 MB typed array element by element and exhausts the heap.
 */
const digest = (u: Uint8Array) => createHash('sha256').update(u).digest('hex');

const BIG = `${DOCS}models/overwhelm/big.pte`;
const SMALL = `${DOCS}models/energy/small.pte`;
const bigBody = () => origin().get('overwhelm__big.pte')!;
const totalBytes = () => bigBody().length + origin().get('energy__small.pte')!.length;

beforeEach(() => {
  g.__disk = new Map<string, Entry>();
  installServer();
});

describe('ModelDownloader', () => {
  it('downloads every file once and puts the right bytes in place', async () => {
    const { downloadModels, areModelsReady } = relaunch();
    await downloadModels();

    expect(await areModelsReady()).toBe(true);
    expect(digest(disk().get(BIG)!.data)).toBe(digest(bigBody()));
    expect(server.transferred).toBe(totalBytes());
    // Nothing left half-written for a provisioner to trip over.
    expect([...disk().keys()].filter((k) => k.endsWith('.part'))).toEqual([]);
  });

  it('resumes a dropped file instead of re-downloading it', async () => {
    const { downloadModels } = relaunch();
    const cut = 6 * 1024 * 1024; // die partway through the big file
    server.dropAfter = cut;

    await downloadModels();

    // The whole point: the dropped file's bytes are paid for exactly once.
    expect(server.transferred).toBe(totalBytes());
    expect(digest(disk().get(BIG)!.data)).toBe(digest(bigBody()));

    const retry = server.requests.find((r) => r.asset === 'overwhelm__big.pte' && r.resumeData != null);
    expect(retry?.resumeData).toBe(String(cut)); // asked for exactly the remainder
  });

  it('resumes across an app restart, and only bills the remainder', async () => {
    const first = relaunch();
    const cut = 5 * 1024 * 1024;

    // Stop the run outright partway through the big file — the user backgrounding the app
    // and Android killing it, rather than a blip the retry loop heals on its own.
    await expect(
      first.downloadModels((p) => {
        if (p.receivedBytes >= cut) first.cancelDownload();
      }),
    ).rejects.toThrow();

    const spentBefore = server.transferred;
    expect(spentBefore).toBeLessThan(bigBody().length); // we really did stop early

    // App relaunches. The .part on disk is the only state that carried over.
    const after = relaunch();
    const { missingBytes } = await after.getMissing();
    expect(missingBytes).toBe(totalBytes() - spentBefore); // quotes what's left, not 1.5 GB

    const seen: { receivedBytes: number; totalBytes: number; fraction: number }[] = [];
    await after.downloadModels((p) => seen.push(p));

    expect(await after.areModelsReady()).toBe(true);
    expect(digest(disk().get(BIG)!.data)).toBe(digest(bigBody()));
    expect(server.transferred).toBe(totalBytes()); // still paid for exactly once, in total

    // The bar is anchored to the whole set and already reflects the earlier run's bytes.
    // Reporting "0 of <remainder>" here is what makes a resumed user think their progress
    // was thrown away.
    expect(seen[0].totalBytes).toBe(totalBytes());
    expect(seen[0].receivedBytes).toBeGreaterThanOrEqual(spentBefore);
    expect(seen[0].fraction).toBeGreaterThan(0);
    expect(seen[seen.length - 1].receivedBytes).toBe(totalBytes());
    expect(seen[seen.length - 1].fraction).toBe(1);
  });

  it('never resumes onto a part left by a different model version', async () => {
    // A part from an older release: right target, different content. Appending the new
    // remainder onto it would give a right-sized, quietly wrong file — and the big files
    // are too large to hash on device, so nothing downstream would ever catch it.
    const stale = new Uint8Array(4 * 1024 * 1024).fill(0xff);
    disk().set(`${BIG}.deadbeefcafe.part`, { size: stale.length, data: stale });

    const { downloadModels } = relaunch();
    await downloadModels();

    expect(digest(disk().get(BIG)!.data)).toBe(digest(bigBody()));
    expect(server.transferred).toBe(totalBytes()); // fetched whole, never resumed from junk
    expect([...disk().keys()].filter((k) => k.includes('.part'))).toEqual([]); // and swept
  });

  it('recovers when the server ignores Range and sends the whole body', async () => {
    const { downloadModels } = relaunch();
    server.dropAfter = 3 * 1024 * 1024;
    server.ignoreRange = true;

    await downloadModels();

    // The spliced part is thrown away and the file re-fetched clean, rather than a
    // prefix+body frankenfile being moved into place.
    expect(digest(disk().get(BIG)!.data)).toBe(digest(bigBody()));
    expect(await relaunch().areModelsReady()).toBe(true);
  });

  it('rejects a small file whose contents fail the hash, and refetches it', async () => {
    // Same size, wrong bytes — the exact shape of the stale-model bug that shipped once.
    // Tamper *after* relaunch: re-requiring the catalog re-runs its factory and would
    // otherwise restore the pristine body.
    const { downloadModels } = relaunch();
    origin().set('energy__small.pte', new Uint8Array(32).fill(9));
    await expect(downloadModels()).rejects.toThrow(/sha256/);
    expect(disk().has(SMALL)).toBe(false); // never moved into place
  });

  it('scopes to a feature subset: fetching only energy never touches the Llama', async () => {
    const m = relaunch();
    const small = origin().get('energy__small.pte')!;

    const seen: { totalBytes: number; fraction: number }[] = [];
    await m.downloadModels((p) => seen.push(p), ['energy']);

    expect(await m.areModelsReady(['energy'])).toBe(true);
    expect(await m.areModelsReady()).toBe(false); // the big bundle is still deferred
    expect(disk().has(BIG)).toBe(false);
    expect(server.transferred).toBe(small.length); // not one byte of the Llama billed

    // Progress and quotes anchor to the subset, not the whole 1.5 GB set.
    expect(seen[0].totalBytes).toBe(small.length);
    expect(seen[seen.length - 1].fraction).toBe(1);
    expect((await m.getMissing(['energy'])).missingBytes).toBe(0);
  });

  it('leaves nothing behind that a provisioner could load half-written', async () => {
    const { downloadModels } = relaunch();
    server.dropAfter = 1024;
    await downloadModels();
    // The final path only ever appears at full size.
    expect(disk().get(BIG)!.size).toBe(bigBody().length);
  });
});
