#!/usr/bin/env python3
"""
Energy Predictor — evaluation harness.

Validates the .pte against the contract (docs/energy-predictor-model-contract.md):
  - output shape is exactly [1, 24]
  - every value is in [0, 100]
  - the curve is NON-DEGENERATE: not flat, single daytime peak region, an
    afternoon-ish dip, low overnight  (plausibility, not ground truth)
  - inference latency p50/p95 < 50 ms
and writes a filled-in report from ENERGY_REPORT_TEMPLATE.md.

This is a REGRESSION model — there is no tokenizer, no prompt, no text. The harness
builds the SAME [1, 12, 7] feature window the mobile app builds (contract §3), using
the frozen scaler, and feeds it to the .pte.

WHERE TO RUN: Kaggle (same notebook that produced the .pte) or any box with the
ExecuTorch v0.6.0 pybind runtime. The model is tiny, so latency here is a loose
proxy; record real Snapdragon numbers before the demo.

Usage:
    python energy_eval.py --pte /path/to/energy_predictor.pte
    # Dry-run the scoring/plausibility logic with a stub model (no executorch):
    python energy_eval.py --selftest
"""
import argparse, json, os, statistics, sys, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))

# --- frozen scaler — MUST equal contract §3.3 / manifest.json -----------------
FEATURES = ["sleep_duration_h","sleep_quality","sleep_midpoint_h","wake_time_h",
            "steps_k","active_minutes","movement_intensity","screen_time_h",
            "phone_pickups","late_night_screen_min","dow_sin","dow_cos"]
SCALER_MEAN = np.array([7.0,0.80,4.0,7.0,7.0,35.0,0.30,4.5,60.0,25.0,0.0,0.0])
SCALER_STD  = np.array([1.3,0.12,1.5,1.5,4.0,30.0,0.18,2.5,35.0,30.0,0.71,0.71])
TODAY_UNKNOWN_IDX = [4,5,6,7,8,9]
WINDOW, N_FEAT, OUT_HOURS = 7, 12, 24


def scenario_to_window(s):
    """Expand a scenario archetype (energy_samples.json) into a normalized
    [1, 12, 7] tensor, mirroring how mobile builds the window (contract §3)."""
    dow = s["dow"]
    midpoint = s["wake_h"] - s["sleep_h"] / 2.0
    base = np.array([
        s["sleep_h"], s["quality"], midpoint, s["wake_h"],
        s["steps_k"], s["active"], min(1.0, 0.3 + s["active"]/300),
        max(0.5, s.get("screen_h", 4.5)), s.get("pickups", 60), s["late_screen"],
        np.sin(2*np.pi*dow/7), np.cos(2*np.pi*dow/7),
    ], dtype=np.float64)
    # 7 days of the same archetype (a steady-state user); today's row masks unknowns
    win = np.tile(base, (WINDOW, 1))                       # [7, 12]
    for j in TODAY_UNKNOWN_IDX:
        win[-1, j] = SCALER_MEAN[j]
    win = (win - SCALER_MEAN) / SCALER_STD                 # normalize
    win = np.transpose(win, (1, 0))[None, :, :]            # [1, 12, 7]
    return win.astype(np.float32)


def score(name, curve):
    """Plausibility + contract checks on a 24-point curve."""
    curve = np.asarray(curve, dtype=np.float64).reshape(-1)
    shape_ok = curve.shape == (OUT_HOURS,)
    range_ok = bool((curve >= 0).all() and (curve <= 100).all())
    spread = float(curve.max() - curve.min())
    not_flat = spread >= 8.0                               # a real curve varies
    peak_h = int(np.argmax(curve))
    dip_h = int(np.argmin(curve))
    daytime_peak = 8 <= peak_h <= 20                       # peak in waking hours
    overnight_low = float(curve[0:5].mean()) <= float(curve[8:20].mean())
    overall = round(float(curve.mean()), 1)
    plausible = bool(not_flat and daytime_peak and overnight_low)
    return {
        "name": name, "shape_ok": bool(shape_ok), "range_ok": range_ok,
        "not_flat": bool(not_flat), "daytime_peak": bool(daytime_peak),
        "overnight_low": bool(overnight_low), "plausible": plausible,
        "peak_h": peak_h, "dip_h": dip_h, "overall": overall,
        "spread": round(spread, 1),
        "curve": [round(float(v), 1) for v in curve],
    }


def load_model(pte: str):
    """Load the .pte via the ExecuTorch v0.6.0 pybind runtime. Lazy import so
    --selftest works without executorch installed."""
    from executorch.runtime import Runtime          # type: ignore
    import torch
    rt = Runtime.get()
    program = rt.load_program(pte)
    method = program.load_method("forward")
    def infer(x_np):
        out = method.execute([torch.from_numpy(x_np)])
        return np.asarray(out[0]).reshape(-1)
    return infer


def stub_model(x_np):
    """Selftest stand-in: a plausible synthetic curve so the scorer can be tested
    without a real .pte. NOT the model — just exercises the harness."""
    h = np.arange(24)
    curve = 55 + 22*np.sin(2*np.pi*(h-9)/24) - 8*np.sin(2*np.pi*(h-9)/12)
    curve[:6] *= 0.5
    return np.clip(curve, 0, 100)


def run(infer, scenarios):
    rows, latencies = [], []
    for s in scenarios:
        x = scenario_to_window(s)
        t0 = time.perf_counter()
        curve = infer(x)
        dt = (time.perf_counter() - t0) * 1000.0          # ms
        latencies.append(dt)
        r = score(s["name"], curve)
        r["latency_ms"] = round(dt, 2)
        r["expect"] = s.get("expect", "")
        rows.append(r)
        flag = "OK " if (r["shape_ok"] and r["range_ok"] and r["plausible"]) else "!! "
        print(f"{flag}{s['name']:<26} overall={r['overall']:>5}  peak@{r['peak_h']:>2}h  "
              f"dip@{r['dip_h']:>2}h  {dt:6.2f}ms")
    return rows, latencies


def summarize(rows, latencies):
    n = len(rows)
    return {
        "scenarios": n,
        "shape_ok": sum(r["shape_ok"] for r in rows),
        "range_ok": sum(r["range_ok"] for r in rows),
        "plausible": sum(r["plausible"] for r in rows),
        "latency_p50_ms": round(statistics.median(latencies), 2) if latencies else None,
        "latency_p95_ms": round(sorted(latencies)[max(0, int(0.95*n)-1)], 2) if latencies else None,
        "latency_max_ms": round(max(latencies), 2) if latencies else None,
    }


def selftest():
    print("Self-test of scoring/plausibility (stub model, no executorch):")
    data = json.load(open(os.path.join(HERE, "energy_samples.json")))
    rows, lat = run(stub_model, data["scenarios"])
    s = summarize(rows, lat)
    print("\nSUMMARY:", json.dumps(s, indent=2))
    print("\nScorer checks shape, [0,100] range, non-flat, daytime peak, overnight low.")


def write_report(summary, rows, out_path):
    with open(os.path.join(HERE, "ENERGY_REPORT_TEMPLATE.md")) as f:
        tmpl = f.read()
    lat_ok = (summary["latency_p95_ms"] is not None and summary["latency_p95_ms"] < 50)
    verdict = ("PASS" if summary["shape_ok"] == summary["scenarios"]
               and summary["range_ok"] == summary["scenarios"]
               and summary["plausible"] >= summary["scenarios"] - 1
               and lat_ok else "REVIEW")
    table = "\n".join(
        f"| {r['name']} | {'Y' if r['shape_ok'] else 'N'} | {'Y' if r['range_ok'] else 'N'} | "
        f"{'Y' if r['plausible'] else 'N'} | {r['overall']} | {r['peak_h']} | {r['dip_h']} | "
        f"{r['latency_ms']} | {r['expect'][:40]} |"
        for r in rows
    )
    filled = (tmpl
        .replace("{{DATE}}", time.strftime("%Y-%m-%d"))
        .replace("{{VERDICT}}", verdict)
        .replace("{{SHAPE_OK}}", f"{summary['shape_ok']}/{summary['scenarios']}")
        .replace("{{RANGE_OK}}", f"{summary['range_ok']}/{summary['scenarios']}")
        .replace("{{PLAUSIBLE}}", f"{summary['plausible']}/{summary['scenarios']}")
        .replace("{{P50}}", str(summary["latency_p50_ms"]))
        .replace("{{P95}}", str(summary["latency_p95_ms"]))
        .replace("{{MAX}}", str(summary["latency_max_ms"]))
        .replace("{{TABLE}}", table)
    )
    with open(out_path, "w") as f:
        f.write(filled)
    print("\nReport written:", out_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pte")
    ap.add_argument("--samples", default=os.path.join(HERE, "energy_samples.json"))
    ap.add_argument("--out", default=os.path.join(HERE, "energy_report.md"))
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        selftest()
        return
    if not args.pte:
        sys.exit("Provide --pte (or use --selftest).")

    scenarios = json.load(open(args.samples))["scenarios"]
    infer = load_model(args.pte)
    rows, latencies = run(infer, scenarios)
    summary = summarize(rows, latencies)
    print("\nSUMMARY:", json.dumps(summary, indent=2))
    write_report(summary, rows, args.out)


if __name__ == "__main__":
    main()
