# ml/export — Overwhelm Manager model export

Two ways to get the on-device `.pte`. **For v1, use Option A.**

## Option A — Ship the pre-exported HF model (v1, recommended)
No export needed. The mobile dev integrates this directly.

1. From `software-mansion/react-native-executorch-llama-3.2` download the **QLoRA INT4**
   `.pte` for Llama 3.2 1B + `tokenizer.json` + `tokenizer_config.json`.
2. Put them in `mobile/src/models/overwhelm/` and write `manifest.json`
   (`name, source, sha256, executorch_version: "v0.6.0", bytes, pte_filename`).
3. Done — already matched to the runtime (ExecuTorch **v0.6.0**, no forward compat).

> This is the fastest, lowest-risk path and what unblocks the build today.

## Option B — Export our own on Kaggle (custom/fine-tuned model, later)
Run `kaggle_export_llama32_overwhelm.py` on **Kaggle**, not the dev PC (export needs
~12–16 GB RAM; the PC has 8 GB).

1. New Kaggle Notebook on the account with GPU quota left (the image-gen one).
   **Accelerator = GPU**, **Internet = ON**.
2. Add a Secret `HF_TOKEN` (Add-ons → Secrets) for an HF account that accepted the
   Llama 3.2 license.
3. Paste the cells (or upload the `.py` and "Run All"). First run ~20–40 min (install +
   download dominate).
4. **Before running:** set `EXECUTORCH_REF` to the ExecuTorch version that matches the
   `react-native-executorch` version the CTO pinned (default `v0.6.0`). Mismatch = model
   won't load on device.
5. Download `overwhelm_model_bundle.zip`, unzip into `mobile/src/models/overwhelm/`.
6. Run `ml/test/overwhelm_eval.py` (on Kaggle, against the produced `.pte`) to generate the
   20-task report.

Checkpoints used (gated): `meta-llama/Llama-3.2-1B-Instruct-QLORA_INT4_EO8` or
`...-SpinQuant_INT4_EO8`.

See `docs/overwhelm-model-contract.md` for the full I/O contract and the version-pin rule.

---

## Option C — Energy Predictor (feature #2)
A different kind of model: a **time-series regression** (NOT an LLM, no tokenizer).
Run `kaggle_export_energy_predictor.py` on **Kaggle**. The model is tiny, but we keep the
ExecuTorch build off the 8 GB dev PC for consistency and machine-safety.

1. New Kaggle Notebook. Accelerator GPU (CPU works too), **Internet = ON** (clones
   executorch). **No HF token needed** — training data is a documented **synthetic**
   generator inside the script (contract §6), so **no real user data is ever used**.
2. `EXECUTORCH_REF` defaults to `v0.6.0`; set it to whatever ExecuTorch version the CTO's
   pinned `react-native-executorch` bundles. `QUANTIZE=False` by default (model is < 200 KB;
   int8/4-bit buys nothing here — contract §1).
3. "Run All". It trains the 1D-CNN/TCN on synthetic data, then exports via the v0.6.0
   XNNPACK pipeline (`export_for_training` → `to_edge_transform_and_lower` →
   `to_executorch` → `write_to_file`).
4. Download `energy_model_bundle.zip` (contains `energy_predictor.pte` + `manifest.json`
   with the **frozen feature scaler**) → unzip into `ml/models/energy/` and
   `mobile/src/models/energy/`.
5. Run `ml/test/energy_eval.py --pte energy_predictor.pte` (on Kaggle, against the produced
   `.pte`) to generate the report (shape / range / plausibility / latency).

Full I/O contract, feature schema, scaler constants, personalization and cold-start rules:
`docs/energy-predictor-model-contract.md`.
