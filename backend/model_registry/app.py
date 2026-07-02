"""
LifePilot — Model Registry service (the "release server").

This is how the owner RELEASES on-device models, the way Claude models are released:
publish a new `.pte` version here, bump the catalog, and installed apps pick it up on
their next opt-in check. It serves ONLY model artifacts + the catalog.

GOLDEN RULE (README): the backend handles **non-user-data concerns only**. This service
NEVER receives, stores, or logs any user data — it only SERVES public model files. No
auth on reads, no analytics, no user identifiers. The app's update channel is model-in
only (see docs/model-release-process.md).

Run (owner's machine or a small VM — NOT inference, just file serving):
    pip install fastapi uvicorn
    uvicorn backend.model_registry.app:app --host 0.0.0.0 --port 8000

Layout on disk:
    backend/model_registry/
      registry.json                      # the served catalog (edit/bump to release)
      models/<id>/<version>/<file.pte>   # the published artifacts
"""
from __future__ import annotations

import json
import os

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse

HERE = os.path.dirname(os.path.abspath(__file__))
REGISTRY = os.path.join(HERE, "registry.json")
MODELS_DIR = os.path.join(HERE, "models")

app = FastAPI(title="LifePilot Model Registry", version="1.0.0")


@app.get("/registry.json")
def get_registry() -> JSONResponse:
    """The model catalog the app fetches on an opt-in update check (no user data in)."""
    if not os.path.exists(REGISTRY):
        raise HTTPException(404, "registry.json not published yet")
    with open(REGISTRY, encoding="utf-8") as f:
        return JSONResponse(json.load(f))


@app.get("/models/{model_id}/{version}/{filename}")
def get_model_file(model_id: str, version: str, filename: str) -> FileResponse:
    """Serve a published model artifact (the .pte / tokenizer). Path-traversal safe."""
    for part in (model_id, version, filename):
        if os.path.sep in part or ".." in part:
            raise HTTPException(400, "invalid path")
    path = os.path.join(MODELS_DIR, model_id, version, filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "artifact not found")
    return FileResponse(path)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "model-registry", "stores_user_data": False}
