/**
 * Energy Predictor — shared types. Authority: docs/energy-predictor-model-contract.md.
 */

/** One day's 12 features (raw, pre-normalization), in the manifest's feature order. */
export type DayFeatures = {
  sleepDurationH: number;
  sleepQuality: number;        // 0..1
  sleepMidpointH: number;      // local hour
  wakeTimeH: number;
  stepsK: number;              // thousands
  activeMinutes: number;
  movementIntensity: number;   // 0..1
  screenTimeH: number;
  phonePickups: number;
  lateNightScreenMin: number;
  dow: number;                 // 0..6 (for dow_sin/cos)
};

/** A highlighted window in the day (best focus / wind-down). */
export type EnergyWindow = {
  kind: 'focus' | 'rest';
  startHour: number;
  endHour: number;
  label: string;
};

/** What the screen + curve bind to (contract §4). */
export type EnergyForecast = {
  /** 24 hourly values, 0..100, index = local hour. */
  points: number[];
  peak: { hour: number; value: number };
  dip: { hour: number; value: number };
  windows: EnergyWindow[];
  /** 0..1 (days of data / 7). Drives the "calibrating" UI. */
  confidence: number;
  /** 'model' = ExecuTorch .pte; 'heuristic' = pre-model fallback. */
  basis: 'model' | 'heuristic';
  /** True until enough days collected (cold-start). */
  calibrating: boolean;
  daysCollected: number;
};
