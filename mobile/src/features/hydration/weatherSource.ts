/**
 * weatherSource — the ONLY place in the entire app that may touch the network,
 * and only in opt-in 'live' mode (contract §12, [[privacy-absolute-executorch-everywhere]]).
 *
 * Mode A 'offline' (DEFAULT): conditions come from the user's home-climate setting or a
 *   manual entry. ZERO network — nothing about the user leaves the device, not even a
 *   coarse area.
 * Mode B 'live' (opt-in only): fetch coarse-area weather/AQI. The request carries NO
 *   identity, NO precise location, NO health/intake data — only a grid-rounded lat/lon.
 *
 * This is the single file the feature's ESLint network-ban allowlists. Everything else
 * under features/hydration/** must stay network-free.
 */

import type { WeatherConditions, WeatherMode, HydrationProfile } from './types';

/** Round to a ~11 km grid BEFORE any request — the real privacy lever (contract §12). */
const coarse = (x: number) => Math.round(x * 10) / 10;

/**
 * Resolve today's conditions for the given mode.
 * - 'offline': returns the profile's homeClimate (or undefined → engine assumes mild).
 * - 'live': fetches Open-Meteo for a coarse cell. `getCoarseLocation` is injected so the
 *   permission/location concern stays out of this module; pass undefined to skip.
 */
export async function getConditions(
  mode: WeatherMode,
  profile: HydrationProfile,
  getCoarseLocation?: () => Promise<{ lat: number; lon: number } | null>,
): Promise<WeatherConditions | undefined> {
  if (mode === 'offline') {
    return profile.homeClimate
      ? { ...profile.homeClimate, source: profile.homeClimate.source ?? 'home-climate' }
      : undefined; // engine falls back to assumed-mild conditions
  }

  // ── Mode B: opt-in live weather (the one sanctioned egress) ──
  try {
    const loc = getCoarseLocation ? await getCoarseLocation() : null;
    if (!loc) return profile.homeClimate; // no location → fall back, still no network leak
    const lat = coarse(loc.lat);
    const lon = coarse(loc.lon);

    // Open-Meteo: no API key, no account → no per-user credential ties a request to a person.
    const wx = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,relative_humidity_2m`,
    ).then((r) => r.json());
    const aq = await fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
        `&current=us_aqi`,
    ).then((r) => r.json());

    return {
      temperatureC: wx?.current?.temperature_2m,
      humidityPct: wx?.current?.relative_humidity_2m,
      aqi: aq?.current?.us_aqi,
      source: 'live',
    };
  } catch {
    return profile.homeClimate
      ? { ...profile.homeClimate, source: 'last-known' }
      : undefined;
  }
}
