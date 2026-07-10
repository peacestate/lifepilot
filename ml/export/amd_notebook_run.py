#!/usr/bin/env python3
"""
LifePilot — AMD MI300X / ROCm one-shot export runner.

Run this ON the AMD AI Notebook (notebooks.amd.com/hackathon, JupyterLab, ROCm)
to TRAIN + EXPORT all four shipped on-device .pte models on real AMD GPU compute:

    energy_predictor.pte
    hydration_predictor.pte
    expense_line_tagger.pte
    expense_category.pte

It just orchestrates the three existing, tested training scripts in this folder
(kaggle_export_energy_predictor.py / _hydration.py / _expense_extractor.py) —
it does NOT re-implement any model, so the artifacts stay identical to the
Kaggle-tested pipeline, only now produced on AMD hardware.

USAGE (in a JupyterLab cell or terminal, from the ml/export/ folder):

    !python amd_notebook_run.py

Then download /kaggle/working/amd_out/lifepilot-amd-models.zip (the 4 .pte +
a provenance.txt recording that they were built on AMD ROCm).

Nothing here touches the network except the scripts' own `pip install
executorch==0.6.0` step. No user data is involved — the training data is
synthetic, generated inside each script.
"""
import hashlib
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = "/kaggle/working"           # the three scripts hardcode this path
OUT = os.path.join(WORK, "amd_out")

SCRIPTS = [
    ("energy",    "kaggle_export_energy_predictor.py", ["energy_out/energy_predictor.pte"]),
    ("hydration", "kaggle_export_hydration.py",        ["hydration_out/hydration_predictor.pte"]),
    ("expense",   "kaggle_export_expense_extractor.py",
     ["expense_out/expense_line_tagger.pte", "expense_out/expense_category.pte"]),
]


def banner(msg):
    print("\n" + "=" * 72 + f"\n{msg}\n" + "=" * 72, flush=True)


def check_gpu(stage):
    """Print, honestly, whether training will land on the AMD GPU or fall to CPU."""
    import torch  # imported fresh each call
    hip = getattr(torch.version, "hip", None)
    avail = torch.cuda.is_available()
    name = torch.cuda.get_device_name(0) if avail else "(none — CPU only)"
    print(f"[{stage}] torch={torch.__version__}  ROCm/HIP={hip}  "
          f"gpu_available={avail}  device={name}", flush=True)
    return avail, hip


def main():
    banner("LifePilot AMD export — environment check")
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)

    avail_before, hip_before = check_gpu("before")
    if not (avail_before and hip_before):
        print("\n!! WARNING: this does NOT look like a ROCm GPU environment.\n"
              "   Expected torch.version.hip set and torch.cuda.is_available() True.\n"
              "   The export will still WORK, but it will run on CPU, so the\n"
              "   'trained on AMD GPU' claim would be a stretch. Confirm you are on\n"
              "   the AMD ROCm notebook before trusting the AMD story.\n", flush=True)

    # Pre-install executorch ONCE and re-check that it didn't clobber ROCm torch.
    banner("Installing executorch==0.6.0 (once) and re-checking torch")
    subprocess.run([sys.executable, "-m", "pip", "install", "executorch==0.6.0", "-q"],
                   check=True)
    avail_after, hip_after = check_gpu("after executorch install")
    if avail_before and not avail_after:
        print("\n!! executorch's install REPLACED the ROCm torch with a non-GPU build.\n"
              "   Training would now fall back to CPU. To keep AMD GPU training,\n"
              "   reinstall this notebook's original ROCm torch wheel, THEN re-run\n"
              "   this script. (On the AMD image torch is preinstalled, so a\n"
              "   `pip install --force-reinstall torch==<the ROCm build>` restores it.)\n",
              flush=True)

    # Run each training+export script as its own process (clean, deterministic).
    results = []
    for label, script, outputs in SCRIPTS:
        banner(f"[{label}] training + exporting  ({script})")
        rc = subprocess.run([sys.executable, os.path.join(HERE, script)]).returncode
        if rc != 0:
            print(f"!! {label} FAILED (exit {rc}) — stopping.", flush=True)
            sys.exit(rc)
        for rel in outputs:
            src = os.path.join(WORK, rel)
            if not os.path.exists(src):
                print(f"!! expected output missing: {src}", flush=True)
                sys.exit(1)
            dst = os.path.join(OUT, os.path.basename(src))
            shutil.copy2(src, dst)
            results.append(dst)

    # Provenance + checksums (this is what you paste back so manifests can update).
    banner("Done — AMD-built .pte artifacts")
    gpu_ok = avail_after and hip_after
    lines = [
        "LifePilot on-device models — provenance",
        f"built_utc: {datetime.now(timezone.utc).isoformat()}",
        f"platform: AMD ROCm notebook (notebooks.amd.com)",
        f"trained_on_gpu: {gpu_ok}   (torch.cuda.is_available and torch.version.hip)",
        f"executorch: 0.6.0",
        "",
        "file  bytes  sha256",
    ]
    for p in results:
        b = os.path.getsize(p)
        h = hashlib.sha256(open(p, "rb").read()).hexdigest()
        line = f"{os.path.basename(p)}  {b}  {h}"
        print(line, flush=True)
        lines.append(line)
    prov = os.path.join(OUT, "provenance.txt")
    open(prov, "w").write("\n".join(lines) + "\n")

    zip_base = os.path.join(WORK, "lifepilot-amd-models")
    shutil.make_archive(zip_base, "zip", OUT)
    print(f"\nDownload this:  {zip_base}.zip", flush=True)
    print("Then send me provenance.txt (sizes + sha256) so I can update the "
          "manifests and, if trained_on_gpu is True, restore the strong AMD wording.",
          flush=True)


if __name__ == "__main__":
    main()
