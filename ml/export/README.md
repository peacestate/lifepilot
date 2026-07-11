# ml/export — training + export of the on-device models

Everything the app runs on-device is produced here. Two different stories, one per
kind of model:

| Model | Where it comes from |
|---|---|
| `energy_predictor`, `hydration_predictor`, `expense_line_tagger`, `expense_category` | **Trained + exported by us on AMD Instinct MI300X (ROCm)** — see below |
| Overwhelm Manager (Llama 3.2 1B) | **Not trained by us.** Ships Software Mansion's official pre-quantized QAT-LoRA `.pte`, pulled from Hugging Face |

**Hard rule, both paths:** the exported `.pte` must be built against **ExecuTorch
v0.6.0**, the version bundled in the pinned `react-native-executorch`. `.pte` has no
forward compatibility — a mismatch doesn't degrade, it fails to load on device. See
`docs/overwhelm-model-contract.md` §6.

Exports do not run on the dev PC (they need ~12–16 GB RAM; it has 8 GB). They run on
the AMD notebook.

## Production build — AMD Instinct MI300X (ROCm)

The four trained models shipped in the app were trained and exported on a real MI300X
via AMD's ROCm cloud notebooks (notebooks.amd.com), using `amd_notebook_run.py`. The
resulting sizes + sha256 are recorded in `ml/models/AMD_PROVENANCE.txt` and in each
`mobile/src/models/<feature>/manifest.json`.

No user data is involved at any point: every training script generates its own
**synthetic** data inline (see each contract doc §6).

### Reproducing it

1. Open an AMD AI notebook (notebooks.amd.com), JupyterLab on the ROCm image, GPU
   attached. Get `ml/export/` onto it (clone the repo or upload the folder).
2. From `ml/export/`, run:
   ```bash
   python amd_notebook_run.py
   ```
   It orchestrates the three training scripts in-process order (energy → hydration →
   expense), re-implementing none of them, so the artifacts match the tested pipeline
   and differ only in the hardware that produced them.
3. It prints `torch.version.hip` / `torch.cuda.is_available()` **before and after** the
   `pip install executorch==0.6.0` step, and warns loudly if either is false. This
   matters: the ExecuTorch wheel can replace the notebook's preinstalled ROCm torch with
   a CPU-only build, which would silently move training to CPU and make the "trained on
   AMD GPU" claim untrue. If it warns, force-reinstall the ROCm torch wheel and re-run.
4. Download `/tmp/lifepilot_export/amd_out/lifepilot-amd-models.zip` — the four `.pte`
   plus a `provenance.txt` recording the ROCm/HIP version, ExecuTorch version, and
   per-file checksums.
5. Unzip into `ml/models/<feature>/` and `mobile/src/models/<feature>/`, then update
   each `manifest.json` with the `bytes` + `sha256` from `provenance.txt`. The app
   verifies these at load.

`Dockerfile` containerizes the same pipeline for ROCm if you'd rather not use the
hosted notebook.

## The scripts

| Script | Produces | Notes |
|---|---|---|
| `export_energy_predictor.py` | `energy_predictor.pte` + manifest w/ frozen feature scaler | 1D-CNN/TCN time-series regression, no tokenizer. `QUANTIZE=False` — the model is < 200 KB, quantization buys nothing (contract §1) |
| `export_hydration.py` | `hydration_predictor.pte` | regression on body metrics + activity + optional weather |
| `export_expense_extractor.py` | `expense_line_tagger.pte`, `expense_category.pte` | two models: field extraction + categorization |
| `export_llama32_overwhelm.py` | `overwhelm_model_bundle.zip` | **not used by the shipped app** — see below |

All of them write to `/tmp/lifepilot_export/` and zip their output; all default
`EXECUTORCH_REF` to `v0.6.0`.

## Overwhelm / Llama — what ships, and the export path we don't use

The app ships Software Mansion's pre-exported QLoRA INT4 `.pte` for Llama 3.2 1B
(from `software-mansion/react-native-executorch-llama-3.2`) plus its `tokenizer.json`
and `tokenizer_config.json`, in `mobile/src/models/overwhelm/`. It's already built
against ExecuTorch v0.6.0, so there is nothing to export.

`export_llama32_overwhelm.py` exists for the day we export a custom or fine-tuned
variant. It needs an `HF_TOKEN` in the environment (a Hugging Face token for an account
that has accepted the gated Llama 3.2 license) and pulls
`meta-llama/Llama-3.2-1B-Instruct-QLORA_INT4_EO8` or `...-SpinQuant_INT4_EO8`. First run
is ~20–40 min, dominated by install + download. Never paste a token inline — the script
reads it from the environment only.

## Evals

One eval script + report per model in `ml/test/` (`*_eval.py`), run against the produced
`.pte`. Full I/O contracts, feature schemas, scaler constants, and cold-start rules live
in `docs/*-model-contract.md`.
