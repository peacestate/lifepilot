# OCR Expense — Architecture (CTO)

Feature #4. Capture a receipt → read it **fully on-device** → extract merchant/date/total/
category → track expenses. **The image and everything derived from it never leave the device.**

Reuses LifePilot conventions: Expo SDK 53, New Architecture, feature folder
`mobile/src/features/expense/` (service + hook), ESLint network-ban, airplane-mode acceptance
test. Authority for extraction I/O: `docs/expense-model-contract.md`.

---

## 0. The OCR-path decision (made head-on)

**Use platform-native on-device OCR — NOT an ExecuTorch OCR model.**

- **iOS:** Apple **Vision** (`VNRecognizeTextRequest`, accurate mode) — on-device, no entitlement,
  no upload.
- **Android:** Google **ML Kit Text Recognition v2** (bundled, on-device).

Both keep the **hard rule (no upload)** while being far more accurate and robust than a custom
`.pte` OCR model, with zero model-bundling cost. This deviates from "via ExecuTorch" but **not**
from the privacy promise — which is what actually matters (precedent: Hydration used no model,
Energy used a non-LLM module). **ExecuTorch adds no value here**, so we don't use it; the
"intelligence" is the deterministic extraction parser (contract §2–§7), pure TS.

RN access: a thin native module / existing community lib wraps Vision + ML Kit and returns the
normalized `OcrResult` (contract §1). Evaluate `react-native-vision-camera` (capture) +
`vision-camera-ocr`-style frame processor, or a dedicated text-recognition module; if none fits
cleanly under Expo prebuild, a small custom native module is in scope (it's just OCR-in, text-out).

---

## 1. Capture pipeline (all local)
1. **Camera:** `expo-camera` (or `react-native-vision-camera` if we want a frame-processor OCR
   path). Also allow **pick-from-library** (`expo-image-picker`).
2. **Image stays local:** captured to the app sandbox (cache dir). Optional light pre-process
   (downscale/grayscale) on-device to speed OCR. **Never uploaded.**
3. **OCR:** run Vision/ML Kit on the local image → `OcrResult`.
4. **Retention:** keep the cropped image with the expense only if the user opts in; default is
   to keep the extracted fields and **discard the photo** after confirm (configurable). Provide
   a delete-expense (and delete-image) action. No image ever syncs.

## 2. Extraction pipeline
- `extractFields(ocr): ExpenseFields` — pure TS in `mobile/src/features/expense/`, a 1:1 port of
  `ml/test/expense_eval.py` (frozen config in one object). No native call, no network, fast.
- **Service + hook:**
  - `ExpenseService.ts` — `extractFields`, the frozen config, currency/date helpers (pure,
    unit-tested against the Python fixtures).
  - `useExpenseScanner.ts` — orchestrates: capture → OCR (native) → `extractFields` → returns
    `{ state: 'idle'|'reading'|'review'|'error', fields, retake, save }`. Keeps the screen dumb.
  - `expenseStore.ts` — local persistence (below).
- Threading/perf: OCR is the cost (native, off the JS thread); extraction is sub-ms. The
  "reading…" state covers OCR latency only.

## 3. Storage (local-only)
- Expense records persisted to an **encrypted on-device store** (e.g. `expo-secure-store` for
  keys + an encrypted SQLite / MMKV for records). Schema:
  ```ts
  type Expense = {
    id: string; createdAt: string;        // ISO
    merchant: string; dateISO: string|null;
    amount: number; currency: string;
    category: string; lineItems?: LineItem[];
    imageUri?: string;                     // local file:// only, optional
    confidenceFlags?: string[];            // which fields were low-confidence at capture
  };
  ```
- Totals (by day/category/month) computed on-device from these records. **No sync, no backend.**

## 4. The privacy guarantee in code
- **No network anywhere** in capture/OCR/extraction/storage. ESLint network-ban scoped to
  `mobile/src/features/expense/**` (and `screens/Expense*`) — and here there is **no allowlist**
  (unlike Hydration's one weather call): the whole feature is offline.
- **Airplane-mode acceptance test:** capture → OCR → extract → save end-to-end in airplane mode.
- **Network audit:** a capture+save session through a monitor shows **zero** outbound requests.
- Onboarding copy promises "the photo and everything read from it stays on your phone" — that
  promise is literally enforceable here because nothing in the path can reach the network.

## 5. Contract & open items
- **AIML deliverable → mobile:** input `OcrResult`, output `ExpenseFields` (contract §1/§8); the
  TS port must match `expense_eval.py` (CI gate). Categories + thresholds are the AIML config.
- **Native OCR caveats:** Vision and ML Kit differ in box granularity and confidence reporting;
  the normalization layer absorbs this. Confirm ML Kit exposes usable per-line confidence (else
  constant fallback — affects only the review threshold, never extracted values).
- **No version pin** — no `.pte` in this feature.
- **Risks:** receipt variety (thermal fade, multi-column, non-Latin scripts → v1 is Latin-script;
  flag non-Latin as "couldn't read, enter manually"); image retention policy must be explicit in
  UX; very long receipts (scroll/again).

## 6. GO-path
Mobile can start now: build `useExpenseScanner` + the review screen against a **mock OCR result**
(feed a fixture from `expense_fixtures.json`), wire `extractFields` (port + test vs Python), then
swap in the real native OCR module. Designer's review/list screens bind to `ExpenseFields`.
CTO privacy/correctness sign-off before demo.
