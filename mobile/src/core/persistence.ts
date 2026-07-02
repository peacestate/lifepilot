/**
 * persistence — tiny file-based boolean flag store backed by expo-file-system.
 * Used only for lightweight app-state flags (e.g. "onboarding complete").
 * NOT for user data — that lives in feature stores.
 */
import * as FileSystem from 'expo-file-system';

const FLAGS_PATH = `${FileSystem.documentDirectory}lp_flags.json`;

async function read(): Promise<Record<string, boolean>> {
  try {
    const raw = await FileSystem.readAsStringAsync(FLAGS_PATH);
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export async function getFlag(key: string): Promise<boolean> {
  const flags = await read();
  return flags[key] === true;
}

export async function setFlag(key: string, value = true): Promise<void> {
  const flags = await read();
  flags[key] = value;
  await FileSystem.writeAsStringAsync(FLAGS_PATH, JSON.stringify(flags));
}
