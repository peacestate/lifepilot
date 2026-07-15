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
 * - Atomic per file: downloads to a `.part` sidecar, verifies it, and only then moves
 *   it into place. A half-written `.pte` can never be seen by a provisioner, which
 *   would otherwise hand a truncated file to the native runtime and hard-crash it.
 * - Resumable *byte-wise*, not just file-wise. A dropped connection keeps the `.part`
 *   and the next attempt re-requests only the remainder (`Range: bytes=<n>-`). This
 *   matters more than it sounds: the set is 1.5 GB and one 1.2 GB file dominates it,
 *   so restarting that file on a blip means re-spending a gigabyte of someone's mobile
 *   data — and this app is downloaded over mobile data. The resume offset is simply the
 *   `.part`'s size on disk, so it survives the app being killed mid-download too.
 * - Verification is by byte size, matching what the provisioners do. The catalog
 *   also carries each file's sha256 (checked at publish time by
 *   scripts/build-model-catalog.js); hashing 1.2 GB in JS on a phone is far too slow
 *   to do on a launch path.
 */

import * as FileSystem from 'expo-file-system';

import catalog from '../../models/downloadCatalog.json';
import { base64ToBytes, sha256 } from './sha256';

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
  /**
   * Bytes of the model set now on disk — *including* whatever an earlier run left behind.
   *
   * Quoted against the whole set, not against what's left to fetch. Someone who already
   * pulled 250 MB and comes back must see "17% of 1.52 GB", not "3% of 1.26 GB": the
   * latter reads as if their download restarted, which is the exact anxiety this screen
   * exists to avoid.
   */
  receivedBytes: number;
  /** Size of the whole model set — constant across runs. */
  totalBytes: number;
  /** 0..1 across the whole model set. */
  fraction: number;
  /** Bytes actually pulled from the network in this run — i.e. the data this run cost. */
  fetchedBytes: number;
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

/**
 * Feature groups for lazy provisioning. CORE is what the app needs to open at all —
 * a few hundred KB, near-instant even on mobile data. The Overwhelm bundle (the 1B
 * Llama plus its embeddings and Whisper voice models) is ~1.5 GB and is fetched the
 * first time the Overwhelm Manager is opened, not up front: someone who only wants
 * the Hydration Tracker never pays for the Llama.
 */
export const CORE_FEATURES: readonly string[] = ['energy', 'hydration', 'expense'];
export const OVERWHELM_FEATURES: readonly string[] = ['overwhelm', 'embeddings', 'voice'];

const filesFor = (features?: readonly string[]): CatalogFile[] =>
  features ? FILES.filter((f) => features.includes(f.feature)) : FILES;

/** Total size of a feature subset (or the whole set), for UI copy and progress. */
export function totalBytesFor(features?: readonly string[]): number {
  return filesFor(features).reduce((n, f) => n + f.bytes, 0);
}

/**
 * Files at or under this size are checked by sha256; larger ones by byte size alone.
 *
 * Size is not a sufficient check. The pre-AMD energy model and the AMD-trained one
 * are both exactly 44,512 bytes — a size check accepts the stale file forever, and
 * real devices were found in exactly that state, silently running the wrong weights.
 * All four trained `.pte` models are far below this bound, so the ones where
 * provenance actually matters are always hash-verified.
 *
 * The bound exists because the big files can't be hashed here: reading a 1.2 GB
 * .pte into JS as base64 to digest it would blow memory and take minutes on a
 * launch path. Those rely on size plus the fact that a truncated download is
 * discarded before it's ever moved into place.
 */
const HASH_MAX_BYTES = 8 * 1024 * 1024;

/** sha256 of a file already on disk. Only call for files <= HASH_MAX_BYTES. */
async function hashFile(uri: string): Promise<string> {
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return sha256(base64ToBytes(b64));
}

function dirFor(feature: string): string {
  const base = FileSystem.documentDirectory;
  if (!base) throw new ModelDownloadError('FileSystem.documentDirectory unavailable.');
  return `${base}models/${feature}`;
}

const uriFor = (f: CatalogFile) => `${dirFor(f.feature)}/${f.target}`;

/**
 * The partial download for a file, named for the *content* it is accumulating.
 *
 * Resuming appends to whatever prefix is already on disk, so resuming onto a `.part`
 * left by a different model version would append new bytes to a stale prefix and
 * produce a file that is the right length and quietly wrong. Naming the part after the
 * expected sha means a part from another version simply isn't a resume candidate — it
 * has a different name, and gets swept by discardStaleParts.
 */
const partUriFor = (f: CatalogFile) => `${uriFor(f)}.${f.sha256.slice(0, 12)}.part`;

/**
 * How many bytes of `f` are already downloaded and safe to resume from.
 *
 * A part at or past the full size is not a resume point — it's junk (e.g. a server that
 * ignored our Range header and sent the whole body, which the native side appended).
 * Report 0 so the caller restarts the file clean.
 */
async function partBytes(f: CatalogFile): Promise<number> {
  const info = await FileSystem.getInfoAsync(partUriFor(f), { size: true });
  if (!info.exists || typeof info.size !== 'number') return 0;
  return info.size > 0 && info.size < f.bytes ? info.size : 0;
}

/** Drop any `.part` for this target that isn't the one we'd resume — other versions, older naming. */
async function discardStaleParts(f: CatalogFile): Promise<void> {
  const dir = dirFor(f.feature);
  const keep = partUriFor(f).slice(dir.length + 1);
  const names = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
  await Promise.all(
    names
      .filter((n) => n !== keep && n.startsWith(`${f.target}.`) && n.endsWith('.part'))
      .map((n) => FileSystem.deleteAsync(`${dir}/${n}`, { idempotent: true }).catch(() => {})),
  );
}

/**
 * True when the file on disk is the one we expect — right size, and for small
 * files the right contents too. A same-size file with different bytes (a stale
 * model from an earlier build) counts as missing and gets replaced.
 */
async function isPresent(f: CatalogFile): Promise<boolean> {
  const uri = uriFor(f);
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  if (!info.exists || info.size !== f.bytes) return false;
  if (f.bytes > HASH_MAX_BYTES) return true;

  try {
    return (await hashFile(uri)) === f.sha256;
  } catch {
    // Unreadable is as good as absent — re-fetching is always safe.
    return false;
  }
}

/**
 * Which model files are still missing (or truncated), and how many bytes it would
 * actually cost to finish them — bytes already sitting in a `.part` are not charged
 * again, so a resumed setup screen quotes what's left, not the full 1.5 GB.
 */
export async function getMissing(
  features?: readonly string[],
): Promise<{ missing: CatalogFile[]; missingBytes: number }> {
  const scope = filesFor(features);
  const flags = await Promise.all(scope.map(isPresent));
  const missing = scope.filter((_, i) => !flags[i]);
  const have = await Promise.all(missing.map(partBytes));
  return { missing, missingBytes: missing.reduce((n, f, i) => n + f.bytes - have[i], 0) };
}

/** True when every model in the subset (default: all of them) is on disk. */
export async function areModelsReady(features?: readonly string[]): Promise<boolean> {
  const { missing } = await getMissing(features);
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
let active: FileSystem.DownloadResumable | null = null;

/**
 * Abort an in-flight run, keeping partial files so the next run resumes from them.
 *
 * This stops the transfer *now* rather than at the next file boundary. Waiting for the
 * boundary would mean tapping Cancel on the 1.2 GB Llama does nothing visible for many
 * minutes while the download keeps spending the user's data.
 */
export function cancelDownload(): void {
  cancelled = true;
  // Rejects if the task already finished; nothing to stop in that case.
  active?.pauseAsync().catch(() => {});
}

/**
 * Fetch one file into place, resuming from any bytes already downloaded.
 *
 * `onWritten` reports bytes present in the file overall (the resumed prefix included),
 * not a delta — deltas can't survive a retry that restarts the file.
 */
async function downloadOne(f: CatalogFile, onWritten: (writtenTotal: number) => void): Promise<void> {
  const dir = dirFor(f.feature);
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {
    /* already exists */
  });

  const finalUri = uriFor(f);
  const partUri = partUriFor(f);
  const discardPart = () => FileSystem.deleteAsync(partUri, { idempotent: true }).catch(() => {});

  await discardStaleParts(f);
  const offset = await partBytes(f);
  // Zero means whatever is there (if anything) is unusable, not that nothing is there.
  if (offset === 0) await discardPart();

  let written = offset;
  const task = FileSystem.createDownloadResumable(
    `${BASE_URL}${f.asset}`,
    partUri,
    {},
    ({ totalBytesWritten }) => {
      written = totalBytesWritten;
      onWritten(written);
    },
    // Native turns this into `Range: bytes=<offset>-` and opens the file for append.
    offset > 0 ? String(offset) : undefined,
  );

  active = task;
  let result;
  try {
    result = await task.downloadAsync();
  } finally {
    active = null;
  }

  // Cancelled or paused — the .part is exactly the resume point, so leave it alone.
  if (!result) {
    throw new ModelDownloadError(`${f.asset}: interrupted at ${written} of ${f.bytes} bytes.`);
  }

  // 206 is the success code for the ranged request a resume makes; 200 for a fresh one.
  if (result.status !== 200 && result.status !== 206) {
    await discardPart();
    throw new ModelDownloadError(`${f.asset}: HTTP ${result.status}.`);
  }

  // We asked for a range and got the whole body instead. The native side appended it to
  // the prefix we already had, so the .part is now a corrupt splice. Not recoverable —
  // drop it and let the retry start the file clean.
  if (offset > 0 && result.status === 200) {
    await discardPart();
    throw new ModelDownloadError(`${f.asset}: server ignored Range (HTTP 200 on resume).`);
  }

  const info = await FileSystem.getInfoAsync(partUri, { size: true });
  if (!info.exists || info.size !== f.bytes) {
    await discardPart();
    throw new ModelDownloadError(
      `${f.asset}: got ${info.exists ? info.size : 0} bytes, expected ${f.bytes} (truncated or interrupted).`,
    );
  }

  if (f.bytes <= HASH_MAX_BYTES) {
    const got = await hashFile(partUri);
    if (got !== f.sha256) {
      await discardPart();
      throw new ModelDownloadError(
        `${f.asset}: sha256 ${got.slice(0, 12)}… != expected ${f.sha256.slice(0, 12)}… (corrupt or wrong file).`,
      );
    }
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
export async function downloadModels(
  onProgress?: (p: DownloadProgress) => void,
  features?: readonly string[],
): Promise<void> {
  cancelled = false;

  const setBytes = totalBytesFor(features);
  const { missing, missingBytes } = await getMissing(features);
  if (missing.length === 0) return;

  // Bytes each file already had when this run started, so the run doesn't re-charge them.
  const have = await Promise.all(missing.map(partBytes));

  // Complete files plus partial .parts — everything a previous run already paid for.
  const alreadyOnDisk = setBytes - missingBytes;

  let fetched = 0;
  const emit = (fileIndex: number, feature: string) =>
    onProgress?.({
      fileIndex,
      totalFiles: missing.length,
      feature,
      fetchedBytes: fetched,
      receivedBytes: alreadyOnDisk + fetched,
      totalBytes: setBytes,
      fraction: setBytes > 0 ? Math.min((alreadyOnDisk + fetched) / setBytes, 1) : 1,
    });

  for (let i = 0; i < missing.length; i++) {
    const f = missing[i];
    if (cancelled) throw new ModelDownloadError('cancelled.');

    emit(i + 1, f.feature);
    const atFileStart = fetched;

    let lastErr: unknown;
    let ok = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
      try {
        await downloadOne(f, (writtenTotal) => {
          // writtenTotal is absolute within the file, so this is correct whether the
          // attempt resumed or started over. It's clamped because a retry that had to
          // restart the file reports from 0 again, and the bar must not run backwards.
          fetched = atFileStart + Math.max(0, writtenTotal - have[i]);
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

    fetched = atFileStart + (f.bytes - have[i]); // exact, in case progress callbacks under-reported
    emit(i + 1, f.feature);
  }
}
