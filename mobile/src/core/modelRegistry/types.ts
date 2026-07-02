/**
 * Model Registry — types for releasing on-device models like a model catalog.
 *
 * Mirrors how Claude models are released: a versioned catalog of model "IDs", each
 * pinned to a runtime. The owner publishes a new version; clients pick it up on their
 * own schedule. Bundled-first (the app ships with working models), updates are opt-in
 * and MODEL-IN-ONLY — the channel never carries user data (see model-release-process.md).
 */

export type FeatureKey = 'overwhelm' | 'energy' | 'hydration' | 'expense_line' | 'expense_category';

export type ReleaseChannel = 'stable' | 'beta';

/** Where a model's files live. Bundled ships in the app; remote is pulled from your host. */
export type ModelSource =
  | { type: 'bundled' }
  | { type: 'remote'; baseUrl: string }; // e.g. https://registry.lifepilot.app/models/<id>/<version>/

/** One released model version — the unit you publish (like a Claude model release). */
export type ModelDescriptor = {
  /** Stable model id, e.g. "overwhelm-llama-3.2-1b" (your "model name"). */
  id: string;
  feature: FeatureKey;
  /** Semver, e.g. "1.0.0" — bump this to release (your "model version"). */
  version: string;
  channel: ReleaseChannel;
  /** MUST equal the app's runtime pin or the model is REJECTED (no forward compat). */
  executorchVersion: string;
  /** Filenames within the source (model + any tokenizer/config). */
  files: Record<string, string>;
  /** Integrity: sha256 per file (verified on download; size as a fast guard). */
  sha256?: Record<string, string>;
  bytes?: Record<string, number>;
  source: ModelSource;
  /** Optional gates. */
  minAppVersion?: string;
  releasedAt?: string;        // ISO
  notes?: string;             // human release note (like model release notes)
};

/** The catalog: the app's runtime pin + every feature's available versions. */
export type RegistryManifest = {
  schema: 1;
  /** Catalog version (when you last published), informational. */
  registryVersion: string;
  /** The runtime this app build supports — the pin the gate enforces. */
  runtime: { executorchVersion: string; reactNativeExecutorch: string };
  /** Available versions per feature, newest first is fine (resolver sorts by semver). */
  models: Partial<Record<FeatureKey, ModelDescriptor[]>>;
};

/** What's currently active on device for a feature (after resolve/activate). */
export type ActiveModel = {
  descriptor: ModelDescriptor;
  /** Absolute local file:// paths to each file, ready to load. */
  localFiles: Record<string, string>;
  origin: 'bundled' | 'downloaded';
};

export type UpdateInfo = {
  feature: FeatureKey;
  current: ModelDescriptor;
  available: ModelDescriptor;   // a newer, pin-compatible version
};
