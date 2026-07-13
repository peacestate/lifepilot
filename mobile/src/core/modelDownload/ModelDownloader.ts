/**
 * ModelDownloader — fetch the on-device models once, on first run.
 *
 * WHY: the models are ~1.5 GB (a 1B-parameter Llama dominates), far past what an
 * APK can carry. Before this existed the only way to provision them was `adb push`
 * from a computer (RUNBOOK.md) — fine for a reviewer, impossible for a normal user.
 *
 * PRIVACY — this does not weaken the guarantee. The download is model-in-only: it
 * issues plain GETs for immutable model weights on a public GitHub Release and
 * sends nothing about the user (no id, no telemetry, no request body, no cookies).
 * It is the same posture as ModelRegistry's update check. Once the files are on
 * disk the app never needs the network again — inference is 100% local, and every
 * feature works in airplane mode forever after.
 *
 * DESIGN
 * - Writes to `${documentDirectory}models/<feature>/<filename>` — byte-for-byte the
 *   same paths the provisioners already read and the adb route already writes. A
 *   device provisioned by either route needs nothing from the other.
 * - Idempotent + resumable at file granularity: a file already on disk at the
 *   catalogued size is skipped, so an interrupted run continues rather than restarts.
 * - Atomic per file: downloads to `<name>.part`, verifies the byte size, and only
 *   then moves it into place. A half-written `.pte` can never be seen by a
 *   provisioner, which would otherwise hand a truncated file to the native runtime
 *   and hard-crash it.
 * - Verification is by byte size, matching what the provisioners do. The catalog
 *   also carries each file's sha256 (checked at publish time by
 *   scripts/build-model-catalog.js); hashing 1.2 GB in JS on a phone is far too slow
 *   to do on a launch path.
 */

import * as FileSystem from 'expo-file-system';

import catalog from '../../models/downloadCatalog.json';

export type CatalogFile = {
  feature: string;
  target: string;
  asset: string;
  bytes: number;
  sha256: string;
};

export type DownloadProgress = {
  /** 1-based index of the file being fetched. */
  fileIndex: number;
  totalFiles: number;
  /** Feature the current file belongs to, e.g. "overwhelm". */
  feature: string;
  /** Bytes fetched across the whole run (excludes files already present). */
  receivedBytes: number;
  /** Bytes still to fetch when the run started. */
  totalBytes: number;
  /** 0..1 across the whole run. */
  fraction: number;
};

export class ModelDownloadError extends Error {
  constructor(detail: string) {
    super(`Model download failed: ${detail}`);
    this.name = 'ModelDownloadError';
  }
}

const FILES = catalog.files as CatalogFile[];
const BASE_URL = catalog.baseUrl as string;
const MAX_ATTEMPTS = 3;

function dirFor(feature: string): string {
  const base = FileSystem.documentDirectory;
  if (!base) throw new ModelDownloadError('FileSystem.documentDirectory unavailable.');
  return `${base}models/${feature}`;
}

const uriFor = (f: CatalogFile) => `${dirFor(f.feature)}/${f.target}`;

/** True when the file is present at exactly the catalogued size. */
async function isPresent(f: CatalogFile): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(uriFor(f), { size: true });
  return info.exists && info.size === f.bytes;
}

/** Which model files are still missing (or truncated), and how many bytes that is. */
export async function getMissing(): Promise<{ missing: CatalogFile[]; missingBytes: number }> {
  const flags = await Promise.all(FILES.map(isPresent));
  const missing = FILES.filter((_, i) => !flags[i]);
  return { missing, missingBytes: missing.reduce((n, f) => n + f.bytes, 0) };
}

/** True when every model the app needs is on disk. */
export async function areModelsReady(): Promise<boolean> {
  const { missing } = await getMissing();
  return missing.length === 0;
}

/** Total size of the full model set, for UI copy ("needs 1.5 GB"). */
export const TOTAL_BYTES: number = catalog.totalBytes as number;

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}

let cancelled = false;
/** Abort an in-flight run. The next file boundary stops; partial files are kept for resume. */
export function cancelDownload(): void {
  cancelled = true;
}

async function downloadOne(f: CatalogFile, onBytes: (delta: number) => void): Promise<void> {
  const dir = dirFor(f.feature);
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {
    /* already exists */
  });

  const finalUri = uriFor(f);
  const partUri = `${finalUri}.part`;
  // A stale .part from a previous failed attempt would corrupt this one.
  await FileSystem.deleteAsync(partUri, { idempotent: true }).catch(() => {});

  let lastWritten = 0;
  const task = FileSystem.createDownloadResumable(
    `${BASE_URL}${f.asset}`,
    partUri,
    {},
    ({ totalBytesWritten }) => {
      onBytes(totalBytesWritten - lastWritten);
      lastWritten = totalBytesWritten;
    },
  );

  const result = await task.downloadAsync();
  if (!result) throw new ModelDownloadError(`${f.asset}: download returned no result.`);
  if (result.status !== 200) {
    await FileSystem.deleteAsync(partUri, { idempotent: true }).catch(() => {});
    throw new ModelDownloadError(`${f.asset}: HTTP ${result.status}.`);
  }

  const info = await FileSystem.getInfoAsync(partUri, { size: true });
  if (!info.exists || info.size !== f.bytes) {
    await FileSystem.deleteAsync(partUri, { idempotent: true }).catch(() => {});
    throw new ModelDownloadError(
      `${f.asset}: got ${info.exists ? info.size : 0} bytes, expected ${f.bytes} (truncated or interrupted).`,
    );
  }

  // Only now is the file safe for a provisioner to see.
  await FileSystem.deleteAsync(finalUri, { idempotent: true }).catch(() => {});
  await FileSystem.moveAsync({ from: partUri, to: finalUri });
}

/**
 * Download every missing model file, sequentially. Resolves once they're all on
 * disk (resolving immediately if they already were). Sequential rather than
 * parallel on purpose: these are large files on a phone, and several concurrent
 * multi-hundred-MB writes is how you get an out-of-memory kill on a mid-range device.
 */
export async function downloadModels(onProgress?: (p: DownloadProgress) => void): Promise<void> {
  cancelled = false;

  const { missing, missingBytes } = await getMissing();
  if (missing.length === 0) return;

  let received = 0;
  const emit = (fileIndex: number, feature: string) =>
    onProgress?.({
      fileIndex,
      totalFiles: missing.length,
      feature,
      receivedBytes: received,
      totalBytes: missingBytes,
      fraction: missingBytes > 0 ? Math.min(received / missingBytes, 1) : 1,
    });

  for (let i = 0; i < missing.length; i++) {
    const f = missing[i];
    if (cancelled) throw new ModelDownloadError('cancelled.');

    emit(i + 1, f.feature);
    const atFileStart = received;

    let lastErr: unknown;
    let ok = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
      try {
        // Each retry restarts this file, so rewind the counter to avoid
        // double-counting the bytes the failed attempt already reported.
        received = atFileStart;
        await downloadOne(f, (delta) => {
          received += delta;
          emit(i + 1, f.feature);
        });
        ok = true;
      } catch (e) {
        lastErr = e;
        if (cancelled) throw new ModelDownloadError('cancelled.');
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 1000 * attempt)); // linear backoff
        }
      }
    }

    if (!ok) {
      const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
      throw new ModelDownloadError(`${f.asset} failed after ${MAX_ATTEMPTS} attempts — ${detail}`);
    }

    received = atFileStart + f.bytes; // exact, in case progress callbacks under-reported
    emit(i + 1, f.feature);
  }
}
