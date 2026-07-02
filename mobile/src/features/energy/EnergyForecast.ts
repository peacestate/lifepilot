/**
 * EnergyForecast — pure helpers: build the model input, derive the human-facing
 * forecast (peak / dip / focus & wind-down windows) from the 24-pt curve, and a
 * heuristic fallback curve for before the .pte is exported. No React, no network.
 *
 * Normalization + feature order mirror the manifest (single source of truth).
 */

import type { DayFeatures, EnergyForecast, EnergyWindow } from './types';
import manifest from '../../models/energy/manifest.json';

const MEAN = manifest.scaler.mean;
const STD = manifest.scaler.std;
const UNKNOWN = manifest.today_unknown_feature_idx; // today's not-yet-happened fields → z=0
const WINDOW = manifest.window_days;                // 7
const MIN_DAYS = manifest.min_days_for_prediction;  // 3

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** One day → the 12 raw features (manifest order), with dow expanded to sin/cos. */
function rawDay(d: DayFeatures): number[] {
  return [
    d.sleepDurationH, d.sleepQuality, d.sleepMidpointH, d.wakeTimeH,
    d.stepsK, d.activeMinutes, d.movementIntensity, d.screenTimeH,
    d.phonePickups, d.lateNightScreenMin,
    Math.sin((2 * Math.PI * d.dow) / 7), Math.cos((2 * Math.PI * d.dow) / 7),
  ];
}

/**
 * Build the normalized [1,12,7] input as a flat Float32Array in [feature, day] order
 * (feature-major: index = f*7 + d), oldest day first. Today's unknown activity/usage
 * fields are masked to the mean (z=0), matching the export.
 */
export function buildInputTensor(window: DayFeatures[]): Float32Array {
  // pad to WINDOW by repeating the earliest observed day (cold-start back-fill)
  const days = [...window];
  while (days.length < WINDOW) days.unshift(days[0]);
  const last7 = days.slice(-WINDOW);

  const out = new Float32Array(12 * WINDOW);
  for (let d = 0; d < WINDOW; d++) {
    const raw = rawDay(last7[d]);
    for (let f = 0; f < 12; f++) {
      let v = raw[f];
      if (d === WINDOW - 1 && UNKNOWN.includes(f)) v = MEAN[f]; // today unknown → z=0
      out[f * WINDOW + d] = (v - MEAN[f]) / STD[f];
    }
  }
  return out;
}

/** A plausible circadian curve from the latest day — used until the model is present. */
export function heuristicCurve(latest: DayFeatures): number[] {
  const wake = clamp(latest.wakeTimeH, 4, 11);
  const amp = 20 * (0.7 + 0.5 * clamp(latest.sleepQuality, 0, 1));
  const mesor = 55 - 1.5 * Math.max(0, 7.5 - latest.sleepDurationH);
  const peakH = 13;
  const pts: number[] = [];
  for (let h = 0; h < 24; h++) {
    const main = Math.sin((2 * Math.PI * (h - (peakH - 6))) / 24);
    const dip = 0.35 * Math.sin((2 * Math.PI * (h - 9)) / 12); // ~15:00 trough
    let v = mesor + amp * (0.8 * main - dip);
    if (h < Math.floor(wake)) v *= 0.45;
    pts.push(clamp(Math.round(v), 0, 100));
  }
  return pts;
}

function avg(pts: number[], a: number, b: number): number {
  let s = 0, n = 0;
  for (let h = a; h <= b; h++) { s += pts[h]; n++; }
  return n ? s / n : 0;
}

/** Lowest-average 2-hour window in [a,b] → the wind-down window. */
function lowestWindow(pts: number[], a: number, b: number): [number, number] {
  let best = a, bestV = Infinity;
  for (let h = a; h <= b - 1; h++) {
    const v = (pts[h] + pts[h + 1]) / 2;
    if (v < bestV) { bestV = v; best = h; }
  }
  return [best, best + 2];
}

/** Derive the human-facing forecast from a 24-pt curve. */
export function deriveForecast(
  points: number[],
  daysCollected: number,
  basis: 'model' | 'heuristic',
): EnergyForecast {
  // peak over waking hours
  let peakH = 6, dipH = 14;
  for (let h = 6; h <= 22; h++) if (points[h] > points[peakH]) peakH = h;
  // afternoon dip (10..18), fall back to waking min
  dipH = 10;
  for (let h = 10; h <= 18; h++) if (points[h] < points[dipH]) dipH = h;

  const focus: EnergyWindow = {
    kind: 'focus',
    startHour: clamp(peakH - 1, 6, 22),
    endHour: clamp(peakH + 1, 7, 23),
    label: 'Best focus',
  };
  const [rs, re] = lowestWindow(points, 19, 23);
  const rest: EnergyWindow = { kind: 'rest', startHour: rs, endHour: re, label: 'Wind down' };

  return {
    points,
    peak: { hour: peakH, value: points[peakH] },
    dip: { hour: dipH, value: points[dipH] },
    windows: [focus, rest],
    confidence: clamp(daysCollected / WINDOW, 0, 1),
    basis,
    calibrating: daysCollected < MIN_DAYS,
    daysCollected,
  };
}

export const ENERGY_MIN_DAYS = MIN_DAYS;
