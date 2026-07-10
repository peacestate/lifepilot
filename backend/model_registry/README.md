# LifePilot Model Registry (release server)

The **non-user-data** service that hosts the model catalog + artifacts so you can **release
on-device models like Claude releases models**. Full workflow: `docs/model-release-process.md`.

## What it does
- `GET /registry.json` — the catalog the app fetches on an opt-in update check.
- `GET /models/<id>/<version>/<file>` — serves a published `.pte` / tokenizer.
- `GET /health` — `{ stores_user_data: false }`.

It **never** receives, stores, or logs user data — it only serves public model files
(golden rule: the backend is non-user-data only).

## Run
```bash
pip install fastapi uvicorn
uvicorn backend.model_registry.app:app --host 0.0.0.0 --port 8000
# point the app at it: ModelRegistry({ remoteRegistryUrl: 'https://<host>/registry.json' })
```
For production this can be **pure static hosting / a CDN** (no server logic needed) — the
FastAPI app is just the simplest local version. A CDN with access logs disabled is the most
private host.

## Release a model
1. Export on the AMD ROCm notebook (`ml/export/export_*.py`) → `.pte` + `manifest.json`.
2. Copy to `models/<id>/<version>/`.
3. Add a descriptor (bumped semver + `sha256` + `bytes`) to `registry.json`.
4. Apps pick it up on their next opt-in check. Keep old versions for rollback.

> Keep every descriptor's `executorchVersion` = the app's runtime pin (**v0.6.0**), or the
> client rejects it (no forward compat).
