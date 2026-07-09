/**
 * coarseLocation — the injected location provider for 'live' weather mode.
 *
 * Kept OUT of weatherSource.ts on purpose: that file owns the (single, sanctioned)
 * network egress; this file owns only the permission + a low-accuracy fix. weatherSource
 * grid-rounds whatever this returns before any request, so even here we ask for the
 * coarsest fix the OS will give and prefer a cached last-known position over a live GPS
 * lock. Any failure (denied, disabled, timeout) returns null → weatherSource falls back
 * to last-known/home-climate with zero network. Nothing is stored off-device.
 */
import * as Location from 'expo-location';

export async function getCoarseLocation(): Promise<{ lat: number; lon: number } | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    // Prefer a cached fix (no GPS wake-up); fall back to a single low-accuracy read.
    const pos =
      (await Location.getLastKnownPositionAsync()) ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
    if (!pos) return null;

    return { lat: pos.coords.latitude, lon: pos.coords.longitude };
  } catch {
    return null;
  }
}
