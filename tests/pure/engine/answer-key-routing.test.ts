/**
 * Answer key, strategies: withdrawal routing and the gross-up
 * (`.scratch/docs/drafts/answer-key.md` § Strategies; rulings in
 * `reviews/2026-11-01/rebuild/strategies-verdicts.md`, rules and cases in
 * `reviews/2026-11-01/specs/strategies.md` §§ 12-13 and § 15 C57-C69).
 * Ids are the spec's own, prefixed `strategies/` like the spending cases
 * in `answer-key-strategies.test.ts`; the bracketed part is the
 * docs/CALCULATIONS.md row.
 *
 * Functions: `routeForMode` (`engine/withdrawal-routing/index.ts`), the one
 * routing dispatch; `computeTaxFromSlots` (`engine/tax-estimation.ts`);
 * `estimateWithdrawalTaxCost` (`engine/withdrawal-solver.ts`), the gross-up
 * solver. Routing's three modes are owner designs (DESIGN 335-337; spec
 * WF-2, PC-1, BF-5): the cases check them against their stated rules.
 *
 * Tax figures are worked from the 2026 rate schedule for married filing
 * jointly (Rev. Proc. 2025-32 § 4.01 Table 1: 10% to 24,800, 12% to
 * 100,800, 22% to 211,400, 24% to 403,550) and the 2026 basic standard
 * deduction 32,200 (§ 4.14), under 65, no add-ons, so a gross ordinary
 * income G is taxed on G − 32,200: 2,480 at 57,000 and 11,600 at
 * 133,000. Gains: 0% to taxable income 98,900, 15% above (§ 4.03). Ledgr
 * prices with the Pub 15-T (2026) standard MFJ withholding table and the
 * deduction's residual (owner design, spec GU-3); for 2026 its rows are
 * the rate schedule moved by 32,200, so the figures agree to the cent
 * (the table is checked against Pub 15-T in
 * `tests/tax-data/irs-published.test.ts`).
 */
import { describe, expect, it } from "vitest";
import { cents, runOneYear, xfail } from "../../fixtures/answer-key";
import { routeForMode } from "@/lib/pure/engine/withdrawal-routing";
import { computeTaxFromSlots } from "@/lib/pure/engine/tax-estimation";
import type { WithholdingBracket } from "@/lib/pure/engine/tax-estimation";
import { estimateWithdrawalTaxCost } from "@/lib/pure/engine/withdrawal-solver";
import { getAllCategories, zeroBalance } from "@/lib/config/account-types";
import {
  setBalance,
  setBasis,
  setRoth,
  setTraditional,
} from "@/lib/pure/accounts/account-balance";
import type { AccountBalances } from "@/lib/pure/accounts/account-balances.types";
import type { AccountCategory } from "@/lib/config/account-types";
import type {
  DecumulationSlot,
  ResolvedDecumulationConfig,
} from "@/lib/pure/engine/types";
import {
  makeDecumulationConfig,
  makeTaxBuckets,
} from "../fixtures/engine-fixtures";
import { readTaxData, shippedTaxTables } from "../../helpers/tax-data";
import { acct, household } from "../fixtures/two-person-household";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The shipped 2026 Pub 15-T standard MFJ table (input under test). */
const MFJ_2026 = readTaxData().years["2026"]!.withholding.tables["MFJ"]!
  .standard as WithholdingBracket[];
const LTCG_2026 = shippedTaxTables(2026).ltcgBrackets;
/** Rev. Proc. 2025-32 § 4.14: MFJ basic standard deduction, 2026. */
const STD_MFJ_2026 = 32_200;

type Holdings = {
  traditional?: number;
  roth?: number;
  brokerage?: number;
  basis?: number;
  hsa?: number;
};

/** The household's money: Traditional and Roth in the IRA, a brokerage
 *  with its basis, an HSA. Nothing else holds a balance. */
function holdings(h: Holdings) {
  const accountBalance = Object.fromEntries(
    getAllCategories().map((c) => [c, zeroBalance(c)]),
  ) as AccountBalances;
  setTraditional(accountBalance.ira, h.traditional ?? 0);
  setRoth(accountBalance.ira, h.roth ?? 0);
  setBalance(accountBalance.brokerage, h.brokerage ?? 0);
  setBasis(accountBalance.brokerage, h.basis ?? h.brokerage ?? 0);
  setBalance(accountBalance.hsa, h.hsa ?? 0);
  const buckets = makeTaxBuckets({
    preTax: h.traditional ?? 0,
    taxFree: h.roth ?? 0,
    afterTax: h.brokerage ?? 0,
    afterTaxBasis: h.basis ?? h.brokerage ?? 0,
    hsa: h.hsa ?? 0,
  });
  const total =
    (h.traditional ?? 0) + (h.roth ?? 0) + (h.brokerage ?? 0) + (h.hsa ?? 0);
  return { accountBalance, buckets, total };
}

/** Bracket filling at `target` (none: the mode falls back to Waterfall),
 *  IRA first, Traditional preferred. */
const bracketConfig = (): ResolvedDecumulationConfig =>
  makeDecumulationConfig({
    withdrawalRoutingMode: "bracket_filling",
    withdrawalOrder: ["ira", "brokerage", "hsa", "401k", "403b"],
  });

const bracketInfo = (o: {
  target?: number;
  otherIncome?: number;
  basisRatio?: number;
}) => ({
  taxBrackets: MFJ_2026,
  ...(o.target != null ? { rothBracketTarget: o.target } : {}),
  // Other ordinary income reaches routing through `taxableSS` (the
  // field `computeBracketTraditionalCap` subtracts).
  taxableSS: o.otherIncome ?? 0,
  filingStatus: "MFJ" as const,
  ltcgBrackets: LTCG_2026,
  standardDeduction: STD_MFJ_2026,
  ...(o.basisRatio != null ? { brokerageBasisRatio: o.basisRatio } : {}),
});

const taxRates = (target?: number) => ({
  grossUpForTaxes: true,
  traditionalFallbackRate: 0.22,
  roth: 0,
  hsa: 0,
  brokerage: 0.15,
  taxBrackets: MFJ_2026,
  taxMultiplier: 1,
  ltcgBrackets: LTCG_2026,
  standardDeduction: STD_MFJ_2026,
  ...(target != null ? { rothBracketTarget: target } : {}),
});

/** The gross-up for an after-tax need, then the routing it settles on. */
function grossUp(
  need: number,
  h: Holdings,
  o: { config?: ResolvedDecumulationConfig; target?: number } = {},
) {
  const { accountBalance, buckets, total } = holdings(h);
  const config = o.config ?? bracketConfig();
  const est = estimateWithdrawalTaxCost({
    ssSurplus: 0,
    afterTaxNeed: need,
    ssIncome: 0,
    filingStatus: "MFJ",
    config,
    taxRates: taxRates(o.target),
    balances: buckets,
    accountBalance,
    totalBalance: total,
  });
  const routed = routeForMode(
    est.targetWithdrawal,
    config,
    accountBalance,
    bracketInfo({ target: o.target }),
  );
  return { est, ...drawn(routed.slots) };
}

/** What each source gave. */
function drawn(slots: DecumulationSlot[]) {
  const of = (c: AccountCategory) => slots.find((s) => s.category === c);
  return {
    // An HSA draw is booked as Traditional in its slot (ordinary income,
    // `withdrawal-routing/waterfall.ts:60`); it's counted under `hsa` here.
    traditional: slots
      .filter((s) => s.category !== "hsa")
      .reduce((t, s) => t + s.traditionalWithdrawal, 0),
    roth: slots.reduce((t, s) => t + s.rothWithdrawal, 0),
    brokerage: of("brokerage")?.withdrawal ?? 0,
    hsa: of("hsa")?.withdrawal ?? 0,
    "401k": of("401k")?.withdrawal ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Waterfall and Percentage (spec WF-1 to WF-4, PC-1 to PC-4)
// ---------------------------------------------------------------------------

describe("answer key: Waterfall and Percentage routing", () => {
  // A, B, C = a brokerage (all basis), an HSA and a 401(k) Traditional,
  // drawn in that order. Routing moves gross dollars; no tax enters.
  const abc = (o: { brokerage: number; hsa: number; k401: number }) => {
    const acctBal = Object.fromEntries(
      getAllCategories().map((c) => [c, zeroBalance(c)]),
    ) as AccountBalances;
    setBalance(acctBal.brokerage, o.brokerage);
    setBasis(acctBal.brokerage, o.brokerage);
    setBalance(acctBal.hsa, o.hsa);
    setTraditional(acctBal["401k"], o.k401);
    return acctBal;
  };
  const ORDER: AccountCategory[] = ["brokerage", "hsa", "401k", "403b", "ira"];
  const noBrackets = { taxableSS: 0, ltcgBrackets: LTCG_2026 };

  it("strategies/C57 [WDR-02] the order with an account cap: 30,000; 25,000; 15,000", () => {
    // A 30,000, B 50,000 capped at 25,000, C 100,000; need 70,000: A
    // empties (30,000), B gives its cap (25,000), C the rest (15,000)
    // (DESIGN: order and per-account caps; spec WF-2).
    const r = routeForMode(
      70_000,
      makeDecumulationConfig({
        withdrawalOrder: ORDER,
        withdrawalAccountCaps: {
          "401k": null,
          "403b": null,
          ira: null,
          hsa: 25_000,
          brokerage: null,
        },
      }),
      abc({ brokerage: 30_000, hsa: 50_000, k401: 100_000 }),
      noBrackets,
    );
    const d = drawn(r.slots);
    cents(
      { A: d.brokerage, B: d.hsa, C: d["401k"] },
      { A: 30_000, B: 25_000, C: 15_000 },
    );
  });

  it("strategies/C58 [WDR-02] everything empty: all of it, and 20,000 reported short", () => {
    // Same balances, no cap, need 200,000: 30,000 + 50,000 + 100,000 =
    // 180,000 drawn; 20,000 unmet, none invented (spec WF-4).
    const r = routeForMode(
      200_000,
      makeDecumulationConfig({ withdrawalOrder: ORDER }),
      abc({ brokerage: 30_000, hsa: 50_000, k401: 100_000 }),
      noBrackets,
    );
    const d = drawn(r.slots);
    cents(
      { A: d.brokerage, B: d.hsa, C: d["401k"], unmet: r.unmetNeed ?? 0 },
      { A: 30_000, B: 50_000, C: 100_000, unmet: 20_000 },
    );
  });

  it("strategies/C59 [WDR-03] a share that can't be paid spills to the others pro rata", () => {
    // Shares 60/30/10, need 100,000; A 100,000, B 20,000, C 500,000. B's
    // 30,000 share is capped by its 20,000; the 10,000 left splits 60:10
    // across A and C (DESIGN 337, "placed on the others"; pro rata is the
    // spec's reading, OPEN-10): A 60,000 + 8,571.43 = 68,571.43; C
    // 10,000 + 1,428.57 = 11,428.57.
    const r = routeForMode(
      100_000,
      makeDecumulationConfig({
        withdrawalRoutingMode: "percentage",
        withdrawalOrder: ORDER,
        withdrawalSplits: {
          brokerage: 0.6,
          hsa: 0.3,
          "401k": 0.1,
          "403b": 0,
          ira: 0,
        },
      }),
      abc({ brokerage: 100_000, hsa: 20_000, k401: 500_000 }),
      noBrackets,
    );
    const d = drawn(r.slots);
    cents(
      { A: d.brokerage, B: d.hsa, C: d["401k"] },
      { A: 68_571.43, B: 20_000, C: 11_428.57 },
    );
  });
});

// ---------------------------------------------------------------------------
// Bracket filling (spec BF-1 to BF-9; Horan, JFP Nov 2006) and the
// gross-up (GU-1: G − tax(G) = need)
// ---------------------------------------------------------------------------

describe("answer key: Bracket filling", () => {
  it("strategies/C61 [WDR-04] a need under the room: G 131,409.09, all Traditional", () => {
    // Target 12%: the cap is 100,800 + 32,200 = 133,000 (BF-2). Need
    // 120,000 after tax: G − (2,480 + 0.12(G − 57,000)) = 120,000 →
    // 0.88G = 115,640 → G = 131,409.09, under the cap; tax 11,409.09.
    // Roth untouched (BF-4: Traditional only as far as the need).
    const r = grossUp(
      120_000,
      { traditional: 1_000_000, roth: 500_000 },
      { target: 0.12 },
    );
    cents(
      {
        G: r.est.targetWithdrawal,
        tax: r.est.estimatedTax,
        traditional: r.traditional,
        roth: r.roth,
      },
      { G: 131_409.09, tax: 11_409.09, traditional: 131_409.09, roth: 0 },
    );
  });

  it("strategies/C62 [WDR-04] a need over the room: Traditional 133,000, Roth 28,600", () => {
    // Need 150,000: Traditional to the cap, 133,000, tax 11,600, net
    // 121,400; qualified Roth pays the other 28,600 tax-free. G 161,600.
    const r = grossUp(
      150_000,
      { traditional: 1_000_000, roth: 500_000 },
      { target: 0.12 },
    );
    cents(
      {
        G: r.est.targetWithdrawal,
        tax: r.est.estimatedTax,
        traditional: r.traditional,
        roth: r.roth,
      },
      { G: 161_600, tax: 11_600, traditional: 133_000, roth: 28_600 },
    );
  });

  it("strategies/C63 [WDR-04] other ordinary income shrinks the room: 93,000", () => {
    // A 40,000 pension: room = 133,000 − 40,000 = 93,000 (BF-3). Routed
    // 120,000 gross: Traditional 93,000, Roth the other 27,000.
    const { accountBalance } = holdings({
      traditional: 1_000_000,
      roth: 500_000,
    });
    const r = routeForMode(
      120_000,
      bracketConfig(),
      accountBalance,
      bracketInfo({ target: 0.12, otherIncome: 40_000 }),
    );
    const d = drawn(r.slots);
    cents(
      { room: r.traditionalCap!, traditional: d.traditional, roth: d.roth },
      { room: 93_000, traditional: 93_000, roth: 27_000 },
    );
  });

  it("strategies/C64 [WDR-04] no room: Traditional only once Roth, brokerage and HSA are gone", () => {
    // A 140,000 pension is over the 133,000 cap: room 0 (BF-3). Routed
    // 50,000 gross with Roth 30,000, brokerage 10,000 (all basis), HSA
    // 5,000: those 45,000 first, then Traditional the last 5,000 (BF-6,
    // the last resort).
    const { accountBalance } = holdings({
      traditional: 1_000_000,
      roth: 30_000,
      brokerage: 10_000,
      hsa: 5_000,
    });
    const r = routeForMode(
      50_000,
      bracketConfig(),
      accountBalance,
      bracketInfo({ target: 0.12, otherIncome: 140_000, basisRatio: 1 }),
    );
    const d = drawn(r.slots);
    cents(
      {
        room: r.traditionalCap!,
        roth: d.roth,
        brokerage: d.brokerage,
        hsa: d.hsa,
        traditional: d.traditional,
      },
      {
        room: 0,
        roth: 30_000,
        brokerage: 10_000,
        hsa: 5_000,
        traditional: 5_000,
      },
    );
  });

  it("strategies/C65 [WDR-04] the 0% gains room: Traditional 57,000, brokerage 45,480, tax 2,480", () => {
    // Target 10%: cap 24,800 + 32,200 = 57,000, tax 2,480, net 54,520.
    // Need 100,000: 45,480 more from a brokerage that is half gain (pro
    // rata, OPEN-11): gain 22,740. Ordinary taxable 24,800; the 0% top is
    // 98,900, so 74,100 of room: the gain is taxed 0% (BF-9). G 102,480,
    // tax 2,480.
    const r = grossUp(
      100_000,
      { traditional: 1_000_000, brokerage: 200_000, basis: 100_000 },
      { target: 0.1 },
    );
    cents(
      {
        G: r.est.targetWithdrawal,
        tax: r.est.estimatedTax,
        traditional: r.traditional,
        brokerage: r.brokerage,
      },
      { G: 102_480, tax: 2_480, traditional: 57_000, brokerage: 45_480 },
    );
  });

  it("strategies/C66 [WDR-04] no target: bracket filling routes as Waterfall", () => {
    // BF-7: without a `rothBracketTarget` the mode falls back to the
    // household's order. Same 100,000, same money, both modes.
    const { accountBalance } = holdings({
      traditional: 300_000,
      roth: 200_000,
      brokerage: 100_000,
      basis: 60_000,
    });
    const bracket = routeForMode(
      100_000,
      bracketConfig(),
      accountBalance,
      bracketInfo({}),
    );
    const waterfall = routeForMode(
      100_000,
      { ...bracketConfig(), withdrawalRoutingMode: "waterfall" },
      accountBalance,
      bracketInfo({}),
    );
    expect(bracket.slots).toEqual(waterfall.slots);
  });

  it("strategies/C67 [WDR-04] the last resort: Traditional above the target, G 169,666.67", () => {
    // Only Traditional, 1,000,000; need 150,000; target 12%. To the cap:
    // 133,000, tax 11,600, net 121,400; the other 28,600 at 22%:
    // 28,600 ÷ 0.78 = 36,666.67 more (BF-6). G 169,666.67, tax 19,666.67.
    const r = grossUp(150_000, { traditional: 1_000_000 }, { target: 0.12 });
    cents(
      {
        G: r.est.targetWithdrawal,
        tax: r.est.estimatedTax,
        traditional: r.traditional,
      },
      { G: 169_666.67, tax: 19_666.67, traditional: 169_666.67 },
    );
  });

  xfail({
    id: "strategies/G8 [WDR-05]",
    todo: `v0.11 Strategies "RMD Spending re-inflates a typed budget" (ranking by cost per dollar, decision G5)`,
    // MFJ 2026, deduction 32,200, taxable Social Security 60,000; need
    // 300,000 from an HSA of 10,000 and a brokerage of 500,000 with basis
    // 375,000 (25% gain); target 12%. No Traditional, so the room goes
    // unused. Ordinary taxable 60,000 − 32,200 = 27,800: tax 2,480 +
    // 0.12 × 3,000 = 2,840; 0% gains room 98,900 − 27,800 = 71,100.
    // Decision G5 ranks by cost per dollar: a brokerage dollar costs 15%
    // × 25% = 3.75¢ against the HSA's 12¢ (HSA draws are ordinary
    // income), so the brokerage pays all 300,000: gain 75,000, 3,900 over
    // the room at 15% = 585. Tax 2,840 + 585 = 3,425, HSA untouched.
    // Today it ranks by rate (12% < 15%), draws the HSA's 10,000 first:
    // ordinary taxable 37,800 → 4,040; gains (290,000 × 25%) 72,500, room
    // 61,100, 11,400 × 15% = 1,710; tax 5,750 (verdict G8,
    // `withdrawal-cost-ranking.ts:449,457,484`).
    run: () => {
      const h = { hsa: 10_000, brokerage: 500_000, basis: 375_000 };
      const { accountBalance } = holdings(h);
      const r = routeForMode(
        300_000,
        bracketConfig(),
        accountBalance,
        bracketInfo({ target: 0.12, otherIncome: 60_000, basisRatio: 0.75 }),
      );
      const tax = computeTaxFromSlots({
        rothTaxableGrowth: 0,
        penaltyCost: 0,
        slots: r.slots,
        taxableSS: 60_000,
        balances: { afterTax: 500_000, afterTaxBasis: 375_000 },
        brokerageBasisRatio: 0.75,
        taxRates: taxRates(0.12),
        filingStatus: "MFJ",
      }).taxCost;
      return { tax, hsa: drawn(r.slots).hsa };
    },
    expected: { tax: 3_425, hsa: 0 },
    today: { tax: 5_750, hsa: 10_000 },
  });
});

describe("answer key: the gross-up", () => {
  const waterfall = () =>
    makeDecumulationConfig({
      withdrawalOrder: ["ira", "brokerage", "hsa", "401k", "403b"],
    });

  it("strategies/C68 [WDR-06] one bracket: G 63,227.27, tax 3,227.27", () => {
    // All Traditional, net 60,000: 60,000 = G − (2,480 + 0.12(G −
    // 57,000)) → 0.88G = 55,640 → G = 63,227.27; tax 3,227.27 (GU-1).
    const r = grossUp(
      60_000,
      { traditional: 5_000_000 },
      { config: waterfall() },
    );
    cents(
      { G: r.est.targetWithdrawal, tax: r.est.estimatedTax },
      { G: 63_227.27, tax: 3_227.27 },
    );
  });

  it("strategies/C69 [WDR-06] across a bracket: G 169,666.67, tax 19,666.67", () => {
    // Net 150,000: at 133,000 the tax is 11,600 (net 121,400); the other
    // 28,600 at 22%: G = 133,000 + 28,600 ÷ 0.78 = 169,666.67; tax
    // 19,666.67.
    const r = grossUp(
      150_000,
      { traditional: 5_000_000 },
      { config: waterfall() },
    );
    cents(
      { G: r.est.targetWithdrawal, tax: r.est.estimatedTax },
      { G: 169_666.67, tax: 19_666.67 },
    );
  });
});

// ---------------------------------------------------------------------------
// N3: the RMD and bracket filling, through the engine (decision D1, UD-04)
// ---------------------------------------------------------------------------

describe("answer key: RMD dollars and the year's need", () => {
  // MFJ, both born 1949 (77 in 2026), retired; Traditional IRA 5,000,000
  // and Roth IRA 1,000,000 (Ann's); need 150,000; bracket filling at 12%;
  // flat returns, no inflation. Tax at the 2026 MFJ schedule with the
  // 32,200 deduction and no 65+ add-ons (the strategies harness's rates).
  // The RMD: 5,000,000 ÷ 22.9 (Pub 590-B Table III, 77) = 218,340.61; its
  // tax on 186,140.61 taxable = 11,600 + 0.22 × 85,340.61 = 30,374.93;
  // net 187,965.68, which covers the need alone. Decision D1 (UD-04): RMD
  // dollars count toward the need first, other sources cover only what's
  // left, the excess is reinvested — so no Roth. Today routing runs first
  // (Traditional to the 133,000 cap, then Roth 28,600 for the rest of the
  // need) and the RMD tops Traditional up afterwards (verdict N3).
  xfail({
    id: "strategies/N3 [WDR-04]",
    todo: `v0.11 Engine "Build the decided engine behaviors" (decision D1, UD-04)`,
    run: () => {
      const row = runOneYear(
        household(
          [
            acct("Traditional IRA", "ira", 5_000_000, 1, "preTax"),
            acct("Roth IRA", "ira", 1_000_000, 1, "taxFree"),
          ],
          {
            asOfDate: new Date(2026, 0, 1),
            currentAge: 77,
            birthYear: 1949,
            retirementYear: 2026,
            projectionEndYear: 2029,
            annualExpenses: 150_000,
            decumulationAnnualExpenses: 150_000,
            inflationRate: 0,
            returnRates: [{ label: "Age 0", rate: 0 }],
            socialSecurityEntries: [1, 2].map((personId) => ({
              personId,
              personName: personId === 1 ? "Ann" : "Bo",
              birthYear: 1949,
              startAge: 70,
              annualAmount: 0,
            })),
            perPersonBirthYears: [1949, 1949],
          },
          {
            withdrawalRoutingMode: "bracket_filling",
            withdrawalOrder: ["ira", "brokerage", "hsa", "401k", "403b"],
            withdrawalSplits: {
              ira: 1,
              brokerage: 0,
              hsa: 0,
              "401k": 0,
              "403b": 0,
            },
            withdrawalTaxPreference: {
              "401k": "traditional",
              ira: "traditional",
            },
            distributionTaxRates: {
              ...shippedTaxTables(2026),
              traditionalFallbackRate: 0.22,
              roth: 0,
              hsa: 0,
              brokerage: 0.15,
              rothBracketTarget: 0.12,
              taxBrackets: MFJ_2026,
              taxMultiplier: 1,
              standardDeduction: STD_MFJ_2026,
            },
          },
        ),
        2026,
      );
      if (row.phase !== "decumulation") throw new Error("2026 isn't retired");
      return { rmd: row.rmdAmount ?? 0, roth: row.totalRothWithdrawal };
    },
    expected: { rmd: 218_340.61, roth: 0 },
    today: { rmd: 218_340.61, roth: 28_600 },
    tolerance: 1,
  });
});
