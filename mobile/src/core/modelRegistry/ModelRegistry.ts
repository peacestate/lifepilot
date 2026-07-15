/**
 * ModelRegistry — release on-device models like a model catalog.
 *
 * Lets the OWNER publish a new model version and have installed apps pick it up,
 * without an app-store rebuild — the same mental model as Claude model releases.
 *
 * DESIGN PRINCIPLES (see docs/model-release-process.md):
 *   1. BUNDLED-FIRST. The app ships a working model per feature; it functions fully
 *      offline forever even if no update is ever fetched.
 *   2. MODEL-IN-ONLY. The update channel only GETs public model artifacts from YOUR
 *      host. It NEVER sends user data, identity, health data, or telemetry — nothing
 *      about the user leaves the device. (privacy-absolute-executorch-everywhere)
 *   3. OPT-IN. `checkForUpdates`/`download` run only when the app explicitly calls
 *      them (e.g. on a user "check for updates" tap, or a wifi-only setting). Default
 *      behavior is bundled-only.
 *   4. PIN-GATED. A descriptor whose executorchVersion != the runtime pin is REJECTED.
 *      `.pte` has no forward-compat — this prevents shipping a model the runtime can't load.
 *   5. ATOMIC + ROLLBACK. A downloaded version is staged, verified, then activated; the
 *      previous active version is retained so we can roll back instantly.
 *
 * The remote fetch is the ONLY network use here and is the single ESLint-allowlisted
 * call site. Everything else is local file ops via expo-file-system.
 */

import * as FileSystem from 'expo-file-system';

import { base64ToBytes, sha256 } from '../modelDownload/sha256';
import bundled from './registry.bundled.json';
import type {
  ActiveModel,
  FeatureKey,
  ModelDescriptor,
  RegistryManifest,
  ReleaseChannel,
  UpdateInfo,
} from './types';

const RUNTIME = (bundled as RegistryManifest).runtime;

/* ── semver helpers (tiny; versions are simple x.y.z) ──────────────────────── */
function cmpSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/** The pin gate: only models built for this app's runtime may be used. */
function pinOk(d: ModelDescriptor): boolean {
  return d.executorchVersion === RUNTIME.executorchVersion;
}

function pickLatest(list: ModelDescriptor[] | undefined, channel: ReleaseChannel): ModelDescriptor | undefined {
  const eligible = (list ?? [])
    .filter(pinOk)
    .filter((d) => d.channel === 'stable' || d.channel === channel)
    .sort((a, b) => cmpSemver(b.version, a.version));
  return eligible[0];
}

/**
 * Files at or under this size are content-checked by sha256; larger ones by byte
 * size alone. Same bound and rationale as ModelDownloader: size alone cannot tell
 * a stale model from the right one (two energy models were byte-identical in
 * length), but hashing a 1.2 GB .pte in JS would blow memory and take minutes.
 */
const HASH_MAX_BYTES = 8 * 1024 * 1024;

/** sha256 of a file already on disk. Only call for files <= HASH_MAX_BYTES. */
async function hashFile(uri: string): Promise<string> {
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return sha256(base64ToBytes(b64));
}

const dir = () => `${FileSystem.documentDirectory}models`;
const stageDir = (id: string, version: string) => `${dir()}/${id}/${version}`;
const activePtr = (feature: FeatureKey) => `${dir()}/active/${feature}.json`;

export class ModelRegistry {
  private channel: ReleaseChannel;
  /** Remote catalog URL — YOUR host (FastAPI/CDN). Undefined => bundled-only. */
  private remoteRegistryUrl?: string;

  constructor(opts?: { channel?: ReleaseChannel; remoteRegistryUrl?: string }) {
    this.channel = opts?.channel ?? 'stable';
    this.remoteRegistryUrl = opts?.remoteRegistryUrl;
  }

  /** The bundled catalog (always available, offline). */
  bundledManifest(): RegistryManifest {
    return bundled as RegistryManifest;
  }

  /**
   * Resolve the model to USE for a feature right now: a previously-activated download
   * if present & valid, else the bundled version. Never throws — always returns
   * something loadable (or null only if a feature has no bundled model).
   */
  async getActive(feature: FeatureKey): Promise<ActiveModel | null> {
    // 1) an activated download?
    try {
      const ptr = await FileSystem.readAsStringAsync(activePtr(feature));
      const d = JSON.parse(ptr) as ModelDescriptor;
      if (pinOk(d)) {
        const localFiles = await this.localFilesFor(d);
        if (localFiles) return { descriptor: d, localFiles, origin: 'downloaded' };
      }
    } catch {
      /* no active pointer yet — fall through to bundled */
    }
    // 2) bundled
    const b = pickLatest(this.bundledManifest().models[feature], this.channel);
    if (!b) return null;
    return { descriptor: b, localFiles: this.bundledFilesFor(b), origin: 'bundled' };
  }

  /**
   * Check YOUR remote catalog for newer, pin-compatible versions. OPT-IN, model-in-only.
   * Returns [] if no remote configured or nothing newer. Sends NO user data — a plain
   * GET of a public manifest.
   */
  async checkForUpdates(features?: FeatureKey[]): Promise<UpdateInfo[]> {
    if (!this.remoteRegistryUrl) return [];
    let remote: RegistryManifest;
    try {
      // ── the ONLY network call in this module (model catalog, no user data) ──
      remote = (await fetch(this.remoteRegistryUrl).then((r) => r.json())) as RegistryManifest;
    } catch {
      return []; // offline / unreachable → stay on bundled, no error surfaced
    }
    const keys = features ?? (Object.keys(remote.models) as FeatureKey[]);
    const updates: UpdateInfo[] = [];
    for (const f of keys) {
      const active = await this.getActive(f);
      const latest = pickLatest(remote.models[f], this.channel);
      if (active && latest && cmpSemver(latest.version, active.descriptor.version) > 0) {
        updates.push({ feature: f, current: active.descriptor, available: latest });
      }
    }
    return updates;
  }

  /**
   * Download + verify a remote descriptor into a staging dir. Pin-gated; verifies size
   * (and sha256 where small enough). Does NOT activate — call activate() after.
   */
  async download(d: ModelDescriptor, onProgress?: (p: number) => void): Promise<void> {
    if (!pinOk(d)) throw new Error(`model ${d.id}@${d.version} targets ExecuTorch ${d.executorchVersion} != runtime ${RUNTIME.executorchVersion}`);
    if (d.source.type !== 'remote') throw new Error('descriptor is not remote');
    const target = stageDir(d.id, d.version);
    await FileSystem.makeDirectoryAsync(target, { intermediates: true }).catch(() => {});
    const names = Object.values(d.files);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const url = `${d.source.baseUrl.replace(/\/$/, '')}/${name}`;
      const dest = `${target}/${name}`;
      await FileSystem.downloadAsync(url, dest); // model-in only
      const key = keyForFile(d, name);
      const info = await FileSystem.getInfoAsync(dest, { size: true });
      const size = info.exists && typeof info.size === 'number' ? info.size : 0;
      // fast integrity guard: byte size
      const want = d.bytes?.[key];
      if (want != null && size !== want) {
        await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
        throw new Error(`${name}: size ${size} != manifest ${want} (corrupt/partial)`);
      }
      // content guard: sha256, for files small enough to hash in JS
      const wantHash = d.sha256?.[key];
      if (wantHash && size > 0 && size <= HASH_MAX_BYTES) {
        const got = await hashFile(dest);
        if (got !== wantHash) {
          await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
          throw new Error(
            `${name}: sha256 ${got.slice(0, 12)}… != manifest ${wantHash.slice(0, 12)}… (corrupt or wrong file)`,
          );
        }
      }
      onProgress?.((i + 1) / names.length);
    }
    // persist the descriptor next to its files for activation/rollback
    await FileSystem.writeAsStringAsync(`${target}/descriptor.json`, JSON.stringify(d));
  }

  /** Atomically point a feature at a staged, verified version (previous kept for rollback). */
  async activate(d: ModelDescriptor): Promise<void> {
    if (!pinOk(d)) throw new Error('cannot activate: runtime pin mismatch');
    const localFiles = await this.localFilesFor(d);
    if (!localFiles) throw new Error('cannot activate: files not staged/downloaded');
    await FileSystem.makeDirectoryAsync(`${dir()}/active`, { intermediates: true }).catch(() => {});
    await FileSystem.writeAsStringAsync(activePtr(d.feature), JSON.stringify(d));
  }

  /** Revert a feature to the bundled version (drops the active-download pointer). */
  async rollbackToBundled(feature: FeatureKey): Promise<void> {
    await FileSystem.deleteAsync(activePtr(feature), { idempotent: true });
  }

  /** Convenience: check → download → activate the newest version for a feature. */
  async updateFeature(feature: FeatureKey, onProgress?: (p: number) => void): Promise<ModelDescriptor | null> {
    const [u] = await this.checkForUpdates([feature]);
    if (!u) return null;
    await this.download(u.available, onProgress);
    await this.activate(u.available);
    return u.available;
  }

  // ── file resolution ──────────────────────────────────────────────────────
  private bundledFilesFor(d: ModelDescriptor): Record<string, string> {
    // Bundled files live under mobile/src/models/<feature>/ and are provisioned to a
    // loadable path by each feature's provisioner (same pattern as Overwhelm/Energy).
    const out: Record<string, string> = {};
    for (const [k, name] of Object.entries(d.files)) out[k] = name; // resolved by feature provisioner
    return out;
  }

  private async localFilesFor(d: ModelDescriptor): Promise<Record<string, string> | null> {
    const base = stageDir(d.id, d.version);
    const out: Record<string, string> = {};
    for (const [k, name] of Object.entries(d.files)) {
      const path = `${base}/${name}`;
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) return null;
      out[k] = `file://${path}`;
    }
    return out;
  }
}

function keyForFile(d: ModelDescriptor, filename: string): string {
  return Object.entries(d.files).find(([, v]) => v === filename)?.[0] ?? filename;
}

/** App-wide singleton. Pass your remote registry URL to enable opt-in updates. */
export const modelRegistry = new ModelRegistry({
  channel: 'stable',
  // remoteRegistryUrl: 'https://registry.lifepilot.app/registry.json',  // set to enable updates
});
