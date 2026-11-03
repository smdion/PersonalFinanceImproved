#!/usr/bin/env python3
"""Year-by-year ledgers for the engine spec. Written from specs/engine.md, specs/annual-tax.md and the
published tables, with no reference to Ledgr code. Whole cents throughout, so every identity is exact.
Run: python3 build_ledgers.py  (writes the CSVs, input JSON and ledgers.xlsx beside this file)"""
import csv, json, os, sys
from fractions import Fraction as Fr
from households import HOUSEHOLDS

HERE = os.path.dirname(os.path.abspath(__file__))

# 2026 federal figures: annual-tax spec s4 (Rev. Proc. 2025-32), cross-checked against tax-data/us-federal/2026.json
BANDS = {"Single": [(12400, "0.10"), (50400, "0.12"), (105700, "0.22"), (201775, "0.24"), (256225, "0.32"), (640600, "0.35"), (None, "0.37")],
         "MFJ": [(24800, "0.10"), (100800, "0.12"), (211400, "0.22"), (403550, "0.24"), (512450, "0.32"), (768700, "0.35"), (None, "0.37")]}
STD = {"Single": 16100, "MFJ": 32200}
ADDON = {"Single": 2050, "MFJ": 1650}
LTCG = {"Single": (49450, 545500), "MFJ": (98900, 613700)}
NIIT_T = {"Single": 200000, "MFJ": 250000}        # not indexed
SS_T = {"Single": (25000, 9000), "MFJ": (32000, 12000)}   # not indexed
SENIOR_START = {"Single": 75000, "MFJ": 150000}   # not indexed; ends after 2028
LIM = {"deferral": 24500, "catchup": 8000, "catchup6063": 11250}
# Pub 590-B (2025) Appendix B Table III, p.67
ULT = {72:27.4,73:26.5,74:25.5,75:24.6,76:23.7,77:22.9,78:22.0,79:21.1,80:20.2,81:19.4,82:18.5,83:17.7,84:16.8,85:16.0,86:15.2,87:14.4,88:13.7,89:12.9,90:12.2}

def fr(x): return Fr(str(x))
def rnd(x):
    """Fraction of dollars -> whole cents, half up."""
    return int((Fr(x) * 100 + Fr(1, 2)) // 1)
def d(c): return f"{c/100:.2f}"

def tax_sched(status, x, F):
    x = max(Fr(0), Fr(x)); low = Fr(0); t = Fr(0)
    for up, rate in BANDS[status]:
        hi = None if up is None else up * F
        if hi is None or x <= hi:
            return t + (x - low) * fr(rate)
        t += (hi - low) * fr(rate); low = hi

def taxable_ss(status, b, other):
    if b <= 0: return Fr(0)
    l2 = b / 2; l8 = l2 + other
    base, step = SS_T[status]
    if l8 <= base: return Fr(0)
    l10 = l8 - base; l12 = max(Fr(0), l10 - step); l13 = min(l10, Fr(step))
    return min(min(l2, l13 / 2) + fr("0.85") * l12, fr("0.85") * b)

def federal(status, year, F, ordinary, gains, ss, n65):
    """annual-tax spec ORD-1..ORD-10. ordinary, gains, ss are Fractions of dollars. Returns a dict."""
    other = ordinary + gains
    tss = taxable_ss(status, ss, other)
    agi = other + tss
    std = (STD[status] + n65 * ADDON[status]) * F
    senior = Fr(0)
    if year <= 2028 and n65:
        amt = max(Fr(0), 6000 - fr("0.06") * max(Fr(0), agi - SENIOR_START[status]))
        senior = amt * n65
    ti = max(Fr(0), agi - std - senior)
    g = gains
    z, f = LTCG[status][0] * F, LTCG[status][1] * F
    if g > 0:
        l5 = max(Fr(0), ti - g); l7 = min(ti, z); l8 = min(l5, l7); l9 = l7 - l8
        l10 = min(ti, g); l12 = l10 - l9; l14 = min(ti, f); l16 = max(Fr(0), l14 - (l5 + l9))
        l17 = min(l12, l16); l20 = l10 - (l9 + l17)
        line = min(fr("0.15") * l17 + fr("0.20") * l20 + tax_sched(status, l5, F), tax_sched(status, ti, F))
    else:
        line = tax_sched(status, ti, F)
    niit = fr("0.038") * min(g, max(Fr(0), agi - NIIT_T[status]))
    return dict(taxable_ss=tss, agi=agi, std=std, senior=senior, ti=ti, line16=line, niit=niit, total=line + niit)

def selftest():
    """Published and worked cases from the annual-tax spec and Pub 590-B."""
    one = Fr(1)
    def ck(name, got, want):
        assert abs(float(got) - want) < 0.005, (name, float(got), want)
    ck("B4", tax_sched("MFJ", 100800, one), 11600)
    ck("B9", tax_sched("MFJ", 150000, one), 22424)
    ck("P2", taxable_ss("Single", Fr(5980), Fr(28990)), 2990)
    ck("P4", taxable_ss("MFJ", Fr(10000), Fr(40500)), 6275)
    ck("S14", taxable_ss("Single", Fr(20000), Fr(100000)), 17000)
    ck("X1", federal("MFJ", 2026, one, Fr(55000), Fr(30000), Fr(40000), 2)["total"], 4484)
    ck("X2", federal("Single", 2026, one, Fr(60000), Fr(40000), Fr(30000), 1)["total"], 14875.60)
    ck("L2", federal("Single", 2026, one, Fr(5000), Fr(60000), Fr(0), 0)["total"], 0)
    ck("L3", federal("MFJ", 2026, one, Fr(0), Fr(131100), Fr(0), 0)["total"], 0)
    ck("L4", federal("MFJ", 2026, one, Fr(0), Fr(131101), Fr(0), 0)["total"], 0.15)
    ck("E7-senior", federal("MFJ", 2026, one, Fr(200000), Fr(0), Fr(0), 2)["senior"], 6000)
    ck("E9-senior", federal("MFJ", 2026, one, Fr(250000), Fr(0), Fr(0), 2)["senior"], 0)
    ck("N6", federal("MFJ", 2026, one, Fr(300000), Fr(50000), Fr(0), 0)["niit"], 1900)
    ck("590-B ex", Fr(100000) / fr(ULT[75]), 4065.04)
    return 14

class Stop(Exception): pass

def rmd_age(birth_year):
    if 1951 <= birth_year <= 1958: return 73
    if birth_year >= 1960: return 75
    raise Stop("birth year outside the settled range (EY-RMD-02)")

def run(h):
    y0 = int(h["asOfDate"][:4]); infl = fr(h["inflation"]); lg = fr(h["limitGrowth"]); st = h["filingStatus"]
    A = {a["id"]: dict(a, bal=a["balance"] * 100, basis=a.get("basis", 0) * 100 if a["tax"] == "brokerage" else None, created=False) for a in h["accounts"]}
    people = {p["id"]: p for p in h["people"]}
    by = {p["id"]: int(p["birthDate"][:4]) for p in h["people"]}
    prim = next(p for p in h["people"] if p["primary"])["id"]
    last_job = max([int(j["end"][:4]) for p in h["people"] for j in p["jobs"]], default=None)
    retire_y = (last_job + 1) if last_job else y0
    rows = []; acct_rows = []

    def working(pid, Y):
        return [j for j in people[pid]["jobs"] if int(j["end"][:4]) >= Y]

    def reinvest_target():
        for a in A.values():
            if a["tax"] == "brokerage" and a["parent"] == "Retirement": return a
        a = dict(id="projection-brokerage", owner=prim, category="brokerage", tax="brokerage", parent="Retirement",
                 balance=0, bal=0, basis=0, created=True)
        A[a["id"]] = a
        return a

    for Y in range(y0, h["endYear"] + 1):
        n = Y - y0; F = (1 + infl) ** n
        age = {p: Y - by[p] for p in by}
        n65 = sum(1 for p in by if age[p] >= 65)
        rate = None
        for rr in h["returnRates"]:
            if age[prim] >= rr["fromAge"]: rate = fr(rr["rate"])
        phase = "decumulation" if Y >= retire_y else "accumulation"
        gap = phase == "accumulation" and any(people[p]["jobs"] and not working(p, Y) for p in people)
        E = rnd(h["annualSpendingToday"] * F)
        ss = {p: (rnd(people[p]["ssAnnualToday"] * F) if age[p] >= people[p]["ssStartAge"] else 0) for p in people}
        SS = sum(ss.values())
        fl = {k: dict(start=A[k]["bal"], contrib=0, match=0, lump=0, dist=0, reinvest=0, basis_start=A[k]["basis"]) for k in A}
        sal = {}
        for p in people:
            sal[p] = sum(rnd(j["salary"] * (1 + fr(j["salaryGrowth"])) ** n) for j in working(p, Y))
        rmd = {p: 0 for p in people}
        tradbase = {p: sum(a["bal"] for a in A.values() if a["owner"] == p and a["tax"] == "traditional") for p in people}
        for p in people:
            if age[p] >= rmd_age(by[p]) and tradbase[p] > 0:
                rmd[p] = rnd(Fr(tradbase[p], 100) / fr(ULT[age[p]]))
        box1 = 0; fica = 0; employee_cash = 0
        deferred = {}
        # 1. contributions, match, overflow
        if phase == "accumulation":
            assert not any(rmd.values()), "RMD in an accumulation year: UD-05"
            for c in h["contributions"]:
                p = c["person"]
                if not working(p, Y): continue
                amt = rnd(fr(c["value"]) * sal[p] / 100) if c["kind"] == "percent" else c["value"] * 100
                over = 0
                if c.get("group") == "401k":
                    a_ = age[p]
                    cu = LIM["catchup6063"] if 60 <= a_ <= 63 else LIM["catchup"] if a_ >= 50 else 0
                    cap = rnd((LIM["deferral"] + cu) * (1 + lg) ** n)
                    room = cap - deferred.get(p, 0)
                    if amt > room:
                        over = amt - room; amt = room
                    deferred[p] = deferred.get(p, 0) + amt
                    assert over == 0 or c.get("overflowTo"), "over limit with no overflow"
                fl[c["account"]]["contrib"] += amt
                if over:
                    t = A[c["overflowTo"]]; fl[t["id"]]["contrib"] += over; t["basis"] += over
                if A[c["account"]]["tax"] == "brokerage": A[c["account"]]["basis"] += amt
                employee_cash += amt + over
                if c["payroll"] in ("pretax", "section125"):
                    box1 -= amt
                m = c.get("match")
                if m:
                    mm = rnd(fr(m["rate"]) * min(fr(c["value"]) if c["kind"] == "percent" else Fr(amt + over, sal[p]),
                                                 fr(m["capPercent"])) * sal[p] / 100)
                    fl[m["account"]]["match"] += mm
            for L in h["lumpSums"]:
                if L["year"] == Y:
                    fl[L["account"]]["lump"] += L["amount"] * 100
                    A[L["account"]]["basis"] += L["amount"] * 100
        for L in h["lumpSums"]:
            assert L["year"] < retire_y
        wages = sum(sal.values())
        box1 += wages
        # pay covers the budget in a non-gap accumulation year: no draw and no tax from balances
        base_fed = federal(st, Y, F, Fr(box1, 100), Fr(0), Fr(0), n65)["total"] if phase == "accumulation" else Fr(0)
        takehome = 0
        if gap:
            fica_wages = wages - sum(rnd(fr(c["value"])) * 100 for c in h["contributions"]
                                     if c["payroll"] == "section125" and working(c["person"], Y))
            assert max(sal.values()) < 18450000, "wage base would bind: not modelled"
            fica = rnd(Fr(fica_wages, 100) * fr("0.0765"))
            takehome = wages - employee_cash - fica - rnd(base_fed)
        need = E - SS - takehome          # after-tax money the balances must deliver
        if phase == "decumulation" or gap:
            assert need >= 0, (h["id"], Y, "income above spending: UD-03")
        else:
            need = 0

        def route(W, final=False):
            """Waterfall. Returns draws {id: cents}, ordinary dollars, gain cents, penalty cents."""
            left = W; dr = {}; gain = 0; ordc = 0; pen = 0
            for k in h["waterfall"]:
                a = A[k]
                if left <= 0: break
                av = a["bal"]
                if a["parent"] != "Retirement" or av <= 0: continue
                x = min(left, av); left -= x; dr[k] = x
                if a["tax"] == "brokerage":
                    gain += rnd(Fr(x, 100) * (a["bal"] - a["basis"]) / a["bal"])
                elif a["tax"] == "traditional":
                    ordc += x
                    o = people[a["owner"]]; b = o["birthDate"]
                    # 59 1/2 reached by Jan 1 of Y? (H6 is built so the answer is exact)
                    reached = (Y - int(b[:4])) * 12 - (int(b[5:7]) - 1) >= 59 * 12 + 6
                    if not reached: pen += rnd(Fr(x, 100) * fr("0.10"))
                elif a["tax"] == "roth":
                    assert not final or age[a["owner"]] >= 60, "non-qualified Roth draw: UD-07"
                elif final:
                    raise Stop("HSA draw: UD-06")
            return dr, ordc, gain, pen

        def price(dr_ord, gain, pen):
            res = federal(st, Y, F, Fr(box1 + dr_ord, 100), Fr(gain, 100), Fr(SS, 100), n65)
            return rnd(res["total"] - base_fed) + pen, res

        def net(W):
            dr, o, g, pen = route(W)
            t, _ = price(o, g, pen)
            return W - t

        avail = sum(A[k]["bal"] for k in h["waterfall"] if A[k]["parent"] == "Retirement")
        W = 0; rows_note = ""
        if phase == "decumulation" or gap:
            if net(0) >= need:
                W = 0
            elif net(avail) < need:
                W = avail
            else:
                lo, hi = 0, avail
                while hi - lo > 1:
                    mid = (lo + hi) // 2
                    if net(mid) >= need: hi = mid
                    else: lo = mid
                W = hi
        draws, ordc, gain, pen = route(W, final=True)
        routed = dict(draws)
        # 2. RMD: per owner, from that owner's accounts
        topped = False
        for p in people:
            own = [k for k in A if A[k]["owner"] == p and A[k]["tax"] == "traditional"]
            got = sum(draws.get(k, 0) for k in own)
            short = rmd[p] - got
            if short > 0:
                topped = True
                for k in own:
                    room = A[k]["bal"] - draws.get(k, 0)
                    x = min(room, short); short -= x
                    if x: draws[k] = draws.get(k, 0) + x
                assert short == 0
        if topped:
            # UD-04 guard: every reading of "top up" agrees only if no routed dollar sits above someone's minimum
            for p in people:
                own = [k for k in A if A[k]["owner"] == p]
                got = sum(routed.get(k, 0) for k in own)
                assert got <= rmd[p], (h["id"], Y, "routing above a minimum while topping up", p, got, rmd[p])
        gross = sum(draws.values())
        if gross != W:
            ordc = sum(x for k, x in draws.items() if A[k]["tax"] == "traditional")
            # gains cannot have changed: the guard above means no brokerage draw coexists with a top-up
            assert gain == 0
        taxc, res = price(ordc, gain, pen)
        delivered = gross - taxc
        reinvest = max(0, delivered - max(need, 0)) if topped else 0
        delivered -= reinvest
        unmet = max(0, need - delivered) if (phase == "decumulation" or gap) else 0
        # gross-up residue is under a few cents; anything else is a real unmet need
        if unmet <= 5: unmet = 0
        # 3. post the flows, basis first
        for k, x in draws.items():
            a = A[k]; fl[k]["dist"] = x
            if a["tax"] == "brokerage":
                a["basis"] -= rnd(Fr(x, 100) * a["basis"] / a["bal"]) if x < a["bal"] else a["basis"]
            a["bal"] -= x
        for k, a in A.items():
            f = fl[k]; a["bal"] += f["contrib"] + f["match"] + f["lump"]
        if reinvest:
            t = reinvest_target()
            fl.setdefault(t["id"], dict(start=0, contrib=0, match=0, lump=0, dist=0, reinvest=0, basis_start=0))
            fl[t["id"]]["reinvest"] = reinvest; t["bal"] += reinvest; t["basis"] += reinvest
        # 4. growth, last
        for k, a in A.items():
            g = rnd(Fr(a["bal"], 100) * rate); fl[k]["growth"] = g; a["bal"] += g
        # rows
        for k, a in A.items():
            f = fl[k]
            acct_rows.append(dict(household=h["id"], year=Y, account=k, owner=a["owner"], tax=a["tax"], parent=a["parent"],
                start=d(f["start"]), contributions=d(f["contrib"]), match=d(f["match"]), lump_sum=d(f["lump"]),
                gross_distribution=d(f["dist"]), reinvested=d(f["reinvest"]), growth=d(f["growth"]), end=d(a["bal"]),
                basis_end="" if a["basis"] is None else d(a["basis"])))
        ret = [k for k in A if A[k]["parent"] == "Retirement"]
        sumf = lambda key, keys: sum(fl[k][key] for k in keys)
        def scope(keys):
            s = sumf("start", keys); c = sumf("contrib", keys) + sumf("match", keys) + sumf("lump", keys)
            g = sumf("growth", keys); e = sum(A[k]["bal"] for k in keys)
            return s, c, g, e
        s, c, g, e = scope(ret)
        s2, c2, g2, e2 = scope(list(A))
        row = dict(year=Y, phase=phase + ("-gap" if gap else ""),
            ages=" ".join(f"{p}{age[p]}" for p in age), return_rate=str(float(rate)),
            spending=d(E), social_security=d(SS), wages=d(wages), take_home=d(takehome),
            ret_start=d(s), ret_contributions=d(c), ret_growth=d(g), withdrawals=d(delivered), tax=d(taxc), ret_end=d(e),
            check_ret=d(s + c + g - delivered - taxc - e),
            all_start=d(s2), all_contributions=d(c2), all_growth=d(g2), all_end=d(e2),
            check_all=d(s2 + c2 + g2 - delivered - taxc - e2),
            gross_distributions=d(gross), reinvested=d(reinvest), unmet_need=d(unmet), penalty=d(pen),
            rmd_required=" ".join(f"{p}:{d(rmd[p])}" for p in rmd if rmd[p]) or "",
            box1_wages=d(box1), ordinary_income=d(box1 + ordc), ltcg=d(gain), taxable_ss=d(rnd(res["taxable_ss"])),
            agi=d(rnd(res["agi"])), std_deduction=d(rnd(res["std"])), senior_deduction=d(rnd(res["senior"])),
            taxable_income=d(rnd(res["ti"])), federal_income_tax=d(rnd(res["line16"])), niit=d(rnd(res["niit"])),
            n65=n65, wage_only_tax=d(rnd(base_fed)), fica=d(fica))
        assert s + c + g - delivered - taxc == e, (h["id"], Y)
        assert s2 + c2 + g2 - delivered - taxc == e2, (h["id"], Y)
        rows.append(row)
    return rows, acct_rows

def main():
    n = selftest(); print("selftest cases passed:", n)
    from openpyxl import Workbook
    from openpyxl.styles import Font
    wb = Workbook(); wb.remove(wb.active)
    for h in HOUSEHOLDS:
        rows, acct = run(h)
        with open(os.path.join(HERE, h["id"] + ".input.json"), "w") as f: json.dump(h, f, indent=2)
        for suffix, rs in (("ledger", rows), ("accounts", acct)):
            with open(os.path.join(HERE, f'{h["id"]}.{suffix}.csv'), "w", newline="") as f:
                w = csv.DictWriter(f, fieldnames=list(rs[0])); w.writeheader(); w.writerows(rs)
        ws = wb.create_sheet(h["id"])
        cols = list(rows[0])
        ws.append(cols)
        for c in ws[1]: c.font = Font(bold=True)
        for r_i, r in enumerate(rows, start=2):
            out = []
            for k in cols:
                v = r[k]
                try: v = float(v) if k not in ("ages", "phase", "rmd_required") else v
                except ValueError: pass
                out.append(v)
            ws.append(out)
            L = {k: ws.cell(row=1, column=i + 1).column_letter for i, k in enumerate(cols)}
            ws[f'{L["check_ret"]}{r_i}'] = f'=ROUND({L["ret_start"]}{r_i}+{L["ret_contributions"]}{r_i}+{L["ret_growth"]}{r_i}-{L["withdrawals"]}{r_i}-{L["tax"]}{r_i}-{L["ret_end"]}{r_i},2)'
            ws[f'{L["check_all"]}{r_i}'] = f'=ROUND({L["all_start"]}{r_i}+{L["all_contributions"]}{r_i}+{L["all_growth"]}{r_i}-{L["withdrawals"]}{r_i}-{L["tax"]}{r_i}-{L["all_end"]}{r_i},2)'
        ws.freeze_panes = "C2"
        wa = wb.create_sheet(h["id"] + " accounts")
        wa.append(list(acct[0])); 
        for c in wa[1]: c.font = Font(bold=True)
        for r in acct:
            wa.append([float(v) if k in ("start","contributions","match","lump_sum","gross_distribution","reinvested","growth","end") or (k=="basis_end" and v!="") else v for k, v in r.items()])
        wa.freeze_panes = "D2"
    wb.save(os.path.join(HERE, "ledgers.xlsx"))

if __name__ == "__main__":
    main()
