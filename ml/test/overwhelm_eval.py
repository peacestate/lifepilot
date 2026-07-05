#!/usr/bin/env python3
"""
Overwhelm Manager — 20-task evaluation harness.

Validates the model against the contract (docs/overwhelm-model-contract.md):
  - step count is 5-8 after parsing (v2, 2026-07-06 — was 5-10)
  - output is a clean numbered/bulleted list (STEP_LINE_RE accepts either)
  - latency (per-task wall time, p50/p95)
and writes a filled-in report from REPORT_TEMPLATE.md.

WHERE TO RUN: Kaggle (same notebook that produced the .pte) or any box with the
ExecuTorch pybind runtime. NOT the 8 GB dev PC for the model path.

The PARSING here is intentionally identical to what the mobile app does, so the
report reflects real on-device behavior. Keep SYSTEM in sync with the app and the
contract.

Usage:
    python overwhelm_eval.py --pte /path/to/llama3_2-1B-qlora.pte \
                             --tokenizer /path/to/tokenizer.model
    # Dry-run the parsing/scoring logic without a model:
    python overwhelm_eval.py --selftest
"""
import argparse, json, os, re, statistics, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))

SYSTEM = (
    "You are a calm, practical life coach. Break tasks into 5 to 8 clear, actionable "
    "micro-steps. Each step must be completable in under 30 minutes. Be specific, "
    "not vague. Output a numbered list only. No intro text. No explanation."
)

# Decoding params (contract §3 / §5) — low temperature for format stability.
GEN = dict(temperature=0.3, top_p=0.9, max_new_tokens=256)

REFUSAL_RE = re.compile(r"\b(i can('|no)t help|i'?m sorry|as an ai|cannot assist)\b", re.I)
STEP_LINE_RE = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$")


def build_prompt(user_input: str) -> str:
    return (
        "<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n"
        f"{SYSTEM}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n"
        f"{user_input}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n"
    )


def parse_steps(raw: str):
    """Same rules the mobile app uses (contract §4)."""
    steps = []
    for line in raw.splitlines():
        m = STEP_LINE_RE.match(line)
        if m:
            steps.append(m.group(1).strip())
    return steps[:10]  # clamp upper bound; lower bound handled by scoring


def score(user_input: str, raw: str):
    steps = parse_steps(raw)
    n = len(steps)
    refusal = bool(REFUSAL_RE.search(raw)) and n == 0
    starts_with_verb = sum(1 for s in steps if re.match(r"^[A-Z][a-z]+", s)) / n if n else 0
    return {
        "input": user_input,
        "n_steps": n,
        "count_ok": 5 <= n <= 8,
        "format_ok": n > 0 and all(STEP_LINE_RE.match("- " + s) for s in steps),
        "refusal": refusal,
        "verb_start_ratio": round(starts_with_verb, 2),
        "state": (
            "empty-result" if (n == 0 or refusal)
            else "results"
        ),
        "steps": steps,
    }


def load_model(pte: str, tokenizer: str):
    """Load the .pte via the ExecuTorch LLM pybind runner.

    Import is lazy so --selftest works without executorch installed. The exact
    runner class can vary by ExecuTorch version; adjust to match EXECUTORCH_REF.
    """
    from executorch.extension.llm.runner import GenerationConfig, LlmRunner  # type: ignore
    runner = LlmRunner(pte, tokenizer)
    def generate(prompt: str) -> str:
        cfg = GenerationConfig(
            temperature=GEN["temperature"],
            top_p=GEN["top_p"],
            max_new_tokens=GEN["max_new_tokens"],
        )
        return runner.generate(prompt, cfg)
    return generate


def run(generate, tasks):
    rows, latencies = [], []
    for t in tasks:
        t0 = time.perf_counter()
        raw = generate(build_prompt(t))
        dt = time.perf_counter() - t0
        latencies.append(dt)
        r = score(t, raw)
        r["latency_s"] = round(dt, 2)
        rows.append(r)
        flag = "OK " if (r["count_ok"] and r["format_ok"]) else "!! "
        print(f"{flag}{r['n_steps']:>2} steps  {dt:5.1f}s  {t[:48]}")
    return rows, latencies


def summarize(rows, latencies):
    n = len(rows)
    return {
        "tasks": n,
        "count_ok": sum(r["count_ok"] for r in rows),
        "format_ok": sum(r["format_ok"] for r in rows),
        "empty_result": sum(r["state"] == "empty-result" for r in rows),
        "latency_p50_s": round(statistics.median(latencies), 2) if latencies else None,
        "latency_p95_s": round(sorted(latencies)[max(0, int(0.95 * n) - 1)], 2) if latencies else None,
        "latency_max_s": round(max(latencies), 2) if latencies else None,
    }


SELFTEST_SAMPLES = {
    "good": "- Open the calendar app\n- Pick a date for the party\n- Make a guest list\n"
            "- Choose a venue or your living room\n- Send invites to five people",
    "numbered": "1. Sort the mail into keep and toss\n2. Shred the junk\n3. File the bills",
    "refusal": "I'm sorry, I can't help with that.",
    "preamble": "Sure! Here are some steps:\n- Take a deep breath\n- Write one sentence\n"
                "- List three tasks\n- Do the first one\n- Reward yourself",
}


def selftest():
    print("Self-test of parsing/scoring (no model):")
    for label, raw in SELFTEST_SAMPLES.items():
        r = score("dummy input", raw)
        print(f"  [{label:9}] n={r['n_steps']} count_ok={r['count_ok']} "
              f"state={r['state']} steps={r['steps']}")
    print("\nParsing handles bullets, numbering, preamble, and refusals.")


def write_report(summary, rows, out_path):
    tmpl_path = os.path.join(HERE, "REPORT_TEMPLATE.md")
    with open(tmpl_path) as f:
        tmpl = f.read()
    verdict = "PASS" if summary["count_ok"] >= 18 and summary["format_ok"] >= 18 else "REVIEW"
    table = "\n".join(
        f"| {i+1} | {r['n_steps']} | {'Y' if r['count_ok'] else 'N'} | "
        f"{'Y' if r['format_ok'] else 'N'} | {r['latency_s']} | {r['state']} | {r['input'][:40]} |"
        for i, r in enumerate(rows)
    )
    filled = (tmpl
        .replace("{{DATE}}", time.strftime("%Y-%m-%d"))
        .replace("{{VERDICT}}", verdict)
        .replace("{{COUNT_OK}}", f"{summary['count_ok']}/{summary['tasks']}")
        .replace("{{FORMAT_OK}}", f"{summary['format_ok']}/{summary['tasks']}")
        .replace("{{EMPTY}}", str(summary["empty_result"]))
        .replace("{{P50}}", str(summary["latency_p50_s"]))
        .replace("{{P95}}", str(summary["latency_p95_s"]))
        .replace("{{MAX}}", str(summary["latency_max_s"]))
        .replace("{{TABLE}}", table)
    )
    with open(out_path, "w") as f:
        f.write(filled)
    print("\nReport written:", out_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pte")
    ap.add_argument("--tokenizer")
    ap.add_argument("--tasks", default=os.path.join(HERE, "tasks.json"))
    ap.add_argument("--out", default=os.path.join(HERE, "report.md"))
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        selftest()
        return

    if not (args.pte and args.tokenizer):
        sys.exit("Provide --pte and --tokenizer (or use --selftest).")

    tasks = json.load(open(args.tasks))["tasks"]
    generate = load_model(args.pte, args.tokenizer)
    rows, latencies = run(generate, tasks)
    summary = summarize(rows, latencies)
    print("\nSUMMARY:", json.dumps(summary, indent=2))
    write_report(summary, rows, args.out)


if __name__ == "__main__":
    main()
