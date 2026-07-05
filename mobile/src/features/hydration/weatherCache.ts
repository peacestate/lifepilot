/**
 * weatherCache — on-device, once-per-day cache for 'live' weather mode.
 *
 * Without this, every recompute (screen mount, profile change) triggered a fresh
 * network call — correct in spirit (opt-in only) but not what "live" should mean in
 * practice: weather doesn't change fast enough to justify re-fetching every time the
 * screen re-renders. Caching by calendar day means at most ONE network call per day,
 * ever, and a real device offline (or the demo device with connectivity off) still
 * gets a sensible answer from the last successful fetch instead of silently failing
 * back to the generic homeClimate guess every time.
 *
 * PRIVACY: the cache itself never leaves the device — same file-based, sandboxed
 * pattern as personalHistory.ts. No new network surface, just less of the existing one.
 */
import * as FileSystem from 'expo-file-system';

import type { WeatherConditions } from './types';

const CACHE_PATH = `${FileSystem.cacheDirectory}lp_weather_cache.json`;

type CacheEntry = { date: string; conditions: WeatherConditions };

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function readCache(): Promise<CacheEntry | undefined> {
  try {
    const raw = await FileSystem.readAsStringAsync(CACHE_PATH);
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return undefined;
  }
}

/** Today's cached reading, if the cache was populated today. Undefined otherwise (needs a fetch). */
export async function getCachedToday(): Promise<WeatherConditions | undefined> {
  const entry = await readCache();
  return entry?.date === todayKey() ? entry.conditions : undefined;
}

/** The last successfully cached reading, regardless of which day it's from — the offline fallback. */
export async function getLastKnown(): Promise<WeatherConditions | undefined> {
  return (await readCache())?.conditions;
}

/** Persist a freshly-fetched reading as today's cache entry. */
export async function saveToCache(conditions: WeatherConditions): Promise<void> {
  const entry: CacheEntry = { date: todayKey(), conditions };
  await FileSystem.writeAsStringAsync(CACHE_PATH, JSON.stringify(entry));
}
