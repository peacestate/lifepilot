# LifePilot — Model Release Process

How you **release on-device models like Claude releases models**: a versioned catalog you
publish to, that installed apps pick up on their own schedule — **without exposing any user
data, ever.** This is the cross-cutting layer all four AI features share.

## Mental model (≈ how Claude models ship)
- Each feature has a **model id** (e.g. `overwhelm-llama-3.2-1b-qlora`) — like a Claude model name.
- Each release is a **semver version** (`1.0.0` → `1.1.0`) — like a model version/snapshot.
- A **catalog** (`registry.json`) lists the available versions per feature + the runtime pin.
- The app resolves the **newest pin-compatible** version it's allowed to use, exactly like a
  client resolving a model id to a concrete deployment.

## The pieces
| Piece | Where | Role |
|---|---|---|
| Bundled catalog | `mobile/src/core/modelRegistry/registry.bundled.json` | Ships in the app → works offline forever |
| Registry client | `mobile/src/core/modelRegistry/ModelRegistry.ts` | resolve / check / download / verify / activate / rollback |
| Release server | `backend/model_registry/` (FastAPI) | serves the catalog + artifacts (**non-user-data only**) |
| Served catalog | `backend/model_registry/registry.json` | what you edit to publish |
| Exports | `ml/export/kaggle_export_*.py` | produce the `.pte` + manifest you publish |

## The five guarantees (enforced in code)
1. **Bundled-first** — the app always has a working model per feature; it never *needs* an update.
2. **Model-in-only** — the update channel only **GET**s public model files from your host. It
   sends **no user data, no identity, no health data, no telemetry**. Nothing about the user
   leaves the device. (`ModelRegistry.checkForUpdates`/`download` are the only network calls,
   and they're opt-in.)
3. **Opt-in** — updates run only when the app calls them (a "check for updates" tap, or a
   wifi-only setting). Default = bundled-only, zero network.
4. **Pin-gated** — a model whose `executorchVersion` ≠ the app's runtime pin is **rejected**
   (`.pte` has no forward compatibility). You can't accidentally ship a model the runtime
   can't load.
5. **Atomic + rollback** — a new version is staged → verified (size/sha256) → activated; the
   previous version is retained, so `rollbackToBundled(feature)` is instant.

## Releasing a new model — the workflow
*(Example: improving the Hydration model to `1.1.0`.)*

1. **Export** on Kaggle (off your 8 GB PC): run the feature's `ml/export/kaggle_export_*.py`,
   which produces `<model>.pte` + `manifest.json` (with `sha256`, `bytes`, `executorchVersion`).
   Keep `EXECUTORCH_REF` = the runtime's pin (currently **v0.6.0**) or the app will reject it.
2. **Publish the artifact** to the release server:
   `backend/model_registry/models/hydration-mlp/1.1.0/hydration_predictor.pte`
3. **Bump the catalog** — add a descriptor to `backend/model_registry/registry.json` under
   `hydration` with `version: "1.1.0"`, the new `sha256`/`bytes`, and `source.baseUrl`
   `/models/hydration-mlp/1.1.0/`. (Leave `1.0.0` in place for rollback.)
4. **Roll out gradually (optional):** set the new descriptor's `channel` to `"beta"` first; only
   apps in the beta channel pick it up. Promote to `"stable"` when happy.
5. **Done.** On the next opt-in `checkForUpdates`, apps see `1.1.0`, download it (model-in
   only), verify, and hot-swap. Old installs keep working; offline installs keep working.

> No app-store release needed for a model swap — only when you change native code or the
> ExecuTorch runtime pin (which is a coordinated event: re-export *all* models to the new pin).

## Bumping the runtime pin (the coordinated case)
Changing `react-native-executorch` (and thus the bundled ExecuTorch version) is the one case
that needs an app build. Then: re-export every model against the new `EXECUTORCH_REF`, publish
them as new versions, and bump `runtime.executorchVersion` in both `registry.bundled.json`
(app build) and the served `registry.json`. The pin gate makes a mismatch fail safe, never
silently load a bad model. See [[lifepilot-executorch-version-pin]].

## How a feature consumes it
A feature's model loader asks the registry for its active model and loads those files:
```ts
const active = await modelRegistry.getActive('hydration');   // downloaded version or bundled
// → load active.localFiles.model via the generic ExecuTorch module
```
Offline / no remote configured → it returns the bundled model. With a remote URL set and the
user opting in, `modelRegistry.updateFeature('hydration')` checks → downloads → activates the
newest pin-compatible version.

## Privacy posture (restated, because it's the point)
The release channel is the inverse of a tracking channel: **data only flows IN (models), never
OUT (users).** The request to your registry is a plain `GET` of a public file — it can be served
from a CDN with no logs. Combined with everything else on-device, a user is **not exposed by any
means**, even while you keep shipping smarter models. See
[[privacy-absolute-executorch-everywhere]].
