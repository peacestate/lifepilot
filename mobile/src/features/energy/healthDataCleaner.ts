/**
 * healthDataCleaner — normalizes raw Health Connect records before they become the
 * model's DayFeatures. Operates on the SDK's own raw record shapes (SleepSessionRecord /
 * StepsRecord / HeartRateRecord), so it catches messiness (multi-session nights, sensor
 * outliers, spiky step bursts) BEFORE any per-day aggregation — cleaning after aggregation
 * would already have lost the information needed to fix it.
 *
 * "Clean data in, clean predictions out" — every threshold below is a literal product
 * spec number, not a guess. Pure functions, no I/O, no network.
 *
 * Param types are minimal structural shapes (just the fields actually read), not the SDK's
 * named record types — react-native-health-connect's readRecords() return type is a union
 * of the plain record and a richer "*RecordResult" variant, and both satisfy these shapes
 * structurally without this module needing to know which one it got.
 */
export type RawSleepSession = {
  startTime: string;
  endTime: string;
  stages?: Array<{ startTime: string; endTime: string; stage: number }>;
};
export type RawStepsRecord = { startTime: string; endTime: string; count: number };
export type RawHeartRateRecord = { samples?: Array<{ time: string; beatsPerMinute: number }> };

export type CleanedDay = {
  date: string; // YYYY-MM-DD, local
  sleepDurationH?: number;
  wakeTimeH?: number;
  sleepMidpointH?: number;
  sleepQuality?: number; // 0..1, only when stage data was present
  stepsK?: number;
  /** Context for the transparency UI (step 7) — NOT fed to the model (its input contract
   * has no heart-rate slot; see healthConnectSource.ts's header for why). */
  restingHeartRate?: number;
  morningHeartRate?: number;
  /** Where sleep/steps came from — lets the caller show honest confidence, not just a number. */
  sleepSource: 'measured' | 'rollingAverage' | 'none';
  stepsSource: 'measured' | 'threeDayAverage' | 'none';
};

const NAP_MAX_H = 2;          // sessions shorter than this are naps, excluded from the nightly total
const SLEEP_CAP_H = 14;       // longer than this is almost certainly a sensor error
const STEPS_CAP = 50_000;     // a day total above this is almost certainly a sensor error
const STEP_HOURLY_SPIKE = 10_000; // implied steps/hour above this gets smoothed, not trusted verbatim
const HR_MIN_BPM = 30;
const HR_MAX_BPM = 220;
const REST_STAGE_IDS = new Set([4, 5, 6]); // LIGHT, DEEP, REM (vs AWAKE(1)/OUT_OF_BED(3))

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hoursBetween(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 3_600_000;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

/* ── Sleep: merge same-night sessions, drop naps, cap sensor-error outliers ────────── */

type CleanSleep = { durationH: number; wakeTimeH: number; sleepMidpointH: number; quality?: number };

function cleanSleepForNight(sessions: RawSleepSession[]): CleanSleep | undefined {
  const real = sessions.filter((s) => hoursBetween(s.startTime, s.endTime) >= NAP_MAX_H);
  if (!real.length) return undefined;

  const totalRaw = real.reduce((sum, s) => sum + hoursBetween(s.startTime, s.endTime), 0);
  const durationH = Math.min(SLEEP_CAP_H, totalRaw);

  const starts = real.map((s) => new Date(s.startTime).getTime());
  const ends = real.map((s) => new Date(s.endTime).getTime());
  const wakeD = new Date(Math.max(...ends));
  const wakeTimeH = wakeD.getHours() + wakeD.getMinutes() / 60;
  const midD = new Date((Math.min(...starts) + Math.max(...ends)) / 2);
  const sleepMidpointH = midD.getHours() + midD.getMinutes() / 60;

  let totalStageMin = 0;
  let restStageMin = 0;
  let anyStages = false;
  for (const s of real) {
    if (!s.stages?.length) continue;
    anyStages = true;
    for (const st of s.stages) {
      const min = hoursBetween(st.startTime, st.endTime) * 60;
      totalStageMin += min;
      if (REST_STAGE_IDS.has(st.stage)) restStageMin += min;
    }
  }
  const quality = anyStages && totalStageMin > 0 ? clamp01(restStageMin / totalStageMin) : undefined;

  return { durationH, wakeTimeH, sleepMidpointH, quality };
}

/* ── Steps: smooth implausible hourly bursts before summing, cap the day total ─────── */

function smoothedStepCount(r: RawStepsRecord): number {
  const durH = Math.max(hoursBetween(r.startTime, r.endTime), 1 / 60); // guard div-by-~0
  const impliedRate = r.count / durH;
  return impliedRate > STEP_HOURLY_SPIKE ? STEP_HOURLY_SPIKE * durH : r.count;
}

/* ── Heart rate: discard readings outside a physiologically plausible range ────────── */

function isPlausibleBpm(bpm: number): boolean {
  return bpm >= HR_MIN_BPM && bpm <= HR_MAX_BPM;
}

/* ── Public API ──────────────────────────────────────────────────────────────────── */

/**
 * Clean + aggregate raw Health Connect records into one entry per calendar day for the
 * last `windowDays` days (oldest first). Missing sleep/steps fall back to a rolling
 * average of the PRECEDING cleaned days in this same window (not the model's population
 * mean — that fallback still happens one layer up, in healthSource.ts, only when there's
 * no rolling average to fall back to either, e.g. day 1 of a brand-new user).
 */
export function cleanHealthConnectDays(
  sleepRecords: RawSleepSession[],
  stepsRecords: RawStepsRecord[],
  heartRateRecords: RawHeartRateRecord[],
  windowDays: number,
): CleanedDay[] {
  const sleepByNight = new Map<string, RawSleepSession[]>();
  for (const r of sleepRecords) {
    const durH = hoursBetween(r.startTime, r.endTime);
    if (durH <= 0 || durH > 24) continue; // physically impossible session — discard outright
    pushTo(sleepByNight, dateKey(new Date(r.endTime)), r); // attribute to the wake day
  }

  const stepsByDay = new Map<string, number>();
  for (const r of stepsRecords) {
    const day = dateKey(new Date(r.startTime));
    stepsByDay.set(day, (stepsByDay.get(day) ?? 0) + smoothedStepCount(r));
  }

  const hrByDay = new Map<string, Array<{ time: string; bpm: number }>>();
  for (const r of heartRateRecords) {
    for (const s of r.samples ?? []) {
      if (!isPlausibleBpm(s.beatsPerMinute)) continue;
      pushTo(hrByDay, dateKey(new Date(s.time)), { time: s.time, bpm: s.beatsPerMinute });
    }
  }

  const dayKeys: string[] = [];
  const today = new Date();
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dayKeys.push(dateKey(d));
  }

  const out: CleanedDay[] = [];
  for (const day of dayKeys) {
    const sleep = cleanSleepForNight(sleepByNight.get(day) ?? []);
    const rawSteps = stepsByDay.get(day);
    const hrSamples = (hrByDay.get(day) ?? []).sort((a, b) => a.time.localeCompare(b.time));

    let stepsK: number | undefined;
    let stepsSource: CleanedDay['stepsSource'] = 'none';
    if (rawSteps != null && rawSteps > 0) {
      stepsK = Math.min(STEPS_CAP, rawSteps) / 1000;
      stepsSource = 'measured';
    } else {
      const recent = out.slice(-3).filter((d) => d.stepsK != null);
      if (recent.length) {
        stepsK = recent.reduce((s, d) => s + d.stepsK!, 0) / recent.length;
        stepsSource = 'threeDayAverage';
      }
    }

    let sleepDurationH: number | undefined;
    let wakeTimeH: number | undefined;
    let sleepMidpointH: number | undefined;
    let sleepQuality: number | undefined;
    let sleepSource: CleanedDay['sleepSource'] = 'none';
    if (sleep) {
      ({ durationH: sleepDurationH, wakeTimeH, sleepMidpointH, quality: sleepQuality } = sleep);
      sleepSource = 'measured';
    } else {
      const recent = out.slice(-7).filter((d) => d.sleepDurationH != null);
      if (recent.length) {
        sleepDurationH = recent.reduce((s, d) => s + d.sleepDurationH!, 0) / recent.length;
        wakeTimeH = recent[recent.length - 1].wakeTimeH;
        sleepMidpointH = recent[recent.length - 1].sleepMidpointH;
        sleepQuality = recent.find((d) => d.sleepQuality != null)?.sleepQuality;
        sleepSource = 'rollingAverage';
      }
    }

    const restingHeartRate = hrSamples.length ? Math.min(...hrSamples.map((s) => s.bpm)) : undefined;
    const morningHeartRate = wakeTimeH != null
      ? (hrSamples.find((s) => {
          const t = new Date(s.time);
          return t.getHours() + t.getMinutes() / 60 >= wakeTimeH!;
        })?.bpm ?? hrSamples[0]?.bpm)
      : hrSamples[0]?.bpm;

    out.push({
      date: day,
      sleepDurationH, wakeTimeH, sleepMidpointH, sleepQuality,
      stepsK, restingHeartRate, morningHeartRate,
      sleepSource, stepsSource,
    });
  }

  return out;
}
