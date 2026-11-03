#!/usr/bin/env python3
"""Second check of the ledgers, reading only the CSVs and the input JSON. It shares no code with
build_ledgers.py and takes its federal figures from tax-data/us-federal/2026.json rather than the
builder's typed tables. Floats, with a 2-cent tolerance on tax; identities must hold to the cent."""
import csv, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
Y26 = json.load(open(os.path.join(REPO, "tax-data", "us-federal", "2026.json")))
LIM = {k: v["value"] for k, v in Y26["limits"].items()}

def bands(status):
    rows = Y26["withholding"]["tables"][status]["standard"] if isinstance(Y26["withholding"]["tables"][status], dict) else Y26["withholding"]["tables"][status]
    rows = sorted(rows, key=lambda r: r["threshold"])
    taxed = [r for r in rows if r["rate"] > 0]
    off = taxed[0]["threshold"]
    return [(r["threshold"] - off, r["rate"]) for r in taxed]

def sched(status, x, f):
    b = bands(status); t = 0.0
    for i, (lo, rate) in enumerate(b):
        hi = b[i + 1][0] * f if i + 1 < len(b) else float("inf")
        lo = lo * f
        if x > lo: t += (min(x, hi) - lo) * rate
    return t

def fed(status, year, f, ordinary, gain, ss, n65):
    other = ordinary + gain
    tss = 0.0
    base, adj = (32000, 44000) if status == "MFJ" else (25000, 34000)
    prov = other + ss / 2
    if ss > 0 and prov > base:
        tier1 = min(ss / 2, min(prov - base, adj - base) / 2)
        tss = min(tier1 + 0.85 * max(0, prov - adj), 0.85 * ss)
    agi = other + tss
    key = "mfj" if status == "MFJ" else "single"
    std = (LIM[f"standard_deduction_{key}"] + n65 * LIM["additional_std_deduction_65_" + ("married" if status == "MFJ" else "unmarried")]) * f
    sr = 0.0
    if year <= LIM["obbba_senior_deduction_sunset_year"]:
        st = LIM["obbba_senior_deduction_phaseout_start_" + ("mfj" if status == "MFJ" else "unmarried")]
        sr = n65 * max(0, LIM["obbba_senior_deduction_per_person"] - LIM["obbba_senior_deduction_phaseout_rate"] * max(0, agi - st))
    ti = max(0, agi - std - sr)
    br = Y26["ltcg"]["brackets"][status]
    z = next(b for b in br if b["rate"] == 0)["threshold"] if "threshold" in br[0] else None
    if z is None:
        raise SystemExit("ltcg table shape")
    top15 = next(b for b in br if b["rate"] == 0.15)["threshold"]
    z *= f; top15 *= f
    g = min(gain, ti); o = ti - g
    at0 = max(0, min(ti, z) - o)
    at15 = max(0, min(ti, top15) - max(o, z)) if g > at0 else 0
    at15 = min(at15, g - at0)
    at20 = g - at0 - at15
    tax = sched(status, o, f) + 0.15 * at15 + 0.20 * at20
    tax = min(tax, sched(status, ti, f))
    niit = 0.038 * min(gain, max(0, agi - (250000 if status == "MFJ" else 200000)))
    return tax + niit, tss, agi, sr, ti

ULT = {73:26.5,74:25.5,75:24.6,76:23.7,77:22.9,78:22.0,79:21.1,80:20.2,81:19.4,82:18.5,83:17.7,84:16.8}

def n(x): return round(float(x or 0) * 100)

problems = 0; yrs = 0; acct_lines = 0
def bad(*a):
    global problems; problems += 1; print("FAIL", *a)

for hid in ["H1", "H2", "H3", "H4", "H5", "H6", "H7"]:
    h = json.load(open(os.path.join(HERE, hid + ".input.json")))
    rows = list(csv.DictReader(open(os.path.join(HERE, hid + ".ledger.csv"))))
    accts = list(csv.DictReader(open(os.path.join(HERE, hid + ".accounts.csv"))))
    prev_ret = prev_all = None; prev_end = {}
    births = {p["id"]: p["birthDate"] for p in h["people"]}
    owner = {a["account"]: a["owner"] for a in accts}
    for r in rows:
        yrs += 1; Y = int(r["year"]); idx = Y - 2026; f = 1.03 ** idx
        ar = [a for a in accts if int(a["year"]) == Y]
        for scope, sel, cols in (("ret", [a for a in ar if a["parent"] == "Retirement"], ("ret_start", "ret_contributions", "ret_growth", "ret_end")),
                                 ("all", ar, ("all_start", "all_contributions", "all_growth", "all_end"))):
            s, c, g, e = (n(r[x]) for x in cols)
            if s + c + g - n(r["withdrawals"]) - n(r["tax"]) != e: bad(hid, Y, scope, "row identity")
            if sum(n(a["start"]) for a in sel) != s: bad(hid, Y, scope, "start sum")
            if sum(n(a["contributions"]) + n(a["match"]) + n(a["lump_sum"]) for a in sel) != c: bad(hid, Y, scope, "contrib sum")
            if sum(n(a["growth"]) for a in sel) != g: bad(hid, Y, scope, "growth sum")
            if sum(n(a["end"]) for a in sel) != e: bad(hid, Y, scope, "end sum")
        if prev_ret is not None and n(r["ret_start"]) != prev_ret: bad(hid, Y, "ret start != prior end")
        prev_ret = n(r["ret_end"])
        rate = float(r["return_rate"])
        for a in ar:
            acct_lines += 1
            k = a["account"]
            if k in prev_end and n(a["start"]) != prev_end[k]: bad(hid, Y, k, "start != prior end")
            pre = n(a["start"]) + n(a["contributions"]) + n(a["match"]) + n(a["lump_sum"]) - n(a["gross_distribution"]) + n(a["reinvested"])
            if abs(pre * rate - n(a["growth"])) > 1: bad(hid, Y, k, "growth", pre, a["growth"])
            if pre + n(a["growth"]) != n(a["end"]): bad(hid, Y, k, "account identity")
            if n(a["end"]) < 0: bad(hid, Y, k, "negative")
            prev_end[k] = n(a["end"])
        if r["reinvested"] and n(r["gross_distributions"]) - n(r["reinvested"]) != n(r["withdrawals"]) + n(r["tax"]): bad(hid, Y, "gross split")
        reinv = sum(n(a["reinvested"]) for a in ar)
        if reinv != n(r["reinvested"]): bad(hid, Y, "reinvest sum")
        for p, b in births.items():
            age = Y - int(b[:4])
            start_age = 73 if int(b[:4]) <= 1958 else 75
            base = sum(n(a["start"]) for a in ar if a["owner"] == p and a["tax"] == "traditional")
            taken = sum(n(a["gross_distribution"]) for a in ar if a["owner"] == p and a["tax"] == "traditional")
            if age >= start_age and base > 0:
                need = base / ULT[age]
                if taken + 1 < need: bad(hid, Y, p, "RMD short", taken, need)
                if f"{p}:" not in r["rmd_required"]: bad(hid, Y, p, "RMD missing")
                else:
                    shown = [x for x in r["rmd_required"].split() if x.startswith(p + ":")][0].split(":")[1]
                    if abs(n(shown) - need) > 1: bad(hid, Y, p, "RMD amount", shown, need)
            elif f"{p}:" in r["rmd_required"]: bad(hid, Y, p, "RMD too early")
        n65 = int(r["n65"])
        ord_ = float(r["ordinary_income"]); gain = float(r["ltcg"]); ss = float(r["social_security"])
        tot, tss, agi, sr, ti = fed(h["filingStatus"], Y, f, ord_, gain, ss, n65)
        if abs(tss - float(r["taxable_ss"])) > 0.02: bad(hid, Y, "taxable SS", tss, r["taxable_ss"])
        if abs(agi - float(r["agi"])) > 0.02: bad(hid, Y, "AGI", agi, r["agi"])
        if abs(ti - float(r["taxable_income"])) > 0.02: bad(hid, Y, "TI", ti, r["taxable_income"])
        tier1 = Y26["irmaa"]["brackets"][h["filingStatus"]][0]["magiThreshold"] * f
        # premium year Y+2 uses this year's MAGI, so it matters from age 63
        if agi >= tier1 and any(Y - int(b[:4]) >= 63 for b in births.values()): bad(hid, Y, "MAGI reaches IRMAA tier 1: the ledger assumes it never does (UD-10)")
        want = tot - float(r["wage_only_tax"]) + float(r["penalty"])
        if r["phase"] != "accumulation" and abs(want - float(r["tax"])) > 0.03: bad(hid, Y, "tax", want, r["tax"])
        if r["phase"] == "accumulation" and n(r["tax"]) != 0: bad(hid, Y, "tax in a pay-covers-budget year")
        if r["phase"] != "accumulation":
            got = n(r["withdrawals"]) + n(r["social_security"]) + n(r["take_home"]) + n(r["unmet_need"])
            if abs(got - n(r["spending"])) > 6: bad(hid, Y, "spending not met or over", got, r["spending"])
print(f"verified {yrs} household-years, {acct_lines} account-years, problems: {problems}")
sys.exit(1 if problems else 0)
