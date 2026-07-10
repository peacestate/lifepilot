# ---------------------------------------------------------------------------
# LifePilot — Hydration Tracker (feature #3)
# GPU export: tiny MLP -> ExecuTorch .pte (XNNPACK, ExecuTorch v0.6.0)
# ---------------------------------------------------------------------------
# WHY A MODEL (owner directive): per docs/hydration-engine-contract.md §11, the
# hydration target is now produced by an on-device ExecuTorch model, consistent
# with the "every AI feature runs on-device via ExecuTorch" promise.
#
# WHAT IT IS: a tiny regression MLP. Input = the same physiology features the rules
# engine used; output = the FOUR named components [baseline, heat, activity, aqi]
# (in mL). The model LEARNS the physiology from synthetic data the engine generates,
# so the "why today" breakdown survives (sum of components ~ target). The device
# still enforces the hard safety clamp 1500-4000 mL on the sum, regardless of model.
#
# The deterministic engine (ml/test/hydration_eval.py / contract §1-§7) is now:
#   (1) the TRAINING-DATA GENERATOR, (2) the safety clamp, (3) the offline fallback.
#
# WHERE TO RUN: the AMD ROCm notebook (GPU or CPU - the model is tiny). Internet ON to clone+build
# executorch. DO NOT build on the 8 GB dev PC (machine-safety). No real user data.
# Each "# %%" is a notebook cell.
# ---------------------------------------------------------------------------

# %% [markdown]
# ## 0. Config — EXECUTORCH_REF must match react-native-executorch's bundled version.

# %%
import os
EXECUTORCH_REF = "v0.6.0"        # contract §11 — same pin as Overwhelm/Energy
QUANTIZE = False                 # <50 KB model; int8 buys nothing
SEED = 7; N = 120000; EPOCHS = 60
WORK = "/tmp/lifepilot_export"; ET_DIR = f"{WORK}/executorch"; OUT = f"{WORK}/hydration_out"
os.makedirs(OUT, exist_ok=True)

# Install ExecuTorch (and its pinned torch==2.7.0) BEFORE importing torch anywhere
# else in this process — pip installing it later would leave a stale, incompatible
# torch already loaded in memory from an earlier `import torch`.
import subprocess
subprocess.run(["pip", "install", f"executorch=={EXECUTORCH_REF.lstrip('v')}", "-q"], check=True)

# %% [markdown]
# ## 1. Frozen feature scaler (ships in manifest.json; mobile applies identically)

# %%
# input feature order (index = position in the [8] input vector)
FEATURES = ["body_mass_kg", "is_female", "age_years",
            "temperature_c", "humidity_pct", "aqi",
            "active_minutes", "workout_intensity"]
SCALER_MEAN = [72.0, 0.5, 38.0, 20.0, 55.0, 50.0, 30.0, 0.45]
SCALER_STD  = [15.0, 0.5, 15.0, 9.0, 20.0, 45.0, 30.0, 0.30]
N_FEAT = len(FEATURES)
OUT_DIM = 4                      # [baseline, heat, activity, aqi] in mL
CLAMP_MIN, CLAMP_MAX = 1500.0, 4000.0   # hard safety clamp (enforced on device too)

# %% [markdown]
# ## 2. The physiology engine == the deterministic rules engine (contract §1).
# This is the SAME formula the TS engine and hydration_eval.py implement; here it
# labels synthetic samples. Keep these coefficients in lockstep with the contract.

# %%
import numpy as np
rng = np.random.default_rng(SEED)

def engine_components(mass, female, age, T, humidity, aqi, active_min, intensity):
    age_factor = 0.90 if age > 65 else 1.0
    sex_factor = 0.95 if female else 1.0
    baseline = mass * 33.0 * age_factor * sex_factor
    if humidity > 60:   hum_f = 1.30
    elif humidity < 30: hum_f = 1.10
    else:               hum_f = 1.00
    heat = min(25.0 * max(0.0, T - 20.0) * hum_f, 1000.0)
    heat_act_f = 1.15 if T > 25 else 1.0
    activity = min(active_min * 12.0 * (0.6 + intensity) * heat_act_f, 1500.0)
    aqi_ml = 0.0 if aqi < 100 else (150.0 if aqi < 150 else 300.0)
    return np.array([baseline, heat, activity, aqi_ml], dtype=np.float32)

def build_dataset():
    X, Y = [], []
    for _ in range(N):
        mass = float(np.clip(rng.normal(72, 16), 35, 200))
        female = float(rng.integers(0, 2))
        age = float(np.clip(rng.normal(38, 16), 14, 90))
        T = float(np.clip(rng.normal(20, 10), -10, 45))
        humidity = float(np.clip(rng.normal(55, 22), 5, 100))
        aqi = float(np.clip(rng.gamma(2.0, 40.0), 0, 400))
        active = float(np.clip(rng.gamma(1.6, 22.0), 0, 240))
        intensity = float(np.clip(rng.normal(0.45, 0.28), 0, 1))
        x = [mass, female, age, T, humidity, aqi, active, intensity]
        y = engine_components(*x)
        # small label noise so the model generalizes smoothly (not a 1:1 memorize)
        y = y + rng.normal(0, 15, 4).astype(np.float32)
        X.append(x); Y.append(np.clip(y, 0, None))
    X = np.array(X, dtype=np.float32); Y = np.array(Y, dtype=np.float32)
    Xn = (X - np.array(SCALER_MEAN)) / np.array(SCALER_STD)
    return Xn.astype(np.float32), Y

X, Y = build_dataset()
print("dataset", X.shape, Y.shape, "| target mL range", Y.sum(1).min(), Y.sum(1).max())

# %% [markdown]
# ## 3. Tiny MLP (all Linear/ReLU -> fully XNNPACK). Softplus -> non-negative mL.

# %%
import torch, torch.nn as nn
class HydrationMLP(nn.Module):
    def __init__(self, n_in=N_FEAT, hidden=32, n_out=OUT_DIM):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_in, hidden), nn.ReLU(),
            nn.Linear(hidden, hidden), nn.ReLU(),
            nn.Linear(hidden, n_out), nn.Softplus())   # >=0 mL per component
    def forward(self, x):                 # x: [B, 8] normalized
        return self.net(x)                # [B, 4] = baseline, heat, activity, aqi (mL)

torch.manual_seed(SEED)
model = HydrationMLP()
print("params:", sum(p.numel() for p in model.parameters()))

# %% [markdown]
# ## 4. Train (MSE on mL components).

# %%
dev = "cuda" if torch.cuda.is_available() else "cpu"; model.to(dev)
Xt = torch.from_numpy(X).to(dev); Yt = torch.from_numpy(Y).to(dev)
idx = torch.randperm(X.shape[0]); cut = int(0.9 * X.shape[0]); tr, va = idx[:cut], idx[cut:]
opt = torch.optim.Adam(model.parameters(), 2e-3); lossf = nn.MSELoss(); bs = 1024
for ep in range(EPOCHS):
    model.train(); perm = tr[torch.randperm(tr.numel())]
    for i in range(0, perm.numel(), bs):
        b = perm[i:i+bs]; opt.zero_grad()
        loss = lossf(model(Xt[b]), Yt[b]); loss.backward(); opt.step()
    if ep % 10 == 0 or ep == EPOCHS-1:
        model.eval()
        with torch.no_grad():
            pred = model(Xt[va]); mae_total = (pred.sum(1) - Yt[va].sum(1)).abs().mean().item()
        print(f"epoch {ep:>2} train_mse {loss.item():9.1f} val_target_MAE {mae_total:6.1f} mL")
model.eval().to("cpu")

# %% [markdown]
# ## 5. Export to ExecuTorch .pte (XNNPACK, v0.6.0).
# ExecuTorch was already installed in step 0, before torch was first imported.

# %%
from torch.export import export, export_for_training
from executorch.exir import to_edge_transform_and_lower, EdgeCompileConfig
from executorch.backends.xnnpack.partition.xnnpack_partitioner import XnnpackPartitioner
example = (torch.zeros(1, N_FEAT, dtype=torch.float32),)
trained = export_for_training(model, example).module()
exported = export(trained, example)
edge = to_edge_transform_and_lower(exported,
        compile_config=EdgeCompileConfig(_check_ir_validity=False),
        partitioner=[XnnpackPartitioner()])
PTE = f"{OUT}/hydration_predictor.pte"
with open(PTE, "wb") as f: edge.to_executorch().write_to_file(f)
print("exported:", PTE, os.path.getsize(PTE), "bytes")

# %% [markdown]
# ## 6. Manifest (frozen scaler + clamp bounds = single source of truth).

# %%
import hashlib, json, time
def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for ch in iter(lambda: f.read(1 << 20), b""): h.update(ch)
    return h.hexdigest()
manifest = {
    "name": "hydration_predictor", "task": "regression (daily water-need components)",
    "executorch_version": EXECUTORCH_REF, "backend": "xnnpack",
    "quant": "fp32", "exported_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "input": {"shape": [1, N_FEAT], "dtype": "float32", "features": FEATURES},
    "output": {"shape": [1, OUT_DIM], "dtype": "float32",
               "components": ["baseline_ml", "heat_ml", "activity_ml", "aqi_ml"],
               "note": "device sums components -> target, then clamps to [clamp_min, clamp_max]"},
    "scaler": {"mean": SCALER_MEAN, "std": SCALER_STD},
    "clamp_min_ml": CLAMP_MIN, "clamp_max_ml": CLAMP_MAX,
    "synthetic_training": True,
    "trained_from": "deterministic physiology engine (contract §1) + label noise",
    "pte_filename": "hydration_predictor.pte",
    "bytes": os.path.getsize(PTE), "sha256": sha256(PTE),
}
with open(f"{OUT}/manifest.json", "w") as f: json.dump(manifest, f, indent=2)
print(json.dumps({k: manifest[k] for k in ["name","executorch_version","bytes","sha256"]}, indent=2))

# %%
import shutil
shutil.make_archive(f"{WORK}/hydration_model_bundle", "zip", OUT)
print("Download:", f"{WORK}/hydration_model_bundle.zip → ml/models/hydration/ + mobile/src/models/hydration/")
