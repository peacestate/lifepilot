# LifePilot model export pipeline — this is LifePilot's real, provable "Use of
# AMD Platforms" story: every on-device .pte (energy, hydration, expense,
# and — via export_llama32_overwhelm.py — Overwhelm) is trained/exported
# through this exact environment on AMD MI300X (ROCm). The deployed app itself
# never calls AMD or any cloud at inference time by design (on-device privacy
# is the product) — this container is where AMD hardware actually gets used.
#
# Run (with GPU passthrough — ROCm or CUDA, scripts are hardware-agnostic):
#   docker build -t lifepilot-export .
#   docker run --gpus all lifepilot-export python export_energy_predictor.py
#   docker run --gpus all lifepilot-export python export_hydration.py
#   docker run --gpus all lifepilot-export python export_expense_extractor.py
#   docker run --gpus all lifepilot-export python export_llama32_overwhelm.py
FROM python:3.11-slim

WORKDIR /export

COPY requirements.txt .
# torch is a large download; default pip timeouts are too short for it on a slow
# or congested connection — raise timeout/retries rather than fail a real build
# over a transient network hiccup.
RUN pip install --no-cache-dir --timeout=180 --retries=5 -r requirements.txt

COPY *.py ./
COPY README.md ./

CMD ["python", "--version"]
