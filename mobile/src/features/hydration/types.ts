/**
 * Hydration Tracker — shared types.
 * Authority: docs/hydration-engine-contract.md (§8 I/O, §11 ExecuTorch model, §12 dual-mode).
 */

export type Sex = 'male' | 'female';
export type WorkoutIntensity = 'light' | 'moderate' | 'vigorous';

/** Inputs to the target computation (engine or model). */
export type HydrationInputs = {
  bodyMassKg: number;          // required, clamped 30..250
  sex?: Sex;
  ageYears?: number;
  temperatureC?: number;       // from weather (or assumed mild if absent)
  humidityPct?: number;
  aqi?: number;
  activeMinutes?: number;      // preferred activity signal
  workoutIntensity?: WorkoutIntensity;
  steps?: number;              // light-only fallback when activeMinutes absent
};

export type ConfidenceWord = 'high' | 'medium' | 'low';

export type BreakdownItem = {
  key: 'baseline' | 'heat' | 'activity' | 'airQuality' | 'safetyClamp';
  label: string;
  amountMl: number;            // signed; the items sum EXACTLY to targetMl
  confidence: ConfidenceWord;
  why: string;
};

export type HydrationStatus = 'normal' | 'elevated' | 'high';

/** The output the screen + "why today" panel bind to (contract §8). */
export type HydrationTarget = {
  targetMl: number;
  baselineMl: number;
  status: HydrationStatus;
  breakdown: BreakdownItem[];  // sums to targetMl
  servingMl: number;
  confidence: ConfidenceWord;
  clamped: boolean;
  notes: string[];
  /** 'model' = produced by the ExecuTorch .pte; 'engine' = deterministic fallback. */
  basis: 'model' | 'engine';
};

/** The 4 physiology components the model/engine produce (mL). */
export type Components = {
  baseline: number;
  heat: number;
  activity: number;
  aqi: number;
};

export type NudgeReason =
  | 'none' | 'behindPace' | 'gentlePacing' | 'postActivity';

export type NudgeDecision = {
  shouldNudge: boolean;
  reason: NudgeReason;
  suggestedMl: number;
  message: string;
  nextCheckMinutes: number;
};

/** Live state used by the nudge scheduler. */
export type HydrationDayState = {
  targetMl: number;
  loggedMl: number;
  wakeHour: number;
  bedHour: number;
  servingMl: number;
  currentTempC?: number;
  lastNudgeAt?: number;        // epoch ms
  lastDrinkAt?: number;
  dndUntil?: number;
  recentActivityEndedAt?: number;
  recentActivityMl?: number;
};

export type IntakeEntry = { id: string; ml: number; at: number };

export type Units = 'ml' | 'oz';

/** Weather acquisition mode (contract §12 — privacy by default). */
export type WeatherMode = 'offline' | 'live';

export type WeatherConditions = {
  temperatureC: number;
  humidityPct: number;
  aqi?: number;
  source: 'manual' | 'home-climate' | 'live' | 'last-known';
};

/** Local-only user profile + settings (never synced). */
export type HydrationProfile = {
  bodyMassKg: number;
  sex?: Sex;
  ageYears?: number;
  units: Units;
  wakeHour: number;
  bedHour: number;
  weatherMode: WeatherMode;        // default 'offline'
  homeClimate?: WeatherConditions; // for offline mode
};
