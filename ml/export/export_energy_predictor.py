# ---------------------------------------------------------------------------
# LifePilot — Energy Predictor (feature #2)
# GPU export: tiny 1D-CNN/TCN -> ExecuTorch .pte (XNNPACK, ExecuTorch v0.6.0)
# ---------------------------------------------------------------------------
# WHAT THIS IS
#   A time-series REGRESSION model (NOT an LLM, no tokenizer). It takes a 7-day
#   window of sleep/activity/phone-usage features and predicts a 24-point hourly
#   energy curve (0..100). Full I/O contract: docs/energy-predictor-model-contract.md
#
# WHERE TO RUN
#   AMD ROCm notebook, Accelerator = GPU (or even CPU — the model is tiny). Internet
#   ON so it can clone executorch and build it. DO NOT build ExecuTorch on the
#   8 GB dev PC; keep the toolchain off the owner's machine (machine-safety rule).
#
#   The MODEL is trained on a documented SYNTHETIC dataset (contract §6) — there is
#   no real user data, and none is ever used (privacy is the product).
#
# Each "# %%" is a notebook cell — paste cell-by-cell, or "Run All".
# ---------------------------------------------------------------------------

# %% [markdown]
# ## 0. Configuration
# `EXECUTORCH_REF` MUST match the ExecuTorch version bundled in the
# `react-native-executorch` release the app pins (contract §10 == Overwhelm §6).

# %%
import os

# === Pin: keep in lockstep with react-native-executorch's ExecuTorch version ===
EXECUTORCH_REF = "v0.6.0"   # contract §10 — CTO confirms before a real export

QUANTIZE = False    # int8 PT2E via XNNPACK. Off by default: model is < 200 KB, 4-bit/int8
                    # buys nothing here (contract §1). Flip True only if a bigger base needs it.

SEED      = 1234
N_USERS   = 4000    # synthetic "people"
DAYS      = 30      # synthetic days per person
WINDOW    = 7       # days of history per sample (contract §3.1)
N_FEAT    = 12      # features per day (contract §3.3)
OUT_HOURS = 24      # hourly energy curve (contract §4)
EPOCHS    = 40

WORK   = "/tmp/lifepilot_export"
ET_DIR = f"{WORK}/executorch"
OUT    = f"{WORK}/energy_out"
os.makedirs(OUT, exist_ok=True)
print("export ref:", EXECUTORCH_REF, "| quantize:", QUANTIZE)

# Install ExecuTorch (and its pinned torch==2.7.0) BEFORE importing torch anywhere
# else in this process — pip installing it later would leave a stale, incompatible
# torch already loaded in memory from an earlier `import torch`.
import subprocess
subprocess.run(["pip", "install", f"executorch=={EXECUTORCH_REF.lstrip('v')}", "-q"], check=True)

# %% [markdown]
# ## 1. Feature scaler (FROZEN — must equal contract §3.3 and ship in manifest.json)
# Mobile applies the IDENTICAL z = (raw - mean) / std before inference. If these
# drift from training, predictions are garbage. Single source of truth = manifest.

# %%
# order matters: index = feature index in the [12, 7] tensor (contract §3.3)
FEATURES = [
    "sleep_duration_h", "sleep_quality", "sleep_midpoint_h", "wake_time_h",
    "steps_k", "active_minutes", "movement_intensity", "screen_time_h",
    "phone_pickups", "late_night_screen_min", "dow_sin", "dow_cos",
]
SCALER_MEAN = [7.0, 0.80, 4.0, 7.0, 7.0, 35.0, 0.30, 4.5, 60.0, 25.0, 0.0, 0.0]
SCALER_STD  = [1.3, 0.12, 1.5, 1.5, 4.0, 30.0, 0.18, 2.5, 35.0, 30.0, 0.71, 0.71]
assert len(FEATURES) == len(SCALER_MEAN) == len(SCALER_STD) == N_FEAT

# Activity/usage feature indices that are UNKNOWN for "today" at forecast time
# (set raw = mean -> z = 0). Contract §3.3.
TODAY_UNKNOWN_IDX = [4, 5, 6, 7, 8, 9]

# %% [markdown]
# ## 2. Synthetic dataset generator (contract §6 — documented physiological priors)
# Two-process model of sleep regulation (Borbely): circadian Process C + homeostatic
# Process S, modulated by sleep debt, activity, late-night screen use, day-of-week.
# This encodes OUR ASSUMPTIONS, not any individual's truth; per-user fit is the
# mobile-side calibration layer (contract §5). Assumptions are explicit below.

# %%
import numpy as np

SYNTH_ASSUMPTIONS = [
    "Circadian energy ~ sinusoid: rises after wake, late-morning peak, mid-afternoon dip,"
    " secondary early-evening lift, falls toward night.",
    "Short or poor sleep lowers AND flattens the curve (less peak, earlier fade).",
    "Moderate daytime activity lifts daytime energy; very late high intensity dents it.",
    "Late-night screen use lowers and phase-delays the next-day curve.",
    "Weekends phase-shift later (social jetlag) via day-of-week.",
    "Per-user random chronotype offset (larks vs owls) + Gaussian observation noise.",
]
rng = np.random.default_rng(SEED)

def _circadian(hours, peak_h, amp, mesor):
    # single smooth daily wave with an afternoon dip baked in
    main = np.sin(2 * np.pi * (hours - (peak_h - 6)) / 24.0)
    dip  = 0.35 * np.sin(2 * np.pi * (hours - 9) / 12.0)   # ~15:00 trough
    return mesor + amp * (0.8 * main - dip)

def gen_user(rng):
    chronotype = rng.normal(0, 1.2)          # +owl / -lark, shifts everything later/earlier
    base_amp   = rng.uniform(18, 30)
    base_mesor = rng.uniform(45, 60)
    rows, curves = [], []
    sleep_debt = 0.0
    for d in range(DAYS):
        dow = d % 7
        weekend = dow >= 5
        # --- sleep / timing ---
        dur = np.clip(rng.normal(7.2 - 0.4 * (not weekend), 1.1), 3.5, 10.5)
        qual = np.clip(rng.normal(0.82 - 0.1 * (dur < 6), 0.1), 0.3, 1.0)
        midpoint = np.clip(rng.normal(4.0 + chronotype + (1.0 if weekend else 0), 1.2), 1, 8)
        wake = np.clip(midpoint + dur / 2.0, 4, 12)
        sleep_debt = np.clip(0.6 * sleep_debt + (7.5 - dur), -2, 12)
        # --- activity ---
        steps_k = np.clip(rng.normal(7 + 2 * weekend, 3.5), 0, 25)
        active = np.clip(rng.normal(35 + 10 * weekend, 25), 0, 180)
        intensity = np.clip(rng.normal(0.30 + 0.01 * active / 10, 0.15), 0, 1)
        # --- phone usage ---
        screen = np.clip(rng.normal(4.5 + 1.5 * weekend, 2.0), 0.5, 14)
        pickups = np.clip(rng.normal(60 + 15 * weekend, 30), 5, 250)
        late = np.clip(rng.normal(25 + 30 * (midpoint > 5), 25), 0, 180)
        # --- target curve ---
        hours = np.arange(24)
        peak_h = 13 + 0.6 * chronotype + (1.0 if weekend else 0)
        amp = base_amp * (1 - 0.05 * sleep_debt) * (0.7 + 0.5 * qual)
        mesor = base_mesor - 1.8 * sleep_debt + 0.4 * (steps_k - 7) \
                + 6 * (active > 30) - 0.04 * late
        curve = _circadian(hours, peak_h, amp, mesor)
        curve[: int(np.floor(wake))] *= 0.45         # low before wake
        curve = curve + rng.normal(0, 2.5, 24)        # observation noise
        curve = np.clip(curve, 0, 100)
        rows.append([dur, qual, midpoint, wake, steps_k, active, intensity,
                     screen, pickups, late,
                     np.sin(2 * np.pi * dow / 7), np.cos(2 * np.pi * dow / 7)])
        curves.append(curve)
    return np.array(rows, dtype=np.float32), np.array(curves, dtype=np.float32)

def build_dataset():
    X, Y = [], []
    for _ in range(N_USERS):
        rows, curves = gen_user(rng)
        for t in range(WINDOW - 1, DAYS):
            win = rows[t - WINDOW + 1 : t + 1].copy()      # [7, 12]
            # mask today's not-yet-happened activity/usage -> raw = mean (z=0)
            for j in TODAY_UNKNOWN_IDX:
                win[-1, j] = SCALER_MEAN[j]
            X.append(win)
            Y.append(curves[t])                            # predict today's 24h curve
    X = np.stack(X)                                        # [N, 7, 12]
    Y = np.stack(Y)                                        # [N, 24]
    # normalize, then transpose to channel-major [N, 12, 7] for Conv1d (contract §3.2)
    X = (X - np.array(SCALER_MEAN)) / np.array(SCALER_STD)
    X = np.transpose(X, (0, 2, 1)).astype(np.float32)
    return X, Y.astype(np.float32)

X, Y = build_dataset()
print("dataset:", X.shape, Y.shape, "| target range", Y.min(), Y.max())

# %% [markdown]
# ## 3. Model — tiny 1D-CNN / TCN (contract §1, §2). All ops delegate to XNNPACK.

# %%
import torch, torch.nn as nn

class EnergyTCN(nn.Module):
    def __init__(self, n_feat=N_FEAT, days=WINDOW, hidden=32, out_hours=OUT_HOURS):
        super().__init__()
        self.conv1 = nn.Conv1d(n_feat, hidden, kernel_size=3, padding=1)
        self.conv2 = nn.Conv1d(hidden, hidden, kernel_size=3, padding=1)
        self.act = nn.ReLU()
        self.head = nn.Linear(hidden * days, out_hours)

    def forward(self, x):                 # x: [B, 12, 7]
        x = self.act(self.conv1(x))
        x = self.act(self.conv2(x))
        x = x.flatten(1)                  # [B, hidden*7]
        x = self.head(x)                  # [B, 24]
        return torch.sigmoid(x) * 100.0   # bound to [0,100] INSIDE the model (contract §2/§4.1)

torch.manual_seed(SEED)
model = EnergyTCN()
n_params = sum(p.numel() for p in model.parameters())
print("params:", n_params)

# %% [markdown]
# ## 4. Train (plain regression, MSE). Tiny + fast — CPU is fine.

# %%
dev = "cuda" if torch.cuda.is_available() else "cpu"
model.to(dev)
Xt = torch.from_numpy(X).to(dev); Yt = torch.from_numpy(Y).to(dev)
n = Xt.shape[0]; idx = torch.randperm(n)
cut = int(0.9 * n)
tr, va = idx[:cut], idx[cut:]
opt = torch.optim.Adam(model.parameters(), lr=2e-3)
lossf = nn.MSELoss()
bs = 512
for ep in range(EPOCHS):
    model.train(); perm = tr[torch.randperm(tr.numel())]
    for i in range(0, perm.numel(), bs):
        b = perm[i:i+bs]
        opt.zero_grad()
        out = model(Xt[b]); loss = lossf(out, Yt[b])
        loss.backward(); opt.step()
    if ep % 5 == 0 or ep == EPOCHS - 1:
        model.eval()
        with torch.no_grad():
            vmae = (model(Xt[va]) - Yt[va]).abs().mean().item()
        print(f"epoch {ep:>2}  train_mse {loss.item():7.3f}  val_MAE {vmae:5.2f} (0..100)")
model.eval().to("cpu")

# %% [markdown]
# ## 5. Export to ExecuTorch .pte (XNNPACK, ExecuTorch v0.6.0 API)
# ExecuTorch was already installed in step 0, before torch was first imported.

# %%
from torch.export import export, export_for_training
from executorch.exir import to_edge_transform_and_lower, EdgeCompileConfig
from executorch.backends.xnnpack.partition.xnnpack_partitioner import XnnpackPartitioner

example = (torch.zeros(1, N_FEAT, WINDOW, dtype=torch.float32),)

# Two-stage export (required for both the quantized and fp32 paths in v0.6.0).
trained = export_for_training(model, example).module()

if QUANTIZE:
    from torch.ao.quantization.quantize_pt2e import prepare_pt2e, convert_pt2e
    from executorch.backends.xnnpack.quantizer.xnnpack_quantizer import (
        XNNPACKQuantizer, get_symmetric_quantization_config)
    quantizer = XNNPACKQuantizer()
    quantizer.set_global(get_symmetric_quantization_config(is_per_channel=True))
    prepared = prepare_pt2e(trained, quantizer)
    # calibrate on a slice of the real (synthetic) training distribution
    with torch.no_grad():
        for i in range(0, min(2048, X.shape[0]), 256):
            prepared(torch.from_numpy(X[i:i+256]))
    trained = convert_pt2e(prepared)

exported = export(trained, example)
edge = to_edge_transform_and_lower(
    exported,
    compile_config=EdgeCompileConfig(_check_ir_validity=False),
    partitioner=[XnnpackPartitioner()],
)
exec_prog = edge.to_executorch()
PTE = f"{OUT}/energy_predictor.pte"
with open(PTE, "wb") as f:
    exec_prog.write_to_file(f)
print("exported:", PTE, os.path.getsize(PTE), "bytes")

# %% [markdown]
# ## 6. Manifest (carries the FROZEN scaler — contract §3.3 single source of truth)

# %%
import hashlib, json, time
def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

manifest = {
    "name": "energy_predictor",
    "task": "time-series regression (daily energy curve)",
    "executorch_version": EXECUTORCH_REF,
    "backend": "xnnpack",
    "quant": "int8_pt2e" if QUANTIZE else "fp32",
    "exported_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "input": {"shape": [1, N_FEAT, WINDOW], "dtype": "float32",
              "layout": "[batch, feature, day] (oldest day first, row[-1]=today)"},
    "output": {"shape": [1, OUT_HOURS], "dtype": "float32",
               "range": [0, 100], "index": "local clock hour 0..23"},
    "features": FEATURES,
    "scaler": {"mean": SCALER_MEAN, "std": SCALER_STD},
    "today_unknown_feature_idx": TODAY_UNKNOWN_IDX,
    "window_days": WINDOW,
    "min_days_for_prediction": 3,
    "synthetic_training": True,
    "synth_assumptions": SYNTH_ASSUMPTIONS,
    "pte_filename": "energy_predictor.pte",
    "bytes": os.path.getsize(PTE),
    "sha256": sha256(PTE),
    "params": int(n_params),
}
with open(f"{OUT}/manifest.json", "w") as f:
    json.dump(manifest, f, indent=2)
print(json.dumps({k: manifest[k] for k in
      ["name","executorch_version","backend","quant","bytes","sha256"]}, indent=2))

# %% [markdown]
# ## 7. Zip outputs to download -> ml/models/energy/ and mobile/src/models/energy/
# Then run ml/test/energy_eval.py against energy_predictor.pte for the report.

# %%
import shutil
shutil.make_archive(f"{WORK}/energy_model_bundle", "zip", OUT)
print("Download:", f"{WORK}/energy_model_bundle.zip")
print("Contents:", sorted(os.listdir(OUT)))
