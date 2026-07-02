# OCR Expense — On-Device Extraction Contract (authoritative)

Owner: AI/ML Engineer · Status: **v1 locked** · Last updated: 2026-06-26

The authoritative contract the **mobile dev** and **designer** build against for LifePilot
feature #4. The reference implementation is `ml/test/expense_eval.py`; the TypeScript port in
`mobile/src/features/expense/` must reproduce its outputs number-for-number (CI checks both).

Feature: snap a receipt → read it **on-device** → extract `{merchant, date, total, category}`
the user can review/correct → track expenses. **Nothing is ever uploaded.**

---

## 0. The honest calls (two layers)

**No `.pte`. No ExecuTorch model. No Kaggle export.** This feature is two on-device pieces,
neither of which is a custom trained model:

1. **OCR (image → text): platform-native, on-device.** Apple **Vision** (`VNRecognizeTextRequest`)
   on iOS, Google **ML Kit Text Recognition** on Android. Both run fully on-device, free, no
   upload — and are far more accurate and robust than any OCR model we could export to `.pte`.
   The hard rule is **no upload**; native OCR keeps it. Shipping a custom ExecuTorch OCR model
   would be more work for worse accuracy — rejected.
2. **Extraction (OCR text → fields): a deterministic parser.** Totals, dates, merchant, and
   category are well-handled by labelled-amount logic, date disambiguation, header heuristics,
   and a keyword classifier. A model here would cost transparency (we couldn't show *why* a
   field was picked) and buy nothing without a labelled receipt dataset we don't have and
   can't collect (golden rule). Deterministic is the right call — and it's instant and offline.

> Consistent with Hydration (pure rules engine): pick the right tool. ExecuTorch is not a
> requirement, the **on-device + no-upload privacy promise** is.

---

## 1. OCR path (image → text)

- **iOS:** Apple Vision text recognition (accurate mode), on-device.
- **Android:** ML Kit Text Recognition v2 (Latin script), on-device, bundled model.
- Output normalized to a common **`OcrResult`** shape (below) so the extractor is
  platform-agnostic. The image and all OCR output stay on device (CTO doc §1/§4).

### `OcrResult` (the extractor's input)
```ts
type OcrLine = {
  text: string;     // recognized text for one line
  y: number;        // top offset in image px (vertical order; smaller = higher on receipt)
  h: number;        // line height in px (bigger = larger type → likely header)
  conf: number;     // per-line recognition confidence, 0..1
};
type OcrResult = { lines: OcrLine[]; width?: number; height?: number };
```
Both Vision and ML Kit expose per-line text + bounding boxes + confidence; the native module
maps them to this shape. (ML Kit confidence may need a constant fallback — see §10.)

---

## 2. Extraction overview

`extractFields(ocr: OcrResult): ExpenseFields` runs four independent extractors over the lines,
each returning a value **and a 0–1 confidence**, then sets a `needsReview` flag. All logic is in
`expense_eval.py` (the reference) — this doc is the spec; the code is the source of truth for
exact regexes/coefficients. **Keep the frozen config in ONE place** (see §8) imported by both
the parser functions and any UI that needs the constants.

Frozen config: `REVIEW_THRESHOLD=0.60`, `DEFAULT_CURRENCY="USD"`, `DEFAULT_DATE_LOCALE="US"`,
category set = `["Food","Groceries","Transport","Health","Shopping","Utilities","Other"]`.

---

## 3. Total
- A "money amount" requires a **2-digit minor part** (`12.99`, `1,234.56`, EU `6,30`/`1.234,56`)
  so quantities, years, and phone numbers aren't mistaken for prices.
- **Label-driven:** lines matching `GRAND TOTAL / TOTAL DUE / AMOUNT DUE / BALANCE DUE / TOTAL`
  are positive candidates; **`SUBTOTAL` is explicitly NOT a total**, and `TAX/VAT/GST/TIP/
  CHANGE/CASH/CARD/VISA/…` lines are excluded.
- If labelled totals exist → pick the **largest labelled** amount (`structural=0.9`).
  Else → largest **non-excluded** amount as a fallback guess (`structural=0.5`).
- **Currency** from a symbol/code on the total line, else anywhere on the receipt, else
  `DEFAULT_CURRENCY` (flagged `currencyAssumed=true`, confidence nudged down).
- `confidence = structural × lineConf × (0.9 if currency assumed)`.

## 4. Date
- Parses numeric `D/M/Y`·`M/D/Y`, **ISO `YYYY-MM-DD`** (unambiguous), and month-name forms
  (`14 Mar 2026`, `Mar 14, 2026`) → normalized to **ISO `YYYY-MM-DD`**.
- Disambiguation: if one part `>12` it's forced (DD/MM vs MM/DD); if both `≤12` it's
  **ambiguous** → `DEFAULT_DATE_LOCALE` tiebreak (`US`→MM/DD) and `ambiguous=true`
  (lower confidence → likely review).
- Plausibility window `2000 ≤ year ≤ today+1`; invalid calendar dates rejected.
- Prefers an unambiguous date, then the topmost on the receipt.

## 5. Merchant
- Header heuristic over non-price, non-date lines (skips address/phone/`STORE #`/`CASHIER`/
  URL lines, and lines with too few letters). Scored by **topness (0.40) + relative font
  height (0.25) + line confidence (0.20) + alpha ratio (0.15)**; prefers the top ~35% of the
  receipt. Returns the highest-scoring line verbatim (user can edit).

## 6. Category (keyword classifier over the fixed set)
- Dictionaries per category (e.g. Groceries: market/grocer/whole foods…; Food: cafe/restaurant/
  pizza…; Transport: shell/fuel/uber/parking…; Health: pharmacy/cvs/rx/vitamin…; Shopping;
  Utilities). A keyword hit in the **merchant weighs 3**, in the body **1**.
- Highest-scoring category wins; **no hit → `Other`** (conf 0.40). Confidence scales with score,
  capped 0.90. The set is deliberately small (it's a wellness app, not accounting software).

## 7. Confidence & review
- Each field carries `confidence ∈ [0,1]`. `needsReview = true` if **any** of merchant/date/
  total/category is `null` or below `REVIEW_THRESHOLD (0.60)`; `reviewFields` lists which.
  The designer's review screen flags exactly these for a glance-check — everything is editable
  regardless (OCR is never perfect).

---

## 8. Output contract (mobile + designer consume this)
```ts
type Money = { amount: number; currency: string; currencyAssumed: boolean };
type Field<T> = { value: T | null; confidence: number; source?: string };

type LineItem = { description: string; amount: number };

type ExpenseFields = {
  merchant: Field<string>;
  date:     Field<string> & { ambiguous?: boolean };   // ISO YYYY-MM-DD
  total:    Field<Money>;
  category: Field<string>;                              // one of the fixed set
  lineItems: LineItem[];                                // best-effort, optional in UI
  needsReview: boolean;
  reviewFields: Array<'merchant'|'date'|'total'|'category'>;
};
```
The saved expense record (CTO owns storage) is derived from the user-confirmed `ExpenseFields`.

---

## 9. Validation
`ml/test/expense_eval.py` + `expense_fixtures.json` (grocery, restaurant+tip, gas/transport,
pharmacy, faded→review, INR) + `EXPENSE_REPORT_TEMPLATE.md`. **All 6 fixtures PASS** (verified):
correct total with tip/subtotal excluded, ISO dates incl. locale tiebreak, merchant headers,
categories, INR currency, and the faded receipt correctly flagged `needsReview`. The TS port
must reproduce these outputs — wire `expense_eval.py` into CI alongside the TS unit tests.

---

## 10. What the CTO must confirm
1. **OCR path** native on both platforms (Vision / ML Kit), normalized to `OcrResult`; confirm
   ML Kit per-line confidence availability (fall back to a constant if absent — affects review
   thresholds only, not values).
2. **No version pin needed** — there is no `.pte` for this feature (unlike Overwhelm/Energy).
3. Canonical extractor is **pure TS** in `mobile/src/features/expense/`, frozen config in one
   object imported by parser + UI; CI runs `expense_eval.py` to prevent TS drift.
4. Image + OCR text + extracted fields are **local-only**, never uploaded (privacy gate).

---

## 11. ExecuTorch extraction models — OWNER DIRECTIVE (supersedes §0's "no model" call)

Per the owner's hard rule — **privacy-absolute, every AI feature on-device via ExecuTorch** —
the extraction intelligence now runs through ExecuTorch models. **Raw OCR stays native** (Apple
Vision / ML Kit, on-device, no upload — §1 unchanged): a custom `.pte` OCR reader would be
heavier and *less* accurate, and the whole feature is already 100% offline. ExecuTorch is added
where it's the ML-hard part — **field/line classification and categorization**.

- **Two tiny models** (Linear/ReLU → XNNPACK), each **<200 KB**, `require()`-bundled:
  1. **Line tagger** — per OCR line → `{OTHER, MERCHANT, DATE, TOTAL, ITEM}`. Input =
     hashed char-trigram bag (FNV-1a, dim 256) of the line text **+** 6 layout features
     `[y_rel, h_rel, conf, has_amount, has_date, alpha_ratio]` → `[1, 262]`.
  2. **Category** — receipt text → one of the 7 categories (§6). Input = hashed bag `[1, 256]`.
- **Featurizer** (hashed char-ngram BoW, FNV-1a) is **deterministic and ported to TS exactly**;
  params live in `manifest.json` (single source of truth) — see the export script header.
- **Pin:** both `.pte` exported against **ExecuTorch v0.6.0** (matches
  `react-native-executorch@0.4.8`). This REPLACES §10's "no version pin." See
  [[lifepilot-executorch-version-pin]].
- **The deterministic parser (`expense_eval.py`, §2–§7) is retained** as: **(a)** the
  weak-labeller / training-data generator, **(b)** the **fallback** used when a model's softmax
  confidence is below `REVIEW_THRESHOLD`, **(c)** the value extractor (the line tagger *finds*
  the total/date lines; the §3/§4 logic still parses the amount/ISO-date from them, so currency
  and date disambiguation stay exact and explainable).
- **Output contract (§8) is unchanged** — `ExpenseFields` with per-field confidence (now the
  model softmax). Mobile/designer code is unaffected; the producer changed, not the shape.
- **Export/eval:** `ml/export/kaggle_export_expense_extractor.py` (Kaggle, v0.6.0). The model is
  validated against `expense_eval.py` fixtures (the parser it learned from).
- **Privacy unchanged and absolute:** native OCR + both ExecuTorch models run fully on-device;
  **zero network** anywhere in the feature (no allowlist). See
  [[privacy-absolute-executorch-everywhere]].
