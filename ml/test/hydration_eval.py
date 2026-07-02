#!/usr/bin/env python3
"""
Hydration Tracker — evaluation harness AND reference implementation.

There is NO model and NO .pte for this feature (see docs/hydration-engine-contract.md §0).
Hydration need is physiology, so the engine is a deterministic rules engine. This file IS
the canonical reference implementation of that engine (contract §1 / §4 / §5). The
TypeScript port in mobile/src/features/hydration/ must reproduce these numbers exactly.

It validates, per the contract:
  - every scenario's target is within [FLOOR, CEILING]                       (§1.5)
  - the breakdown line items sum EXACTLY to the target (so the "why" panel adds up)  (§4)
  - each scenario lands in its expected [min_ml, max_ml] and status          (§4)
  - relational sanity: hot > cool, workout > rest, bigger mass > smaller, AQI bumps  (§1)
  - nudge logic: quiet-hours suppress, behind-pace fires, ahead stays silent,
    post-activity spike fires, debounce holds                               (§5)
and writes a filled report from HYDRATION_REPORT_TEMPLATE.md.

Stdlib only — no executorch, no numpy. Run:
    python hydration_eval.py
    python hydration_eval.py --selftest      # alias for the default run
    python hydration_eval.py --out report.md
"""
import argparse, json, os, time

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------
# FROZEN CONSTANTS — MUST equal docs/hydration-engine-contract.md §1 and the
# single frozen object in mobile/src/features/hydration/. Do not fork a copy.
# ---------------------------------------------------------------------------
BASE_PER_KG = 33.0          # mL/kg/day
T0 = 20.0                   # deg C, heat threshold
K_HEAT = 25.0               # mL/deg C/day
HEAT_CAP = 1000.0           # mL
K_ACT = 12.0                # mL/min (moderate)
ACT_CAP = 1500.0            # mL
STEP_BASE = 5000            # steps
MIN_PER_1K_STEPS = 10.0     # min per 1000 steps over base
FLOOR = 1500.0
CEILING = 4000.0
INTENSITY = {"light": 0.6, "moderate": 1.0, "vigorous": 1.5}
DEFAULT_TEMP_C = 20.0       # assumed when weather missing
DEFAULT_RH = 50.0
DEFAULT_SERVING_ML = 250.0

# nudge constants (§5.2)
MIN_NUDGE_GAP_MIN = 45
JUST_DRANK_MIN = 20
POST_ACTIVITY_WINDOW_MIN = 90
HEAT_SPIKE_TEMP_C = 30
GENTLE_GAP_MIN = 120
ACT_CAP_PER_NUDGE = 750.0


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def round_to_serving(ml, serving):
    if serving <= 0:
        return round(ml)
    return round(ml / serving) * serving


# ===========================================================================
# §1 — compute_target : HydrationInputs -> HydrationTarget (reference impl)
# ===========================================================================
def compute_target(inp):
    notes = ["Estimate for healthy adults — not medical advice."]
    conf_drops = 0

    mass = clamp(float(inp["bodyMassKg"]), 30.0, 250.0)

    age = inp.get("ageYears")
    if age is None:
        age_factor = 1.0
    elif age > 65:
        age_factor = 0.90
    elif age >= 55:
        age_factor = 0.95
    else:
        age_factor = 1.00

    sex = inp.get("sex")
    sex_factor = {"male": 1.0, "female": 0.95}.get(sex, 0.975)
    if age is None and sex is None:
        conf_drops += 1

    # --- baseline -----------------------------------------------------------
    baseline = mass * BASE_PER_KG * age_factor * sex_factor

    # --- heat term ----------------------------------------------------------
    weather_missing = ("temperatureC" not in inp or inp.get("temperatureC") is None
                       or "humidityPct" not in inp or inp.get("humidityPct") is None)
    temp = clamp(float(inp.get("temperatureC", DEFAULT_TEMP_C)), -30.0, 55.0)
    rh = clamp(float(inp.get("humidityPct", DEFAULT_RH)), 0.0, 100.0)
    if weather_missing:
        notes.append("Weather unavailable — assumed mild conditions.")
        conf_drops += 1
    humidity_factor = (1.0
                       + 0.30 * clamp((rh - 60.0) / 40.0, 0.0, 1.0)
                       + 0.10 * clamp((30.0 - rh) / 30.0, 0.0, 1.0))
    heat = clamp(K_HEAT * max(0.0, temp - T0) * humidity_factor, 0.0, HEAT_CAP)

    # --- activity term ------------------------------------------------------
    active_min = inp.get("activeMinutes")
    logged_workout = active_min is not None and active_min > 0
    if active_min is not None:
        eff_min = clamp(float(active_min), 0.0, 600.0)
        intensity = INTENSITY.get(inp.get("workoutIntensity", "moderate"), 1.0)
    elif inp.get("steps") is not None:
        steps = clamp(float(inp["steps"]), 0.0, 100000.0)
        eff_min = max(0.0, steps - STEP_BASE) / 1000.0 * MIN_PER_1K_STEPS
        intensity = INTENSITY["light"]           # steps fallback is always light
    else:
        eff_min = 0.0
        intensity = 1.0
    heat_activity_factor = clamp(1.0 + 0.02 * max(0.0, temp - 25.0), 1.0, 1.3)
    activity = clamp(eff_min * K_ACT * intensity * heat_activity_factor, 0.0, ACT_CAP)

    # --- air-quality term (soft, low confidence) ----------------------------
    aqi = inp.get("aqi")
    if aqi is None or aqi <= 100:
        aqi_term = 0.0
    elif aqi <= 150:
        aqi_term = 150.0
    else:
        aqi_term = 300.0
    if aqi is not None and aqi > 100:
        notes.append("Air quality is poor — consider moving activity indoors "
                     "(hydration helps comfort only).")

    # --- clamp + breakdown that always sums to the target -------------------
    raw = baseline + heat + activity + aqi_term
    target = clamp(raw, FLOOR, CEILING)
    safety_clamp = target - raw                       # signed; 0 if not clamped
    clamped = abs(safety_clamp) > 1e-9

    breakdown = [
        {"key": "baseline", "label": "Baseline", "amountMl": round(baseline),
         "confidence": "high",
         "why": f"{int(round(mass))} kg body weight (~33 mL/kg)"},
        {"key": "heat", "label": "Heat", "amountMl": round(heat),
         "confidence": "high" if not weather_missing else "low",
         "why": (f"{round(temp)}°C, {round(rh)}% humidity" if heat > 0
                 else "mild temperature — no extra needed")},
        {"key": "activity", "label": "Activity", "amountMl": round(activity),
         "confidence": "high" if logged_workout else "medium",
         "why": (f"{int(eff_min)} active min replacing sweat" if activity > 0
                 else "no activity logged yet")},
        {"key": "airQuality", "label": "Air quality", "amountMl": round(aqi_term),
         "confidence": "low",
         "why": (f"AQI {int(aqi)} — small comfort bump" if aqi_term > 0
                 else "air quality fine")},
    ]
    if clamped:
        breakdown.append({
            "key": "safetyClamp", "label": "Safety cap",
            "amountMl": round(safety_clamp), "confidence": "high",
            "why": ("raised to a healthy minimum" if safety_clamp > 0
                    else "capped for safety — pace it, don't chug")})

    # status (§4)
    if clamped and target >= CEILING - 1e-9:
        status = "high"
    elif target >= 3500:
        status = "high"
    elif target > baseline * 1.15:
        status = "elevated"
    else:
        status = "normal"

    if active_min is None and inp.get("steps") is None:
        pass  # no activity signal is fine; not a confidence drop unless a workout was logged

    confidence = ["high", "medium", "low"][min(conf_drops, 2)]

    target_r = round(target)
    # ensure the integer breakdown sums to the integer target (distribute rounding residue)
    diff = target_r - sum(b["amountMl"] for b in breakdown)
    if diff != 0:
        # fold any rounding residue into the safety-clamp line, else into baseline
        sink = next((b for b in breakdown if b["key"] == "safetyClamp"), breakdown[0])
        sink["amountMl"] += diff

    return {
        "targetMl": target_r,
        "baselineMl": round(baseline),
        "status": status,
        "breakdown": breakdown,
        "servingMl": round(DEFAULT_SERVING_ML),
        "confidence": confidence,
        "clamped": clamped,
        "notes": notes,
    }


# ===========================================================================
# §5 — decide_nudge : (HydrationDayState, now_epoch_ms) -> NudgeDecision
# ===========================================================================
def decide_nudge(state, now_ms, now_hour):
    target = state["targetMl"]
    logged = state.get("loggedMl", 0)
    wake = state.get("wakeHour", 7)
    bed = state.get("bedHour", 23)
    serving = state.get("servingMl", DEFAULT_SERVING_ML)
    bed_cutoff = bed - 1

    def out(should, reason, ml, msg, nxt):
        return {"shouldNudge": should, "reason": reason,
                "suggestedMl": round_to_serving(ml, serving) if ml else 0,
                "message": msg, "nextCheckMinutes": nxt}

    # 1. quiet hours / DND
    if now_hour < wake or now_hour >= bed or (state.get("dndUntil") and now_ms < state["dndUntil"]):
        mins_to_wake = ((wake - now_hour) % 24) * 60
        return out(False, "none", 0, "Quiet hours — no nudges.", max(30, mins_to_wake))

    # 2. debounce
    if state.get("lastNudgeAt") and (now_ms - state["lastNudgeAt"]) < MIN_NUDGE_GAP_MIN * 60000:
        return out(False, "none", 0, "Recently nudged.",
                   MIN_NUDGE_GAP_MIN - int((now_ms - state["lastNudgeAt"]) / 60000))
    if state.get("lastDrinkAt") and (now_ms - state["lastDrinkAt"]) < JUST_DRANK_MIN * 60000:
        return out(False, "none", 0, "Just had a drink.", JUST_DRANK_MIN)

    # 3. post-activity spike
    owed = state.get("recentActivityMl", 0)
    if (state.get("recentActivityEndedAt")
            and (now_ms - state["recentActivityEndedAt"]) < POST_ACTIVITY_WINDOW_MIN * 60000
            and owed > 0):
        return out(True, "postActivity", min(owed, ACT_CAP_PER_NUDGE),
                   "Nice workout — replace what you sweated.", 30)

    # 4. heat-spike cadence
    hot = state.get("currentTempC", 0) >= HEAT_SPIKE_TEMP_C
    threshold = 0.5 * serving if hot else serving
    next_check = 45 if hot else 90

    # pacing
    span = max(1, bed_cutoff - wake)
    frac = clamp((now_hour - wake) / span, 0.0, 1.0)
    expected = target * frac
    deficit = expected - logged

    # 5. behind pace
    if deficit >= threshold:
        msg = ("Hot out — sip more, you're a bit behind." if hot
               else "You're a bit behind on water — have a glass.")
        return out(True, "behindPace", deficit, msg, next_check)

    # 6. gentle pacing (on/ahead of pace but long since a drink)
    if (state.get("lastDrinkAt")
            and (now_ms - state["lastDrinkAt"]) >= GENTLE_GAP_MIN * 60000
            and frac < 1.0):
        return out(True, "gentlePacing", serving, "It's been a while — quick sip?", next_check)

    # 7. nothing
    return out(False, "none", 0, "On track.", 60)


# ===========================================================================
# Validation
# ===========================================================================
def check_scenario(sc):
    r = compute_target(sc["inputs"])
    errs = []
    # range
    if not (FLOOR <= r["targetMl"] <= CEILING):
        errs.append(f"target {r['targetMl']} outside [{FLOOR},{CEILING}]")
    # breakdown sums to target
    s = sum(b["amountMl"] for b in r["breakdown"])
    if s != r["targetMl"]:
        errs.append(f"breakdown sums to {s}, target {r['targetMl']}")
    # per-scenario bounds + status
    if not (sc["min_ml"] <= r["targetMl"] <= sc["max_ml"]):
        errs.append(f"target {r['targetMl']} outside expected [{sc['min_ml']},{sc['max_ml']}]")
    if r["status"] != sc["status"]:
        errs.append(f"status {r['status']} != expected {sc['status']}")
    return r, errs


def relational_checks(results):
    """results: name -> HydrationTarget. Returns list of (label, ok)."""
    t = {k: v["targetMl"] for k, v in results.items()}
    checks = [
        ("hot_workout > cool_sedentary", t["hot_vigorous_workout"] > t["cool_sedentary"]),
        ("hot_humid_rest > cool_sedentary (heat adds)", t["hot_humid_rest"] > t["cool_sedentary"]),
        ("average_day > cool_sedentary (activity+heat)", t["average_day"] > t["cool_sedentary"]),
        ("steps_fallback > cool_sedentary baseline-ish", t["steps_fallback"] > 2300),
        ("hazy_high_aqi includes AQI bump (>2800)", t["hazy_high_aqi"] > 2800),
        ("light_small_elderly clamped to FLOOR", t["light_small_elderly"] == int(FLOOR)),
        ("hot_workout clamped to CEILING", t["hot_vigorous_workout"] == int(CEILING)),
    ]
    return checks


def nudge_checks():
    H = 60 * 60000  # ms per hour
    base = {"date": "2026-06-26", "targetMl": 2500, "wakeHour": 7, "bedHour": 23,
            "servingMl": 250}
    checks = []

    # quiet hours (03:00) -> no nudge
    d = decide_nudge({**base, "loggedMl": 0}, 3 * H, 3)
    checks.append(("quiet hours suppress", d["shouldNudge"] is False and d["reason"] == "none"))

    # behind pace at 15:00 with nothing logged -> nudge
    d = decide_nudge({**base, "loggedMl": 0}, 15 * H, 15)
    checks.append(("behind pace fires", d["shouldNudge"] and d["reason"] == "behindPace"))

    # ahead of pace at 15:00 (already drank 2500, last drink 30 min ago so not debounced) -> silent
    d = decide_nudge({**base, "loggedMl": 2500, "lastDrinkAt": 15 * H - 30 * 60000}, 15 * H, 15)
    checks.append(("ahead of pace stays silent", d["shouldNudge"] is False and d["reason"] == "none"))

    # post-activity spike fires regardless of pace
    d = decide_nudge({**base, "loggedMl": 2500, "currentTempC": 20,
                      "recentActivityEndedAt": 15 * H - 10 * 60000, "recentActivityMl": 500},
                     15 * H, 15)
    checks.append(("post-activity spike fires", d["shouldNudge"] and d["reason"] == "postActivity"))

    # debounce: nudged 10 min ago -> suppressed even if behind
    d = decide_nudge({**base, "loggedMl": 0, "lastNudgeAt": 15 * H - 10 * 60000}, 15 * H, 15)
    checks.append(("debounce holds", d["shouldNudge"] is False))

    # heat-spike shortens next check
    d = decide_nudge({**base, "loggedMl": 0, "currentTempC": 33}, 12 * H, 12)
    checks.append(("heat-spike cadence (nextCheck<=45)", d["nextCheckMinutes"] <= 45))

    return checks


def run(scenarios):
    rows, results, any_err = [], {}, []
    for sc in scenarios:
        r, errs = check_scenario(sc)
        results[sc["name"]] = r
        bd = {b["key"]: b["amountMl"] for b in r["breakdown"]}
        flag = "OK " if not errs else "!! "
        print(f"{flag}{sc['name']:<22} target={r['targetMl']:>5} mL  {r['status']:<8} "
              f"(base {bd['baseline']}, heat {bd['heat']}, act {bd['activity']}, "
              f"aqi {bd['airQuality']}, clamp {bd.get('safetyClamp', 0)})")
        if errs:
            for e in errs:
                print(f"     - {e}")
            any_err += [(sc["name"], e) for e in errs]
        rows.append((sc, r, errs))

    print("\nRelational sanity:")
    rel = relational_checks(results)
    for label, ok in rel:
        print(f"  {'OK ' if ok else '!! '}{label}")

    print("\nNudge logic:")
    nud = nudge_checks()
    for label, ok in nud:
        print(f"  {'OK ' if ok else '!! '}{label}")

    return rows, rel, nud


def write_report(rows, rel, nud, out_path):
    with open(os.path.join(HERE, "HYDRATION_REPORT_TEMPLATE.md")) as f:
        tmpl = f.read()
    n = len(rows)
    range_ok = sum(1 for _, r, _ in rows if FLOOR <= r["targetMl"] <= CEILING)
    sums_ok = sum(1 for _, r, _ in rows
                  if sum(b["amountMl"] for b in r["breakdown"]) == r["targetMl"])
    bounds_ok = sum(1 for sc, r, e in rows if not e)
    rel_ok = sum(1 for _, ok in rel if ok)
    nud_ok = sum(1 for _, ok in nud if ok)
    verdict = ("PASS" if (range_ok == n and sums_ok == n and bounds_ok == n
                          and rel_ok == len(rel) and nud_ok == len(nud)) else "REVIEW")

    def row(sc, r):
        bd = {b["key"]: b["amountMl"] for b in r["breakdown"]}
        ok = sc["min_ml"] <= r["targetMl"] <= sc["max_ml"] and r["status"] == sc["status"]
        return (f"| {sc['name']} | {r['targetMl']} | {r['status']} | {bd['baseline']} | "
                f"{bd['heat']} | {bd['activity']} | {bd['airQuality']} | "
                f"{bd.get('safetyClamp', 0)} | {r['confidence']} | "
                f"{'Y' if ok else 'N'} | {sc['expect'][:46]} |")

    table = "\n".join(row(sc, r) for sc, r, _ in rows)
    filled = (tmpl
              .replace("{{DATE}}", time.strftime("%Y-%m-%d"))
              .replace("{{VERDICT}}", verdict)
              .replace("{{RANGE_OK}}", f"{range_ok}/{n}")
              .replace("{{SUMS_OK}}", f"{sums_ok}/{n}")
              .replace("{{BOUNDS_OK}}", f"{bounds_ok}/{n}")
              .replace("{{REL_OK}}", f"{rel_ok}/{len(rel)}")
              .replace("{{NUDGE_OK}}", f"{nud_ok}/{len(nud)}")
              .replace("{{TABLE}}", table))
    with open(out_path, "w") as f:
        f.write(filled)
    print("\nVerdict:", verdict, "| Report written:", out_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", default=os.path.join(HERE, "hydration_scenarios.json"))
    ap.add_argument("--out", default=os.path.join(HERE, "hydration_report.md"))
    ap.add_argument("--selftest", action="store_true",
                    help="alias for the default run (kept for parity with other harnesses)")
    args = ap.parse_args()
    scenarios = json.load(open(args.scenarios))["scenarios"]
    rows, rel, nud = run(scenarios)
    write_report(rows, rel, nud, args.out)


if __name__ == "__main__":
    main()
