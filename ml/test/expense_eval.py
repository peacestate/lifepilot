#!/usr/bin/env python3
"""
OCR Expense — evaluation harness AND reference implementation.

There is NO model and NO .pte for this feature (see docs/expense-model-contract.md §0).
- OCR (image -> text) is done by PLATFORM-NATIVE on-device OCR (Apple Vision / Google
  ML Kit). No upload, no ExecuTorch OCR model. See contract §1.
- Field extraction (OCR text -> {merchant, date, total, category}) is a deterministic
  parser. This file IS the canonical reference implementation of that parser (contract
  §2-§5). The TypeScript port in mobile/src/features/expense/ must reproduce these
  outputs exactly.

It validates, per the contract:
  - total = the GRAND-TOTAL amount (label-driven; SUBTOTAL/TAX/TIP/CARD excluded;
    largest-amount fallback when unlabelled), with currency                  (§3)
  - date parsed + disambiguated to ISO YYYY-MM-DD, ambiguous dates flagged    (§4)
  - merchant from header heuristics                                           (§5)
  - category from the keyword classifier over the fixed category set          (§6)
  - per-field confidence in [0,1] and needsReview set when any field is weak  (§7)

Stdlib only -- no executorch, no numpy. Run:
    python expense_eval.py
    python expense_eval.py --out report.md
"""
import argparse, json, os, re, time

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------
# FROZEN CONFIG -- MUST equal docs/expense-model-contract.md and the single
# frozen config object in mobile/src/features/expense/. Do not fork a copy.
# ---------------------------------------------------------------------------
REVIEW_THRESHOLD = 0.60          # any field confidence below this -> needsReview (§7)
DEFAULT_CURRENCY = "USD"         # used when no currency symbol/code is on the receipt
DEFAULT_DATE_LOCALE = "US"       # ambiguous d/m vs m/d tiebreak: "US" -> MM/DD else DD/MM
REFERENCE_TODAY = (2026, 6, 26)  # plausibility window upper bound (year+1)
CATEGORIES = ["Food", "Groceries", "Transport", "Health", "Shopping", "Utilities", "Other"]

# currency symbol / code  -> ISO 4217
CURRENCY_MAP = {
    "$": "USD", "US$": "USD", "USD": "USD",
    "€": "EUR", "EUR": "EUR",
    "£": "GBP", "GBP": "GBP",
    "₹": "INR", "RS": "INR", "RS.": "INR", "INR": "INR",
}
CURRENCY_RE = re.compile(r"(US\$|RS\.?|USD|EUR|GBP|INR|[$€£₹])", re.IGNORECASE)

# A money amount: requires a 2-digit minor part so quantities / phone numbers / years
# are not mistaken for prices. Handles US "1,234.56" / "12.99" and EU "1.234,56" / "6,30".
MONEY_RE = re.compile(
    r"(?P<num>\d{1,3}(?:[.,]\d{3})*[.,]\d{2}(?!\d)|\d+[.,]\d{2}(?!\d))")

# Total / non-total labels (uppercased line). SUBTOTAL is explicitly NOT a total.
POS_TOTAL_RE = re.compile(r"\b(GRAND\s*TOTAL|TOTAL\s+DUE|AMOUNT\s+DUE|BALANCE\s+DUE|TOTAL)\b")
SUBTOTAL_RE  = re.compile(r"\bSUB\s*-?\s*TOTAL\b")
NEG_LABEL_RE = re.compile(
    r"\b(SUBTOTAL|TAX|VAT|GST|HST|CHANGE|CASH|TENDER|TENDERED|TIP|GRATUITY|CARD|VISA|"
    r"MASTERCARD|MASTER|AMEX|DEBIT|CREDIT|AUTH|APPROVAL|ACCOUNT|POINTS|SAVINGS|DISCOUNT|"
    r"ROUNDING|DEPOSIT)\b")

MONTHS = {m: i + 1 for i, m in enumerate(
    ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"])}
DATE_NUM_RE  = re.compile(r"\b(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})\b")
DATE_DMON_RE = re.compile(r"\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b")  # 14 Mar 2026
DATE_MOND_RE = re.compile(r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b")  # Mar 14, 2026

# merchant skip: address/contact/structural lines are never the merchant name (§5)
MERCH_SKIP_RE = re.compile(
    r"\b(RECEIPT|INVOICE|TEL|PHONE|FAX|WWW|HTTP|CASHIER|SERVER|ORDER\s*#|STORE\s*#|"
    r"REG(?:ISTER)?\s*#?|TABLE|PUMP|STATION|TERMINAL|TRANS(?:ACTION)?\s*#|"
    r"ST|STREET|AVE|AVENUE|RD|ROAD|BLVD|SUITE|STE|FLOOR|LANE|LN|DR|DRIVE)\b|\.COM")

# category keyword dictionaries (§6). First hit weight: merchant matches weigh 3, body 1.
CATEGORY_KEYWORDS = {
    "Groceries": ["market", "mart", "grocery", "grocer", "supermarket", "whole foods",
                  "foods", "safeway", "kroger", "aldi", "costco", "walmart", "trader joe",
                  "sprouts", "publix", "produce", "deli"],
    "Food": ["restaurant", "cafe", "café", "coffee", "espresso", "latte", "bistro",
             "grill", "pizza", "pizzeria", "burger", "kitchen", "diner", "bakery",
             "croissant", "sandwich", "sushi", "taco", "pub", "starbucks", "mcdonald",
             "salad", "gratuity"],
    "Transport": ["shell", "chevron", "exxon", "mobil", "texaco", "petro", "bp ",
                  "fuel", "unleaded", "diesel", "gallon", "gal", "pump", "uber", "lyft",
                  "taxi", "cab", "transit", "metro", "parking", "toll", "airline",
                  "flight", "fare", "station"],
    "Health": ["pharmacy", "drugstore", "drug", "cvs", "walgreens", "rite aid", "clinic",
               "medical", "dental", "hospital", "rx", "prescription", "vitamin",
               "ibuprofen", "wellness"],
    "Shopping": ["clothing", "apparel", "electronics", "best buy", "target", "boutique",
                 "outfitters", "retail", "department"],
    "Utilities": ["electric", "utility", "internet", "broadband", "telecom", "energy",
                  "power", "water bill", "gas bill"],
}


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def alpha_ratio(s):
    nonspace = [c for c in s if not c.isspace()]
    if not nonspace:
        return 0.0
    return sum(1 for c in nonspace if c.isalpha()) / len(nonspace)


def parse_amount(num_str):
    """'1,234.56'->1234.56  '6,30'->6.30  '1.234,56'->1234.56  '12.99'->12.99"""
    s = num_str.strip()
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):          # comma is the decimal sep (EU)
            s = s.replace(".", "").replace(",", ".")
        else:                                    # dot is the decimal sep (US/UK)
            s = s.replace(",", "")
    elif "," in s:
        if re.search(r",\d{2}$", s):             # trailing ,dd -> decimal comma
            s = s.replace(".", "").replace(",", ".")
        else:                                    # thousands grouping only
            s = s.replace(",", "")
    return float(s)


def detect_currency(line_text):
    m = CURRENCY_RE.search(line_text)
    if not m:
        return None
    return CURRENCY_MAP.get(m.group(1).upper(), CURRENCY_MAP.get(m.group(1)))


def amounts_in(line_text):
    return [parse_amount(m.group("num")) for m in MONEY_RE.finditer(line_text)]


# ===========================================================================
# §3 -- total
# ===========================================================================
def extract_total(lines, receipt_text):
    cands = []
    for i, ln in enumerate(lines):
        U = ln["text"].upper()
        amts = amounts_in(ln["text"])
        if not amts:
            continue
        positive = bool(POS_TOTAL_RE.search(U)) and not SUBTOTAL_RE.search(U)
        excluded = bool(NEG_LABEL_RE.search(U)) and not positive
        for a in amts:
            cands.append({"amount": a, "y": ln["y"], "conf": ln["conf"],
                          "positive": positive, "excluded": excluded,
                          "currency": detect_currency(ln["text"]), "src": ln["text"]})
    if not cands:
        return {"value": None, "confidence": 0.0, "source": "no amount found"}

    labelled = [c for c in cands if c["positive"]]
    if labelled:
        pick = max(labelled, key=lambda c: (c["amount"], c["y"]))
        structural = 0.9
    else:
        pool = [c for c in cands if not c["excluded"]] or cands
        pick = max(pool, key=lambda c: c["amount"])
        structural = 0.5                          # unlabelled largest-amount guess

    currency = pick["currency"] or detect_currency(receipt_text) or DEFAULT_CURRENCY
    assumed = pick["currency"] is None and detect_currency(receipt_text) is None
    conf = round(structural * pick["conf"] * (0.9 if assumed else 1.0), 2)
    return {"value": {"amount": round(pick["amount"], 2), "currency": currency,
                      "currencyAssumed": assumed},
            "confidence": conf,
            "source": pick["src"]}


# ===========================================================================
# §4 -- date
# ===========================================================================
def _valid_ymd(y, m, d):
    if not (1 <= m <= 12 and 1 <= d <= 31):
        return False
    dim = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    if d > dim:
        return False
    return 2000 <= y <= REFERENCE_TODAY[0] + 1


def _disambiguate_numeric(a, b, c):
    """Returns (iso, ambiguous) or None. a,b are first two groups; c is the year group."""
    year = c if c >= 1000 else 2000 + c
    if a > 12 and b <= 12:                        # DD/MM
        day, mon, amb = a, b, False
    elif b > 12 and a <= 12:                      # MM/DD
        mon, day, amb = a, b, False
    elif a <= 12 and b <= 12:                     # ambiguous -> locale tiebreak
        if DEFAULT_DATE_LOCALE == "US":
            mon, day = a, b
        else:
            day, mon = a, b
        amb = True
    else:
        return None
    if not _valid_ymd(year, mon, day):
        return None
    return ("%04d-%02d-%02d" % (year, mon, day), amb)


def extract_date(lines):
    cands = []
    for ln in lines:
        t = ln["text"]
        for m in DATE_NUM_RE.finditer(t):
            g = [int(x) for x in m.groups()]
            if len(m.group(1)) == 4:              # ISO YYYY-MM-DD (unambiguous)
                if _valid_ymd(g[0], g[1], g[2]):
                    cands.append(("%04d-%02d-%02d" % (g[0], g[1], g[2]), False, ln))
            else:
                res = _disambiguate_numeric(g[0], g[1], g[2])
                if res:
                    cands.append((res[0], res[1], ln))
        for m in DATE_DMON_RE.finditer(t):        # 14 Mar 2026
            mon = MONTHS.get(m.group(2)[:3].upper())
            if mon and _valid_ymd(int(m.group(3)), mon, int(m.group(1))):
                cands.append(("%04d-%02d-%02d" % (int(m.group(3)), mon, int(m.group(1))),
                              False, ln))
        for m in DATE_MOND_RE.finditer(t):        # Mar 14, 2026
            mon = MONTHS.get(m.group(1)[:3].upper())
            if mon and _valid_ymd(int(m.group(3)), mon, int(m.group(2))):
                cands.append(("%04d-%02d-%02d" % (int(m.group(3)), mon, int(m.group(2))),
                              False, ln))
    if not cands:
        return {"value": None, "confidence": 0.0, "source": "no date found",
                "ambiguous": False}
    # prefer unambiguous, then topmost on the receipt
    cands.sort(key=lambda c: (1 if c[1] else 0, c[2]["y"]))
    iso, amb, ln = cands[0]
    structural = 0.6 if amb else 0.9
    return {"value": iso, "confidence": round(structural * ln["conf"], 2),
            "source": ln["text"], "ambiguous": amb}


# ===========================================================================
# §5 -- merchant
# ===========================================================================
def extract_merchant(lines, height):
    max_h = max((ln.get("h", 1) for ln in lines), default=1) or 1
    scored = []
    for ln in lines:
        U = ln["text"].upper()
        if amounts_in(ln["text"]):                # price/line-item lines are not the name
            continue
        if DATE_NUM_RE.search(ln["text"]) or DATE_DMON_RE.search(ln["text"]) \
                or DATE_MOND_RE.search(ln["text"]):
            continue
        if MERCH_SKIP_RE.search(U):
            continue
        ar = alpha_ratio(ln["text"])
        if ar < 0.3:
            continue
        rel_y = ln["y"] / height if height else 0.0
        topness = 1.0 - clamp(rel_y, 0.0, 1.0)
        score = (0.40 * topness + 0.25 * (ln.get("h", 1) / max_h)
                 + 0.20 * ln["conf"] + 0.15 * ar)
        scored.append((score, rel_y, ln))
    top_region = [s for s in scored if s[1] <= 0.35]
    pool = top_region or scored
    if not pool:
        return {"value": None, "confidence": 0.0, "source": "no header line"}
    score, _, ln = max(pool, key=lambda s: s[0])
    conf = round(clamp(score, 0.0, 1.0) * (0.6 + 0.4 * ln["conf"]), 2)
    return {"value": ln["text"].strip(), "confidence": conf, "source": ln["text"]}


# ===========================================================================
# §6 -- category (keyword classifier over the fixed set)
# ===========================================================================
def extract_category(merchant_text, body_texts):
    merchant_l = (merchant_text or "").lower()
    body_l = " ".join(body_texts).lower()
    scores = {c: 0 for c in CATEGORIES if c != "Other"}
    for cat, kws in CATEGORY_KEYWORDS.items():
        for kw in kws:
            if kw in merchant_l:
                scores[cat] += 3
            if kw in body_l:
                scores[cat] += 1
    top_cat = max(scores, key=lambda c: scores[c])
    top = scores[top_cat]
    if top == 0:
        return {"value": "Other", "confidence": 0.40, "source": "no keyword match"}
    conf = round(clamp(0.55 + 0.08 * top, 0.55, 0.90), 2)
    return {"value": top_cat, "confidence": conf, "source": f"{top_cat} score={top}"}


# ===========================================================================
# top-level: OcrResult -> ExpenseFields
# ===========================================================================
def extract_fields(ocr):
    lines = ocr["lines"]
    height = ocr.get("height") or max((ln["y"] + ln.get("h", 0) for ln in lines), default=1)
    receipt_text = "\n".join(ln["text"] for ln in lines)

    total = extract_total(lines, receipt_text)
    date = extract_date(lines)
    merchant = extract_merchant(lines, height)

    # body (line-item) texts: lines that carry a money amount and are not a label line
    items, body_texts = [], []
    for ln in lines:
        amts = amounts_in(ln["text"])
        U = ln["text"].upper()
        if amts and not POS_TOTAL_RE.search(U) and not NEG_LABEL_RE.search(U):
            desc = MONEY_RE.sub("", ln["text"]).strip(" .-\t")
            if alpha_ratio(ln["text"]) > 0.2:
                items.append({"description": desc, "amount": round(amts[-1], 2)})
        body_texts.append(ln["text"])

    category = extract_category(merchant["value"], body_texts)

    fields = {"merchant": merchant, "date": date, "total": total,
              "category": category, "lineItems": items}
    review = [k for k in ("merchant", "date", "total", "category")
              if fields[k]["value"] is None or fields[k]["confidence"] < REVIEW_THRESHOLD]
    fields["needsReview"] = bool(review)
    fields["reviewFields"] = review
    return fields


# ===========================================================================
# Validation
# ===========================================================================
def check_fixture(fx):
    r = extract_fields(fx["ocr"])
    exp = fx["expect"]
    errs = []

    # total amount + currency
    tv = r["total"]["value"]
    if exp.get("total_amount") is None:
        if tv is not None:
            errs.append(f"total {tv} expected None")
    else:
        if tv is None:
            errs.append("total None, expected %.2f" % exp["total_amount"])
        else:
            if abs(tv["amount"] - exp["total_amount"]) > 0.005:
                errs.append(f"total {tv['amount']} != {exp['total_amount']}")
            if "currency" in exp and tv["currency"] != exp["currency"]:
                errs.append(f"currency {tv['currency']} != {exp['currency']}")

    # date iso
    if r["date"]["value"] != exp.get("date_iso"):
        errs.append(f"date {r['date']['value']} != {exp.get('date_iso')}")

    # merchant substring
    mc = exp.get("merchant_contains")
    if mc:
        if not r["merchant"]["value"] or mc.lower() not in r["merchant"]["value"].lower():
            errs.append(f"merchant {r['merchant']['value']!r} missing {mc!r}")

    # category
    if r["category"]["value"] != exp.get("category"):
        errs.append(f"category {r['category']['value']} != {exp.get('category')}")

    # needsReview
    if "needs_review" in exp and r["needsReview"] != exp["needs_review"]:
        errs.append(f"needsReview {r['needsReview']} != {exp['needs_review']}")

    # confidences sane
    for k in ("merchant", "date", "total", "category"):
        c = r[k]["confidence"]
        if not (0.0 <= c <= 1.0):
            errs.append(f"{k} confidence {c} out of [0,1]")

    return r, errs


def run(fixtures):
    rows = []
    for fx in fixtures:
        r, errs = check_fixture(fx)
        tv = r["total"]["value"]
        tot = "—" if tv is None else f"{tv['amount']:.2f} {tv['currency']}"
        flag = "OK " if not errs else "!! "
        print(f"{flag}{fx['name']:<16} {tot:<14} {str(r['date']['value']):<12} "
              f"{(r['merchant']['value'] or '—')[:22]:<22} {r['category']['value']:<10} "
              f"review={r['needsReview']}")
        for e in errs:
            print(f"     - {e}")
        rows.append((fx, r, errs))
    return rows


def write_report(rows, out_path):
    with open(os.path.join(HERE, "EXPENSE_REPORT_TEMPLATE.md")) as f:
        tmpl = f.read()
    n = len(rows)
    total_ok = sum(1 for fx, r, _ in rows if not any("total" in e or "currency" in e
                                                     for e in _))
    date_ok = sum(1 for fx, r, e in rows if not any(x.startswith("date") for x in e))
    merch_ok = sum(1 for fx, r, e in rows if not any(x.startswith("merchant") for x in e))
    cat_ok = sum(1 for fx, r, e in rows if not any(x.startswith("category") for x in e))
    rev_ok = sum(1 for fx, r, e in rows if not any("needsReview" in x for x in e))
    all_ok = sum(1 for _, _, e in rows if not e)
    verdict = "PASS" if all_ok == n else "REVIEW"

    def row(fx, r):
        tv = r["total"]["value"]
        tot = "—" if tv is None else f"{tv['amount']:.2f} {tv['currency']}"
        ok = "Y" if not _errs_for(fx, r) else "N"
        return (f"| {fx['name']} | {(r['merchant']['value'] or '—')[:20]} "
                f"({r['merchant']['confidence']:.2f}) | {tot} "
                f"({r['total']['confidence']:.2f}) | {r['date']['value']} "
                f"({r['date']['confidence']:.2f}) | {r['category']['value']} "
                f"({r['category']['confidence']:.2f}) | "
                f"{'Y' if r['needsReview'] else 'N'} | {ok} |")

    def _errs_for(fx, r):
        return check_fixture(fx)[1]

    table = "\n".join(row(fx, r) for fx, r, _ in rows)
    filled = (tmpl
              .replace("{{DATE}}", time.strftime("%Y-%m-%d"))
              .replace("{{VERDICT}}", verdict)
              .replace("{{N}}", str(n))
              .replace("{{TOTAL_OK}}", f"{total_ok}/{n}")
              .replace("{{DATE_OK}}", f"{date_ok}/{n}")
              .replace("{{MERCH_OK}}", f"{merch_ok}/{n}")
              .replace("{{CAT_OK}}", f"{cat_ok}/{n}")
              .replace("{{REVIEW_OK}}", f"{rev_ok}/{n}")
              .replace("{{TABLE}}", table))
    with open(out_path, "w") as f:
        f.write(filled)
    print("\nVerdict:", verdict, "| Report written:", out_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", default=os.path.join(HERE, "expense_fixtures.json"))
    ap.add_argument("--out", default=os.path.join(HERE, "expense_report.md"))
    args = ap.parse_args()
    fixtures = json.load(open(args.fixtures, encoding="utf-8"))["fixtures"]
    rows = run(fixtures)
    write_report(rows, args.out)


if __name__ == "__main__":
    main()
