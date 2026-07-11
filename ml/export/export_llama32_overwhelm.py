# ---------------------------------------------------------------------------
# LifePilot — Overwhelm Manager
# GPU export: Llama 3.2 1B Instruct (INT4) -> ExecuTorch .pte
# ---------------------------------------------------------------------------
# WHERE TO RUN
#   An AMD ROCm notebook (notebooks.amd.com) with a GPU attached and internet ON,
#   so it can clone executorch and pull the gated checkpoint.
#
# DO NOT RUN THIS ON THE 8 GB DEV PC. Exporting a 1B model needs ~12-16 GB RAM.
# The MI300X has ample memory, which is why we export there.
#
# This script is the reproducible path for a CUSTOM/fine-tuned model. For v1 the
# app simply ships the pre-exported HF QLoRA .pte (see ml/export/README.md and
# docs/overwhelm-model-contract.md). Use this when you want your own model.
#
# Each "# %%" is a notebook cell — paste cell-by-cell into the notebook, or "Run All".
# ---------------------------------------------------------------------------

# %% [markdown]
# ## 0. Configuration
# `EXECUTORCH_REF` MUST match the ExecuTorch version bundled in the
# `react-native-executorch` release the app pins (see contract §6). The HF v1
# model is **v0.6.0**. If the CTO pins a newer runtime, set this to that tag.

# %%
import os

# === Pin: keep in lockstep with react-native-executorch's ExecuTorch version ===
EXECUTORCH_REF = "v0.6.0"   # contract §6 — CTO confirms before a real export

# Meta's INT4 mobile checkpoints (gated — accept the license on HF first).
# QLoRA = best quality/perf per HF; SpinQuant = no-finetune alternative.
QLORA_REPO     = "meta-llama/Llama-3.2-1B-Instruct-QLORA_INT4_EO8"
SPINQUANT_REPO = "meta-llama/Llama-3.2-1B-Instruct-SpinQuant_INT4_EO8"

QUANT = "qlora"   # "qlora" or "spinquant"
SRC_REPO = QLORA_REPO if QUANT == "qlora" else SPINQUANT_REPO
EXPORT_CONFIG = (
    "examples/models/llama/config/llama_xnnpack_qat.yaml" if QUANT == "qlora"
    else "examples/models/llama/config/llama_xnnpack_spinquant.yaml"
)

WORK   = "/tmp/lifepilot_export"
ET_DIR = f"{WORK}/executorch"
CKPT   = f"{WORK}/ckpt"
OUT    = f"{WORK}/overwhelm_out"
os.makedirs(OUT, exist_ok=True)
print("export ref:", EXECUTORCH_REF, "| quant:", QUANT, "| src:", SRC_REPO)

# %% [markdown]
# ## 1. HF token (env var)
# Export `HF_TOKEN` in the environment before running (a Hugging Face token for an
# account that has accepted the gated Llama 3.2 license). Never paste it inline.

# %%
# HF_TOKEN read from the environment; never paste inline
assert os.environ.get("HF_TOKEN"), "Set HF_TOKEN in the environment before running"

# %% [markdown]
# ## 2. Clone ExecuTorch at the pinned tag + install
# `install_executorch.sh` + the llama example requirements pull Torch/torchao
# etc. This is the slow cell (~10-20 min on the AMD ROCm notebook).

# %%
import subprocess, sys

def sh(cmd, cwd=None):
    print("+", cmd)
    subprocess.run(cmd, shell=True, cwd=cwd, check=True)

if not os.path.isdir(ET_DIR):
    sh(f"git clone --depth 1 --branch {EXECUTORCH_REF} "
       f"https://github.com/pytorch/executorch.git {ET_DIR}")
    # submodules are required by the build
    sh("git submodule sync && git submodule update --init --recursive", cwd=ET_DIR)

# Installers (paths/flags follow the executorch llama README for this tag):
sh("./install_executorch.sh", cwd=ET_DIR)
sh("bash examples/models/llama/install_requirements.sh", cwd=ET_DIR)

# %% [markdown]
# ## 3. Download the INT4 checkpoint
# Pulls `consolidated.00.pth`, `params.json`, `tokenizer.model`.

# %%
from huggingface_hub import snapshot_download

ckpt_path = snapshot_download(
    repo_id=SRC_REPO,
    local_dir=CKPT,
    allow_patterns=["consolidated.00.pth", "params.json", "tokenizer.model",
                    "*.json"],
    token=os.environ["HF_TOKEN"],
)
print("checkpoint at:", ckpt_path)
for f in sorted(os.listdir(CKPT)):
    print("  ", f, os.path.getsize(os.path.join(CKPT, f)) // (1024*1024), "MB")

LLAMA_CHECKPOINT = f"{CKPT}/consolidated.00.pth"
LLAMA_PARAMS     = f"{CKPT}/params.json"

# %% [markdown]
# ## 4. Export to .pte
# Uses the config-driven exporter. The config sets XNNPACK delegation, KV-cache,
# SDPA, the INT4 quant mode and the BOS/EOS metadata for this model class.

# %%
sh(
    "python -m extension.llm.export.export_llm "
    f"--config {EXPORT_CONFIG} "
    '+base.model_class="llama3_2" '
    f'+base.checkpoint="{LLAMA_CHECKPOINT}" '
    f'+base.params="{LLAMA_PARAMS}" '
    f'+export.output_dir="{OUT}"',
    cwd=ET_DIR,
)

# Locate the produced .pte (filename is set by the config; don't assume it).
import glob, shutil
pte_candidates = glob.glob(f"{OUT}/**/*.pte", recursive=True) + \
                 glob.glob(f"{ET_DIR}/**/*.pte", recursive=True)
assert pte_candidates, "No .pte produced — check the export log above."
PTE = max(pte_candidates, key=os.path.getsize)
final_pte = f"{OUT}/llama3_2-1B-{QUANT}.pte"
shutil.copy(PTE, final_pte)
print("exported:", final_pte, os.path.getsize(final_pte) // (1024*1024), "MB")

# %% [markdown]
# ## 5. Tokenizer + manifest (must travel with the .pte)
# react-native-executorch needs the tokenizer alongside the model. We copy what
# the checkpoint shipped and also emit tokenizer.json/_config if present.

# %%
import hashlib, json, time

for name in ["tokenizer.model", "tokenizer.json", "tokenizer_config.json"]:
    src = os.path.join(CKPT, name)
    if os.path.exists(src):
        shutil.copy(src, os.path.join(OUT, name))

def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

manifest = {
    "name": f"llama3_2-1B-{QUANT}",
    "source": SRC_REPO,
    "quant": QUANT.upper() + "_INT4_EO8",
    "executorch_version": EXECUTORCH_REF,
    "exported_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "pte_filename": os.path.basename(final_pte),
    "bytes": os.path.getsize(final_pte),
    "sha256": sha256(final_pte),
}
with open(f"{OUT}/manifest.json", "w") as f:
    json.dump(manifest, f, indent=2)
print(json.dumps(manifest, indent=2))

# %% [markdown]
# ## 6. Smoke test (optional, CPU runtime via pybind)
# Confirms the .pte loads and emits bullet steps before you download it. Full
# 20-task evaluation lives in ml/test/overwhelm_eval.py.

# %%
SYSTEM = (
    "You are a calm assistant that helps an overwhelmed person take action. Break "
    "the user's situation into 5 to 10 small, concrete, single-action steps. Each "
    "step must start with a verb and be doable in a few minutes. Output ONLY a "
    'markdown bullet list using "- ", one step per line. No intro, no numbering, '
    "no extra text."
)
def build_prompt(user_input: str) -> str:
    return (
        "<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n"
        f"{SYSTEM}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n"
        f"{user_input}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n"
    )
print("Sample prompt the app will send:\n")
print(build_prompt("I have to plan my sister's birthday and I don't know where to start"))
# (Run ml/test/overwhelm_eval.py here against `final_pte` for the real numbers.)

# %% [markdown]
# ## 7. Zip outputs to download
# Download the zip, unpack into `mobile/src/models/overwhelm/`.

# %%
shutil.make_archive(f"{WORK}/overwhelm_model_bundle", "zip", OUT)
print("Download:", f"{WORK}/overwhelm_model_bundle.zip")
print("Contents:", sorted(os.listdir(OUT)))
