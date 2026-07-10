# ---------------------------------------------------------------------------
# LifePilot — OCR Expense (feature #4): ExecuTorch EXTRACTION models
# GPU export: 2 tiny MLPs -> ExecuTorch .pte (XNNPACK, ExecuTorch v0.6.0)
# ---------------------------------------------------------------------------
# PRIVACY: this whole feature is 100% on-device, ZERO network.
#   - Raw OCR (image -> text) = platform-native on-device (Apple Vision / ML Kit),
#     never uploaded (contract §1). No pixels leave the device.
#   - EXTRACTION (OCR text -> fields) now runs through ExecuTorch models (owner
#     directive: ExecuTorch for everything). Two tiny classifiers:
#       (A) LINE TAGGER : per-line {OTHER, MERCHANT, DATE, TOTAL, ITEM}
#       (B) CATEGORY    : receipt text -> one of 7 categories
#     The deterministic parser (ml/test/expense_eval.py) is now the FALLBACK and
#     the LABEL/TRAINING-DATA generator (it weak-labels the synthetic receipts).
#
# Featurization = hashed character-trigram bag (FNV-1a, dim 256). It is DETERMINISTIC
# and must be ported to TS exactly (mobile/src/features/expense/) — params in manifest.
#
# WHERE TO RUN: the AMD ROCm notebook (CPU fine). Internet ON to clone+build executorch. Never on
# the 8 GB dev PC. No real receipts — synthetic generator only (no user data).
# ---------------------------------------------------------------------------

# %%
import os, re, hashlib, json, time
EXECUTORCH_REF = "v0.6.0"
SEED = 11; HASH_DIM = 256; NGRAM = 3
WORK = "/tmp/lifepilot_export"; ET_DIR = f"{WORK}/executorch"; OUT = f"{WORK}/expense_out"
os.makedirs(OUT, exist_ok=True)

# Install ExecuTorch (and its pinned torch==2.7.0) BEFORE importing torch anywhere
# else in this process — pip installing it later would leave a stale, incompatible
# torch already loaded in memory from an earlier `import torch`.
import subprocess
subprocess.run(["pip", "install", f"executorch=={EXECUTORCH_REF.lstrip('v')}", "-q"], check=True)

import numpy as np; rng = np.random.default_rng(SEED)

LINE_LABELS = ["OTHER", "MERCHANT", "DATE", "TOTAL", "ITEM"]
CATEGORIES  = ["Food", "Groceries", "Transport", "Health", "Shopping", "Utilities", "Other"]

# %% [markdown]
# ## 1. Deterministic featurizer (PORT THIS TO TS EXACTLY)
# FNV-1a 32-bit over lowercased character trigrams -> bucket counts -> L2 normalize.

# %%
def fnv1a(s: str) -> int:
    h = 0x811c9dc5
    for ch in s.encode("utf-8"):
        h ^= ch; h = (h * 0x01000193) & 0xFFFFFFFF
    return h

def hashbow(text: str, dim=HASH_DIM, n=NGRAM):
    t = re.sub(r"\s+", " ", (text or "").lower()).strip()
    v = np.zeros(dim, dtype=np.float32)
    pad = " " + t + " "
    for i in range(len(pad) - n + 1):
        v[fnv1a(pad[i:i+n]) % dim] += 1.0
    nrm = np.linalg.norm(v)
    return v / nrm if nrm > 0 else v

MONEY_RE = re.compile(r"\d+[.,]\d{2}(?!\d)")
DATE_RE  = re.compile(r"\b\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}\b|\b[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}\b")
def layout_feats(text, y_rel, h_rel, conf):
    alpha = sum(c.isalpha() for c in text) / max(1, len(text.replace(" ", "")))
    return np.array([y_rel, h_rel, conf, 1.0 if MONEY_RE.search(text) else 0.0,
                     1.0 if DATE_RE.search(text) else 0.0, alpha], dtype=np.float32)
LAYOUT_DIM = 6

# %% [markdown]
# ## 2. Synthetic receipt generator -> labeled lines + receipt category.
# Encodes our priors about receipt layout; no real data. Merchant pools mirror the
# parser's category keywords so the two stay consistent.

# %%
MERCHANTS = {
    "Groceries": ["WHOLE FOODS MARKET", "SAFEWAY", "KROGER", "ALDI", "TRADER JOE'S", "PUBLIX"],
    "Food": ["THE CORNER BISTRO", "STARBUCKS", "PIZZERIA UNO", "BURGER BARN", "SUSHI KO", "CAFE MUMBAI"],
    "Transport": ["SHELL", "CHEVRON", "EXXON", "UBER", "CITY PARKING", "METRO TRANSIT"],
    "Health": ["CVS PHARMACY", "WALGREENS", "RITE AID", "WELLNESS CLINIC"],
    "Shopping": ["BEST BUY", "TARGET", "URBAN OUTFITTERS", "THE BOUTIQUE"],
    "Utilities": ["CITY ELECTRIC", "BROADBAND CO", "WATER UTILITY"],
}
ITEMS = ["Bananas", "Almond Milk", "Coffee", "Sandwich", "Unleaded", "Ibuprofen", "Vitamin D",
         "T-Shirt", "Cable", "Latte", "Burger", "Fries", "Parking 1h", "Toll", "Shampoo"]

def money(): return f"{rng.uniform(1, 90):.2f}"
def date_str():
    f = rng.integers(0, 3)
    d, m, y = int(rng.integers(1, 28)), int(rng.integers(1, 12)), 2026
    if f == 0: return f"{m:02d}/{d:02d}/{y}"
    if f == 1: return f"{y}-{m:02d}-{d:02d}"
    mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1]
    return f"{mon} {d}, {y}"

def gen_receipt():
    cat = CATEGORIES[int(rng.integers(0, len(CATEGORIES)-1))]  # not "Other"
    merch = MERCHANTS[cat][int(rng.integers(0, len(MERCHANTS[cat])))]
    lines = [(merch, "MERCHANT")]
    if rng.random() < 0.7: lines.append((f"{rng.integers(1,999)} Main St", "OTHER"))
    if rng.random() < 0.4: lines.append((f"Tel: 555-{rng.integers(1000,9999)}", "OTHER"))
    n_items = int(rng.integers(1, 5)); sub = 0.0
    for _ in range(n_items):
        a = float(money()); sub += a
        lines.append((f"{ITEMS[int(rng.integers(0,len(ITEMS)))]} {a:.2f}", "ITEM"))
    if rng.random() < 0.8: lines.append((f"SUBTOTAL {sub:.2f}", "OTHER"))
    tax = sub * 0.08; lines.append((f"TAX {tax:.2f}", "OTHER"))
    tot = sub + tax
    lines.append((f"TOTAL {tot:.2f}", "TOTAL"))
    if rng.random() < 0.5: lines.append((f"VISA {tot:.2f}", "OTHER"))
    lines.append((date_str(), "DATE"))
    if rng.random() < 0.3: lines.append(("THANK YOU", "OTHER"))
    return cat, lines

def build_dataset(n_receipts=8000):
    Xl, Yl, Xc, Yc = [], [], [], []
    for _ in range(n_receipts):
        cat, lines = gen_receipt()
        H = len(lines)
        body = " ".join(t for t, _ in lines)
        Xc.append(hashbow(body)); Yc.append(CATEGORIES.index(cat))
        for i, (text, label) in enumerate(lines):
            y_rel = i / max(1, H - 1); h_rel = 1.0 if label == "MERCHANT" else 0.5
            conf = float(np.clip(rng.normal(0.9, 0.08), 0.4, 1.0))
            feat = np.concatenate([hashbow(text), layout_feats(text, y_rel, h_rel, conf)])
            Xl.append(feat); Yl.append(LINE_LABELS.index(label))
    return (np.array(Xl, np.float32), np.array(Yl, np.int64),
            np.array(Xc, np.float32), np.array(Yc, np.int64))

Xl, Yl, Xc, Yc = build_dataset()
print("line samples", Xl.shape, "| receipt samples", Xc.shape)

# %% [markdown]
# ## 3. Two tiny MLP classifiers (Linear/ReLU -> XNNPACK).

# %%
import torch, torch.nn as nn
class MLP(nn.Module):
    def __init__(self, n_in, n_out, hidden=64):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(n_in, hidden), nn.ReLU(),
                                 nn.Linear(hidden, hidden), nn.ReLU(),
                                 nn.Linear(hidden, n_out))   # logits (softmax on device)
    def forward(self, x): return self.net(x)

def train(model, X, Y, epochs=25, bs=512, name=""):
    dev = "cuda" if torch.cuda.is_available() else "cpu"; model.to(dev)
    Xt = torch.from_numpy(X).to(dev); Yt = torch.from_numpy(Y).to(dev)
    idx = torch.randperm(X.shape[0]); cut = int(0.9*X.shape[0]); tr, va = idx[:cut], idx[cut:]
    opt = torch.optim.Adam(model.parameters(), 2e-3); lf = nn.CrossEntropyLoss()
    for ep in range(epochs):
        model.train(); perm = tr[torch.randperm(tr.numel())]
        for i in range(0, perm.numel(), bs):
            b = perm[i:i+bs]; opt.zero_grad()
            lf(model(Xt[b]), Yt[b]).backward(); opt.step()
    model.eval()
    with torch.no_grad():
        acc = (model(Xt[va]).argmax(1) == Yt[va]).float().mean().item()
    print(f"{name} val acc {acc:.3f}")
    return model.to("cpu")

torch.manual_seed(SEED)
line_model = train(MLP(HASH_DIM+LAYOUT_DIM, len(LINE_LABELS)), Xl, Yl, name="line-tagger")
cat_model  = train(MLP(HASH_DIM, len(CATEGORIES)), Xc, Yc, name="category")

# %% [markdown]
# ## 4. Export both to ExecuTorch .pte (XNNPACK, v0.6.0).
# ExecuTorch was already installed in step 0, before torch was first imported.

# %%
from torch.export import export, export_for_training
from executorch.exir import to_edge_transform_and_lower, EdgeCompileConfig
from executorch.backends.xnnpack.partition.xnnpack_partitioner import XnnpackPartitioner
def export_pte(model, n_in, path):
    ex = (torch.zeros(1, n_in, dtype=torch.float32),)
    trained = export_for_training(model, ex).module()
    edge = to_edge_transform_and_lower(export(trained, ex),
            compile_config=EdgeCompileConfig(_check_ir_validity=False),
            partitioner=[XnnpackPartitioner()])
    with open(path, "wb") as f: edge.to_executorch().write_to_file(f)
    print("exported", path, os.path.getsize(path), "bytes")

LINE_PTE = f"{OUT}/expense_line_tagger.pte"; CAT_PTE = f"{OUT}/expense_category.pte"
export_pte(line_model, HASH_DIM+LAYOUT_DIM, LINE_PTE)
export_pte(cat_model, HASH_DIM, CAT_PTE)

# %% [markdown]
# ## 5. Manifest (featurizer params = single source of truth for the TS port).

# %%
def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for ch in iter(lambda: f.read(1<<20), b""): h.update(ch)
    return h.hexdigest()
manifest = {
    "name": "expense_extractor", "executorch_version": EXECUTORCH_REF, "backend": "xnnpack",
    "exported_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "featurizer": {"type": "hashed_char_ngram_bow", "hash": "fnv1a_32",
                   "dim": HASH_DIM, "ngram": NGRAM, "lowercase": True, "l2_normalize": True,
                   "note": "PORT TO TS EXACTLY — pad with single spaces, FNV-1a over utf-8 bytes"},
    "line_tagger": {"pte": "expense_line_tagger.pte", "input_dim": HASH_DIM+LAYOUT_DIM,
                    "layout_dim": LAYOUT_DIM,
                    "layout_features": ["y_rel","h_rel","conf","has_amount","has_date","alpha_ratio"],
                    "labels": LINE_LABELS, "bytes": os.path.getsize(LINE_PTE), "sha256": sha256(LINE_PTE)},
    "category": {"pte": "expense_category.pte", "input_dim": HASH_DIM,
                 "labels": CATEGORIES, "bytes": os.path.getsize(CAT_PTE), "sha256": sha256(CAT_PTE)},
    "synthetic_training": True,
    "fallback": "deterministic parser ml/test/expense_eval.py (used when model confidence < 0.6)",
}
with open(f"{OUT}/manifest.json", "w") as f: json.dump(manifest, f, indent=2)
print(json.dumps({"line": manifest["line_tagger"]["sha256"][:12],
                  "cat": manifest["category"]["sha256"][:12]}, indent=2))

# %%
import shutil
shutil.make_archive(f"{WORK}/expense_model_bundle", "zip", OUT)
print("Download:", f"{WORK}/expense_model_bundle.zip → ml/models/expense/ + mobile/src/models/expense/")
