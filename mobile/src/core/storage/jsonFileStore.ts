/**
 * jsonFileStore — tiny load-once / write-through JSON persistence for the feature
 * stores (expense records, expense category learning, hydration profile + intake).
 *
 * Same storage substrate personalHistory already uses: a JSON file inside the app's
 * sandboxed expo-file-system documentDirectory — on-device only, inaccessible to
 * other apps, NEVER networked. (Encryption-at-rest via expo-secure-store-wrapped keys
 * remains a later upgrade; the seam is this one module.)
 *
 * Contract:
 *  - `ready()` — starts (once) and awaits the initial disk load; the store's
 *    `applyLoaded` callback merges what was read into the module's in-memory state.
 *    Safe to call any number of times. Load failure (first run, corrupt file) is
 *    silent: in-memory defaults stand.
 *  - `save(state)` — fire-and-forget write-through. Writes are serialized on a chain
 *    so two rapid mutations can't interleave file writes; last write wins.
 *  - `flush()` — awaits the write chain (tests; could back an on-background flush).
 */
import * as FileSystem from 'expo-file-system';

export type JsonFileStore<T> = {
  ready: () => Promise<void>;
  save: (state: T) => void;
  flush: () => Promise<void>;
};

export function createJsonFileStore<T>(
  fileName: string,
  applyLoaded: (loaded: T) => void,
): JsonFileStore<T> {
  const path = `${FileSystem.documentDirectory ?? ''}${fileName}`;
  let loadPromise: Promise<void> | null = null;
  let writeChain: Promise<void> = Promise.resolve();

  const load = async (): Promise<void> => {
    try {
      const raw = await FileSystem.readAsStringAsync(path);
      applyLoaded(JSON.parse(raw) as T);
    } catch {
      // First run or unreadable file — keep in-memory defaults.
    }
  };

  return {
    ready: () => (loadPromise ??= load()),
    save: (state: T) => {
      const json = JSON.stringify(state);
      const write = () => FileSystem.writeAsStringAsync(path, json).catch(() => {});
      writeChain = writeChain.then(write, write);
    },
    flush: () => writeChain,
  };
}
