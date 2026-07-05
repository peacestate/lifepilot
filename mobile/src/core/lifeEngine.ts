/**
 * lifeEngine — the cross-feature daily insight ("the unicorn move"). Pure rule-based
 * logic reading each feature's own ALREADY-COMPUTED output — no new model, no new data
 * collection, and deliberately no second inference pass. Reads straight from what's
 * already persisted (personalHistory day records, the in-memory hydration store,
 * overwhelmMemory) rather than calling useEnergyPredictor()/useHydrationTracker() again —
 * those are already kept alive app-wide by App.tsx's NudgeChecks; calling them a second
 * time here would mean a second, redundant model-inference pass just to re-derive numbers
 * that already exist.
 *
 * Deliberately does NOT reference any scheduled/calendar task time — Overwhelm Manager has
 * no such concept (step breakdowns only, no due times), so a sentence claiming a task was
 * "scheduled" at a specific hour would be fabricated. Every sentence here traces to a real,
 * already-stored value:
 *   - Energy's focus/dip/wind-down windows, re-derived (pure function, no model call) from
 *     today's already-persisted predicted curve.
 *   - Hydration's pace-based deficit — same formula HydrationEngine.decideNudge uses, read
 *     directly here rather than through the nudge/notification pipeline, since this is a
 *     summary insight (shown on Home), not a push gated by quiet-hours/de-bounce.
 *   - Overwhelm's most recently active, not-yet-finished task.
 *   - A real week-over-week join of Energy's and Hydration's own daily history (no new
 *     model — just reading two already-stored series by matching date).
 *
 * Rules are priority-ordered and capped (MAX_SENTENCES) so the card stays a short, calm
 * read rather than a dump of every rule that happens to be true right now.
 */
import { dayEnergyAvg, type EnergyDayRecord } from '../features/energy/energyCalibration';
import { deriveForecast } from '../features/energy/EnergyForecast';
import type { EnergyForecast, EnergyWindow } from '../features/energy/types';
import { paceDeficitMl } from '../features/hydration/HydrationEngine';
import { hydrationStore } from '../features/hydration/hydrationStore';
import type { HydrationDayRecord } from '../features/hydration/hydrationCalibration';
import { overwhelmMemory } from '../features/overwhelm/overwhelmMemory';
import { personalHistory } from './rag/personalHistory';

export type LifeInsight = {
  /** Short sentences, ready to display as-is. */
  sentences: string[];
  hasFocusWindow: boolean;
  hasHydrationBehind: boolean;
  hasActiveTask: boolean;
};

const MEANINGFUL_DEFICIT_ML = 200; // below this, "behind pace" is rounding noise, not worth surfacing
const NEAR_HOUR_WINDOW = 1;         // "currently in the dip" tolerance, in hours
const WIND_DOWN_LEAD_HOURS = 2;     // "wind-down is approaching" lead time
const MIN_BUCKET_DAYS = 2;          // minimum days per side of the weekly hydration/energy join
const MIN_UPLIFT_PCT = 5;           // below this, the correlation is noise, not worth a claim
const MAX_SENTENCES = 3;            // keep the Home-screen card short and calm

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const fmtHour = (h: number) => {
  const x = h % 12 === 0 ? 12 : h % 12;
  return `${x}${h < 12 ? 'am' : 'pm'}`;
};

function fmtMl(ml: number): string {
  return ml >= 1000 ? `${(ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 1)}L` : `${Math.round(ml)}ml`;
}

/** Hours from now until an hour-of-day target, 0..23 (wraps forward if the hour already passed today). */
function hoursUntil(targetHour: number, nowHour: number): number {
  return ((targetHour - nowHour) % 24 + 24) % 24;
}

/** Circular distance between two hours-of-day, 0..12. */
function hourDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}

/** Today's full Energy forecast, re-derived (pure function, no model call) from the
 * already-persisted predicted curve. */
async function todaysEnergyForecast(): Promise<EnergyForecast | undefined> {
  const today = await personalHistory.getDay('energy', todayKey());
  const rec = today?.data as EnergyDayRecord | undefined;
  if (!rec?.predictedCurve?.length) return undefined;
  return deriveForecast(rec.predictedCurve, 7, rec.basis ?? 'model');
}

/** How far behind today's hydration pace the user is right now, in mL (0 if on pace/ahead/no data). */
async function todaysHydrationDeficitMl(nowHour: number): Promise<number> {
  const today = await personalHistory.getDay('hydration', todayKey());
  const rec = today?.data as HydrationDayRecord | undefined;
  if (!rec?.targetMl) return 0;
  const profile = hydrationStore.getProfile();
  const loggedMl = hydrationStore.loggedMl();
  return Math.max(0, paceDeficitMl(rec.targetMl, loggedMl, profile.wakeHour, profile.bedHour, nowHour));
}

/** The most recently touched task that isn't fully checked off yet. */
async function activeOverwhelmTask(): Promise<string | undefined> {
  const tasks = await overwhelmMemory.list();
  const active = tasks
    .filter((t) => t.completedSteps < t.totalSteps)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return active?.taskText;
}

/**
 * Real week-over-week correlation: among the last ~2 weeks of COMPLETED days, split into
 * "hit hydration target" vs "missed it" using Hydration's own stored actual/target, then
 * compare each bucket's average energy using Energy's own stored curve/check-ins for the
 * SAME dates. No new model — a join of two already-persisted series by date. Undefined
 * below a 2-day-per-bucket minimum (not enough signal) or below a 5% uplift (noise).
 */
async function hydrationEnergyUpliftPct(lookbackDays = 14): Promise<number | undefined> {
  const [energyEntries, hydrationEntries] = await Promise.all([
    personalHistory.getRecent('energy', lookbackDays + 1),
    personalHistory.getRecent('hydration', lookbackDays + 1),
  ]);
  const today = todayKey();
  const hydByDate = new Map(
    hydrationEntries
      .filter((e) => e.date !== today)
      .map((e) => [e.date, e.data as HydrationDayRecord] as const),
  );

  const hitDaysEnergy: number[] = [];
  const missDaysEnergy: number[] = [];
  for (const e of energyEntries) {
    if (e.date === today) continue;
    const hyd = hydByDate.get(e.date);
    if (!hyd?.targetMl || hyd.actualMl == null) continue;
    const energy = dayEnergyAvg(e.data as EnergyDayRecord);
    if (energy == null) continue;
    (hyd.actualMl >= hyd.targetMl ? hitDaysEnergy : missDaysEnergy).push(energy);
  }

  if (hitDaysEnergy.length < MIN_BUCKET_DAYS || missDaysEnergy.length < MIN_BUCKET_DAYS) return undefined;
  const hitAvg = hitDaysEnergy.reduce((a, b) => a + b, 0) / hitDaysEnergy.length;
  const missAvg = missDaysEnergy.reduce((a, b) => a + b, 0) / missDaysEnergy.length;
  if (missAvg <= 0) return undefined;
  const pct = Math.round(((hitAvg - missAvg) / missAvg) * 100);
  return pct >= MIN_UPLIFT_PCT ? pct : undefined;
}

/** Compute today's cross-feature insight. Returns undefined if nothing real to say yet. */
export async function computeLifeInsight(nowMs = Date.now()): Promise<LifeInsight | undefined> {
  const nowHour = new Date(nowMs).getHours();

  const [forecast, behindMl, activeTask, upliftPct] = await Promise.all([
    todaysEnergyForecast(),
    todaysHydrationDeficitMl(nowHour),
    activeOverwhelmTask(),
    hydrationEnergyUpliftPct(),
  ]);

  const focus = forecast?.windows.find((w) => w.kind === 'focus');
  const rest = forecast?.windows.find((w) => w.kind === 'rest');
  const inDip = !!forecast && hourDistance(nowHour, forecast.dip.hour) <= NEAR_HOUR_WINDOW;
  const windDownApproaching =
    !!rest && hoursUntil(rest.startHour, nowHour) <= WIND_DOWN_LEAD_HOURS && hoursUntil(rest.endHour, nowHour) > 0;

  const hasFocusWindow = !!focus;
  const hasHydrationBehind = behindMl >= MEANINGFUL_DEFICIT_ML;
  const hasActiveTask = !!activeTask;

  if (!hasFocusWindow && !hasHydrationBehind && !hasActiveTask && upliftPct == null) return undefined;

  const sentences: string[] = [];

  // --- task + timing (priority: dip caution > focus timing > task alone > focus alone) ---
  if (hasActiveTask && inDip) {
    sentences.push(`You're in your usual energy dip right now — "${activeTask}" may feel harder than usual. A short break, or tackling it after your focus window, might help.`);
  } else if (hasActiveTask && hasFocusWindow) {
    const hrsAway = hoursUntil(focus!.startHour, nowHour);
    const timing =
      hrsAway === 0 ? 'your peak focus window is right now'
      : hrsAway === 1 ? 'your peak focus hits in 1 hour'
      : `your peak focus hits in ${hrsAway} hours`;
    sentences.push(`You have "${activeTask}" unfinished and ${timing}.`);
  } else if (hasActiveTask) {
    sentences.push(`You have "${activeTask}" in progress.`);
  } else if (hasFocusWindow) {
    sentences.push(`Your peak focus is ${fmtHour(focus!.startHour)}–${fmtHour(focus!.endHour)} today.`);
  }

  // --- hydration (priority: wind-down-aware > plain behind-pace) ---
  if (hasHydrationBehind && windDownApproaching) {
    sentences.push(`Your wind-down window starts soon and you're still ${fmtMl(behindMl)} behind on water — hydrate before you settle in for the night.`);
  } else if (hasHydrationBehind) {
    sentences.push(`Drink a glass of water now — you're ${fmtMl(behindMl)} behind, and low hydration drops focus.`);
  }

  // --- weekly cross-feature correlation (retrospective, always last) ---
  if (upliftPct != null && sentences.length < MAX_SENTENCES) {
    sentences.push(`On days you hit your hydration target, your energy runs about ${upliftPct}% higher.`);
  }

  return { sentences: sentences.slice(0, MAX_SENTENCES), hasFocusWindow, hasHydrationBehind, hasActiveTask };
}
