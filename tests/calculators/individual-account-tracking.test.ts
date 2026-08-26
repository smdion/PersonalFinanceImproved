import { describe, it, expect } from "vitest";
import {
  makeIndKey,
  specKeyOf,
  buildSpecToAccountMapping,
  distributeContributions,
  distributeWithdrawals,
  distributeGoalWithdrawal,
  applyIndividualGrowth,
  clampIndividualBalances,
  buildIndividualYearBalances,
  accrueIndividualBasis,
  depleteIndividualBasis,
  clampIndividualBasis,
  reconcileIndividualToAggregate,
} from "@/lib/calculators/engine/individual-account-tracking";
import type {
  IndividualAccountInput,
  DecumulationSlot,
  AccountCategory,
  ContributionSpec,
  AccumulationSlot,
  AccountBalances,
} from "@/lib/calculators/types";
import {
  makeDecumulationSlot,
  makeIndividualAccount,
  makeAccumulationSlot,
  makeContributionSpec,
} from "./fixtures/engine-fixtures";
import type { EligibilityRecord } from "@/lib/pure/withdrawal-eligibility";
import { initRothBasisState } from "@/lib/pure/roth-basis-tracking";
import type { RothBasisState } from "@/lib/pure/roth-basis-tracking";

describe("makeIndKey", () => {
  it("creates composite key from name, category, and taxType", () => {
    const fn = makeIndKey();
    expect(fn({ name: "My 401k", category: "401k", taxType: "preTax" })).toBe(
      "My 401k::401k::preTax::joint",
    );
  });

  it("includes ownerPersonId so two owners' same-named accounts don't collide", () => {
    const fn = makeIndKey();
    const alice = fn({
      name: "401k",
      category: "401k",
      taxType: "preTax",
      ownerPersonId: 1,
    });
    const bob = fn({
      name: "401k",
      category: "401k",
      taxType: "preTax",
      ownerPersonId: 2,
    });
    expect(alice).not.toBe(bob);
    expect(alice).toBe("401k::401k::preTax::1");
    expect(bob).toBe("401k::401k::preTax::2");
  });
});

describe("specKeyOf", () => {
  it("creates key without personId", () => {
    expect(specKeyOf({ name: "Roth IRA", taxTreatment: "tax_free" })).toBe(
      "Roth IRA::tax_free",
    );
  });

  it("creates key with personId", () => {
    expect(
      specKeyOf({ name: "Roth IRA", personId: 3, taxTreatment: "tax_free" }),
    ).toBe("Roth IRA::3::tax_free");
  });

  it("excludes null personId", () => {
    expect(
      specKeyOf({ name: "Roth IRA", personId: null, taxTreatment: "tax_free" }),
    ).toBe("Roth IRA::tax_free");
  });
});

describe("buildSpecToAccountMapping", () => {
  const indKey = makeIndKey();

  it("matches spec to account by exact category + owner + taxType", () => {
    const specs = [
      {
        category: "401k" as AccountCategory,
        name: "Alice 401k",
        method: "percent_of_salary" as const,
        value: 0.14,
        salaryFraction: 1,
        baseAnnual: 16800,
        taxTreatment: "pre_tax",
        ownerName: "Alice",
      },
    ];
    const accounts: IndividualAccountInput[] = [
      makeIndividualAccount({
        name: "Alice 401k",
        category: "401k",
        taxType: "preTax",
        ownerName: "Alice",
      }),
      makeIndividualAccount({
        name: "Other 401k",
        category: "401k",
        taxType: "preTax",
        ownerName: "Alex",
      }),
    ];
    const parentCat = new Map<string, string>();
    const { specToAccount } = buildSpecToAccountMapping(
      specs,
      accounts,
      indKey,
      parentCat,
    );
    expect(specToAccount.get("Alice 401k::pre_tax")).toBe(
      "Alice 401k::401k::preTax::joint",
    );
  });

  it("falls back to unowned account when no exact owner match", () => {
    const specs = [
      {
        category: "ira" as AccountCategory,
        name: "IRA",
        method: "fixed_per_period" as const,
        value: 312.5,
        salaryFraction: 1,
        baseAnnual: 7000,
        taxTreatment: "tax_free",
        ownerName: "Unknown",
      },
    ];
    const accounts: IndividualAccountInput[] = [
      makeIndividualAccount({
        name: "Roth IRA",
        category: "ira",
        taxType: "taxFree",
        // No ownerName or ownerPersonId
      }),
    ];
    const parentCat = new Map<string, string>();
    const { specToAccount } = buildSpecToAccountMapping(
      specs,
      accounts,
      indKey,
      parentCat,
    );
    // Should fall through to tier 4 or 5 (unowned category match)
    expect(specToAccount.size).toBeGreaterThan(0);
  });

  it("returns empty mapping when no accounts match", () => {
    const specs = [
      {
        category: "hsa" as AccountCategory,
        name: "HSA",
        method: "fixed_per_period" as const,
        value: 321,
        salaryFraction: 1,
        baseAnnual: 8346,
        taxTreatment: "hsa",
      },
    ];
    const accounts: IndividualAccountInput[] = [
      makeIndividualAccount({
        name: "401k",
        category: "401k",
        taxType: "preTax",
      }),
    ];
    const parentCat = new Map<string, string>();
    const { specToAccount } = buildSpecToAccountMapping(
      specs,
      accounts,
      indKey,
      parentCat,
    );
    expect(specToAccount.size).toBe(0);
  });
});

describe("distributeWithdrawals", () => {
  const indKey = makeIndKey();

  it("distributes proportionally by balance for single-bucket", () => {
    const accounts: IndividualAccountInput[] = [
      makeIndividualAccount({
        name: "Brokerage A",
        category: "brokerage",
        taxType: "afterTax",
        startingBalance: 60000,
      }),
      makeIndividualAccount({
        name: "Brokerage B",
        category: "brokerage",
        taxType: "afterTax",
        startingBalance: 40000,
      }),
    ];
    const indBal = new Map<string, number>();
    indBal.set(indKey(accounts[0]!), 60000);
    indBal.set(indKey(accounts[1]!), 40000);

    const slots: DecumulationSlot[] = [
      makeDecumulationSlot("brokerage", { withdrawal: 10000 }),
    ];
    const { decIndWithdrawal: result } = distributeWithdrawals(
      slots,
      accounts,
      indKey,
      indBal,
    );
    // 60% to A, 40% to B
    const wdA = result.get(indKey(accounts[0]!)) ?? 0;
    const wdB = result.get(indKey(accounts[1]!)) ?? 0;
    expect(wdA).toBeCloseTo(6000, -1);
    expect(wdB).toBeCloseTo(4000, -1);
    // Balances reduced
    expect(indBal.get(indKey(accounts[0]!))!).toBeCloseTo(54000, -1);
  });

  it("routes traditional and roth to correct tax-type accounts", () => {
    const accounts: IndividualAccountInput[] = [
      makeIndividualAccount({
        name: "Trad 401k",
        category: "401k",
        taxType: "preTax",
        startingBalance: 100000,
      }),
      makeIndividualAccount({
        name: "Roth 401k",
        category: "401k",
        taxType: "taxFree",
        startingBalance: 50000,
      }),
    ];
    const indBal = new Map<string, number>();
    indBal.set(indKey(accounts[0]!), 100000);
    indBal.set(indKey(accounts[1]!), 50000);

    const slots: DecumulationSlot[] = [
      makeDecumulationSlot("401k", {
        withdrawal: 15000,
        traditionalWithdrawal: 10000,
        rothWithdrawal: 5000,
      }),
    ];
    const { decIndWithdrawal: result } = distributeWithdrawals(
      slots,
      accounts,
      indKey,
      indBal,
    );
    expect(result.get(indKey(accounts[0]!))!).toBe(10000); // trad
    expect(result.get(indKey(accounts[1]!))!).toBe(5000); // roth
  });

  it("v0.7.8 Group 2.2 Tier A: prefers the eligible 401k over the locked one within the same category/tax-slot, until eligible money runs out", () => {
    const eligible = makeIndividualAccount({
      name: "Rule of 55 401k",
      category: "401k",
      taxType: "preTax",
      ownerPersonId: 1,
    });
    const locked = makeIndividualAccount({
      name: "Not Yet Eligible 401k",
      category: "401k",
      taxType: "preTax",
      ownerPersonId: 2,
    });
    const indBal = new Map<string, number>();
    indBal.set(indKey(eligible), 20000);
    indBal.set(indKey(locked), 100000);

    const eligibility: EligibilityRecord = {
      byKey: new Map([
        [
          indKey(eligible),
          {
            indKey: indKey(eligible),
            category: "401k",
            taxType: "preTax",
            penaltyFreeAmount: 20000,
            penaltyExposedAmount: 0,
            reason: "Eligible — Rule of 55 met",
          },
        ],
        [
          indKey(locked),
          {
            indKey: indKey(locked),
            category: "401k",
            taxType: "preTax",
            penaltyFreeAmount: 0,
            penaltyExposedAmount: 100000,
            reason: "Locked until Rule of 55 or age 59½",
          },
        ],
      ]),
      totalPenaltyExposed: 100000,
      penaltyExposedTrad: {
        "401k": 100000,
        "403b": 0,
        ira: 0,
        hsa: 0,
        brokerage: 0,
      },
      penaltyExposedRoth: {
        "401k": 0,
        "403b": 0,
        ira: 0,
        hsa: 0,
        brokerage: 0,
      },
      penaltyExposedTotal: {
        "401k": 100000,
        "403b": 0,
        ira: 0,
        hsa: 0,
        brokerage: 0,
      },
    };

    // Withdrawal need ($12k) fits entirely within the eligible account's
    // balance ($20k) — the locked account should supply nothing at all.
    const withinEligible: DecumulationSlot[] = [
      makeDecumulationSlot("401k", {
        withdrawal: 12000,
        traditionalWithdrawal: 12000,
      }),
    ];
    const { decIndWithdrawal: resultWithin } = distributeWithdrawals(
      withinEligible,
      [eligible, locked],
      indKey,
      new Map(indBal),
      eligibility,
    );
    expect(resultWithin.get(indKey(eligible))).toBe(12000);
    expect(resultWithin.get(indKey(locked)) ?? 0).toBe(0);

    // Withdrawal need ($30k) exceeds the eligible account's balance ($20k)
    // — eligible money is drawn first and fully, the remainder ($10k) falls
    // through to the locked account (soft/penalized-but-available model,
    // not a hard block).
    const exceedsEligible: DecumulationSlot[] = [
      makeDecumulationSlot("401k", {
        withdrawal: 30000,
        traditionalWithdrawal: 30000,
      }),
    ];
    const { decIndWithdrawal: resultExceeds } = distributeWithdrawals(
      exceedsEligible,
      [eligible, locked],
      indKey,
      new Map(indBal),
      eligibility,
    );
    expect(resultExceeds.get(indKey(eligible))).toBe(20000);
    expect(resultExceeds.get(indKey(locked))).toBe(10000);
  });

  it("falls through to plain proportional distribution when eligibility.totalPenaltyExposed is 0 (byte-identity no-op)", () => {
    const accounts: IndividualAccountInput[] = [
      makeIndividualAccount({
        name: "A",
        category: "401k",
        taxType: "preTax",
        startingBalance: 60000,
      }),
      makeIndividualAccount({
        name: "B",
        category: "401k",
        taxType: "preTax",
        startingBalance: 40000,
      }),
    ];
    const indBal = new Map<string, number>();
    indBal.set(indKey(accounts[0]!), 60000);
    indBal.set(indKey(accounts[1]!), 40000);
    const eligibility: EligibilityRecord = {
      byKey: new Map(),
      totalPenaltyExposed: 0,
      penaltyExposedTrad: {
        "401k": 0,
        "403b": 0,
        ira: 0,
        hsa: 0,
        brokerage: 0,
      },
      penaltyExposedRoth: {
        "401k": 0,
        "403b": 0,
        ira: 0,
        hsa: 0,
        brokerage: 0,
      },
      penaltyExposedTotal: {
        "401k": 0,
        "403b": 0,
        ira: 0,
        hsa: 0,
        brokerage: 0,
      },
    };
    const slots: DecumulationSlot[] = [
      makeDecumulationSlot("401k", {
        withdrawal: 10000,
        traditionalWithdrawal: 10000,
      }),
    ];
    const { decIndWithdrawal: result } = distributeWithdrawals(
      slots,
      accounts,
      indKey,
      indBal,
      eligibility,
    );
    // Same 60/40 proportional split as the unmodified path.
    expect(result.get(indKey(accounts[0]!))).toBeCloseTo(6000, -1);
    expect(result.get(indKey(accounts[1]!))).toBeCloseTo(4000, -1);
  });

  it("skips slots with zero withdrawal", () => {
    const accounts: IndividualAccountInput[] = [
      makeIndividualAccount({ name: "HSA", category: "hsa", taxType: "hsa" }),
    ];
    const indBal = new Map<string, number>();
    indBal.set(indKey(accounts[0]!), 10000);

    const slots: DecumulationSlot[] = [
      makeDecumulationSlot("hsa", { withdrawal: 0 }),
    ];
    const { decIndWithdrawal: result } = distributeWithdrawals(
      slots,
      accounts,
      indKey,
      indBal,
    );
    expect(result.size).toBe(0);
    expect(indBal.get(indKey(accounts[0]!))!).toBe(10000); // unchanged
  });
});

describe("distributeGoalWithdrawal", () => {
  const indKey = makeIndKey();

  it("distributes proportionally across brokerage accounts", () => {
    const accounts: IndividualAccountInput[] = [
      makeIndividualAccount({
        name: "Brok A",
        category: "brokerage",
        taxType: "afterTax",
      }),
      makeIndividualAccount({
        name: "Brok B",
        category: "brokerage",
        taxType: "afterTax",
      }),
      makeIndividualAccount({
        name: "401k",
        category: "401k",
        taxType: "preTax",
      }),
    ];
    const indBal = new Map<string, number>();
    indBal.set(indKey(accounts[0]!), 30000);
    indBal.set(indKey(accounts[1]!), 70000);
    indBal.set(indKey(accounts[2]!), 200000);

    distributeGoalWithdrawal(10000, accounts, indKey, indBal);
    // Should only touch brokerage accounts (30% and 70%)
    expect(indBal.get(indKey(accounts[0]!))!).toBeCloseTo(27000, -1);
    expect(indBal.get(indKey(accounts[1]!))!).toBeCloseTo(63000, -1);
    // 401k unchanged
    expect(indBal.get(indKey(accounts[2]!))!).toBe(200000);
  });
});

describe("applyIndividualGrowth", () => {
  const indKey = makeIndKey();

  it("applies return rate to each account", () => {
    const accounts: IndividualAccountInput[] = [
      makeIndividualAccount({ name: "A", category: "401k", taxType: "preTax" }),
    ];
    const indBal = new Map<string, number>();
    indBal.set(indKey(accounts[0]!), 100000);

    const growth = applyIndividualGrowth(accounts, indKey, indBal, 0.07);
    expect(growth.get(indKey(accounts[0]!))!).toBeCloseTo(7000, 0);
    expect(indBal.get(indKey(accounts[0]!))!).toBeCloseTo(107000, 0);
  });

  it("clamps negative balances when option is set", () => {
    const accounts: IndividualAccountInput[] = [
      makeIndividualAccount({ name: "A", category: "401k", taxType: "preTax" }),
    ];
    const indBal = new Map<string, number>();
    indBal.set(indKey(accounts[0]!), -500);

    const growth = applyIndividualGrowth(accounts, indKey, indBal, 0.07, true);
    // Negative balance clamped to 0, so growth should be 0
    expect(growth.get(indKey(accounts[0]!))!).toBe(0);
  });

  it("does not clamp by default", () => {
    const accounts: IndividualAccountInput[] = [
      makeIndividualAccount({ name: "A", category: "401k", taxType: "preTax" }),
    ];
    const indBal = new Map<string, number>();
    indBal.set(indKey(accounts[0]!), -500);

    const growth = applyIndividualGrowth(accounts, indKey, indBal, 0.07);
    // Growth on -500 at 7% = -35
    expect(growth.get(indKey(accounts[0]!))!).toBeCloseTo(-35, 0);
  });
});

describe("clampIndividualBalances", () => {
  const indKey = makeIndKey();

  it("clamps negative balances to zero", () => {
    const accounts: IndividualAccountInput[] = [
      makeIndividualAccount({ name: "A", category: "401k", taxType: "preTax" }),
      makeIndividualAccount({ name: "B", category: "ira", taxType: "taxFree" }),
    ];
    const indBal = new Map<string, number>();
    indBal.set(indKey(accounts[0]!), -100);
    indBal.set(indKey(accounts[1]!), 5000);

    clampIndividualBalances(accounts, indKey, indBal);
    expect(indBal.get(indKey(accounts[0]!))!).toBe(0);
    expect(indBal.get(indKey(accounts[1]!))!).toBe(5000);
  });
});

describe("reconcileIndividualToAggregate (v0.7.8 follow-up, DESIGN-DECISION-v0.7.8-indbal-reconciliation.md)", () => {
  const indKey = makeIndKey();

  function baseBalances(
    overrides: Partial<AccountBalances> = {},
  ): AccountBalances {
    return {
      "401k": { structure: "roth_traditional", traditional: 0, roth: 0 },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 0 },
      brokerage: { structure: "basis_tracking", balance: 0, basis: 0 },
      ...overrides,
    };
  }

  it("performs zero writes when every group already matches (byte-identity guard)", () => {
    const accounts = [
      makeIndividualAccount({
        name: "A",
        category: "401k",
        taxType: "preTax",
        ownerPersonId: 1,
      }),
      makeIndividualAccount({
        name: "B",
        category: "401k",
        taxType: "preTax",
        ownerPersonId: 2,
      }),
    ];
    const indBal = new Map<string, number>([
      [indKey(accounts[0]!), 6000],
      [indKey(accounts[1]!), 4000],
    ]);
    const acctBal = baseBalances({
      "401k": { structure: "roth_traditional", traditional: 10000, roth: 0 },
    });
    const diagnostics = reconcileIndividualToAggregate(
      accounts,
      indKey,
      indBal,
      acctBal,
    );
    expect(diagnostics).toEqual([]);
    expect(indBal.get(indKey(accounts[0]!))).toBe(6000);
    expect(indBal.get(indKey(accounts[1]!))).toBe(4000);
  });

  it("closes a seeded ±$0.09 gap exactly — group sum equals target to the cent", () => {
    const accounts = [
      makeIndividualAccount({
        name: "A",
        category: "ira",
        taxType: "preTax",
        ownerPersonId: 1,
      }),
      makeIndividualAccount({
        name: "B",
        category: "ira",
        taxType: "preTax",
        ownerPersonId: 2,
      }),
    ];
    const indBal = new Map<string, number>([
      [indKey(accounts[0]!), 6000],
      [indKey(accounts[1]!), 4000],
    ]);
    // indBal sums to 10000; acctBal says 10000.09 -- a 9-cent gap.
    const acctBal = baseBalances({
      ira: { structure: "roth_traditional", traditional: 10000.09, roth: 0 },
    });
    const diagnostics = reconcileIndividualToAggregate(
      accounts,
      indKey,
      indBal,
      acctBal,
    );
    expect(diagnostics).toEqual([]); // < $1, no diagnostic
    const sum =
      (indBal.get(indKey(accounts[0]!)) ?? 0) +
      (indBal.get(indKey(accounts[1]!)) ?? 0);
    expect(sum).toBeCloseTo(10000.09, 2);
  });

  it("sumInd === 0, target > 0: leaves indBal untouched and returns a diagnostic when the gap is material", () => {
    const accounts = [
      makeIndividualAccount({
        name: "A",
        category: "hsa",
        taxType: "hsa",
        ownerPersonId: 1,
      }),
    ];
    const indBal = new Map<string, number>([[indKey(accounts[0]!), 0]]);
    const acctBal = baseBalances({
      hsa: { structure: "single_bucket", balance: 5000 },
    });
    const diagnostics = reconcileIndividualToAggregate(
      accounts,
      indKey,
      indBal,
      acctBal,
    );
    expect(indBal.get(indKey(accounts[0]!))).toBe(0);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("|delta| > $1 reconciles anyway and returns a diagnostic", () => {
    const accounts = [
      makeIndividualAccount({
        name: "A",
        category: "brokerage",
        taxType: "afterTax",
        ownerPersonId: 1,
      }),
      makeIndividualAccount({
        name: "B",
        category: "brokerage",
        taxType: "afterTax",
        ownerPersonId: 2,
      }),
    ];
    const indBal = new Map<string, number>([
      [indKey(accounts[0]!), 18000],
      [indKey(accounts[1]!), 9000],
    ]);
    // Sums to 27000; acctBal says 30000 -- a real $3000 gap.
    const acctBal = baseBalances({
      brokerage: { structure: "basis_tracking", balance: 30000, basis: 0 },
    });
    const diagnostics = reconcileIndividualToAggregate(
      accounts,
      indKey,
      indBal,
      acctBal,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
    const sum =
      (indBal.get(indKey(accounts[0]!)) ?? 0) +
      (indBal.get(indKey(accounts[1]!)) ?? 0);
    expect(sum).toBeCloseTo(30000, 2);
  });

  it("residual lands on the largest-balance account, independent of indAccts ordering", () => {
    const a = makeIndividualAccount({
      name: "Small",
      category: "401k",
      taxType: "preTax",
      ownerPersonId: 1,
    });
    const b = makeIndividualAccount({
      name: "Large",
      category: "401k",
      taxType: "preTax",
      ownerPersonId: 2,
    });
    const acctBal = baseBalances({
      // Chosen so proportional distribution of the delta leaves a
      // sub-cent rounding residual to place.
      "401k": { structure: "roth_traditional", traditional: 100.01, roth: 0 },
    });

    const indBalForward = new Map<string, number>([
      [indKey(a), 1],
      [indKey(b), 99],
    ]);
    reconcileIndividualToAggregate([a, b], indKey, indBalForward, acctBal);

    const indBalReversed = new Map<string, number>([
      [indKey(a), 1],
      [indKey(b), 99],
    ]);
    reconcileIndividualToAggregate([b, a], indKey, indBalReversed, acctBal);

    // Same result regardless of indAccts iteration order.
    expect(indBalForward.get(indKey(a))).toBeCloseTo(
      indBalReversed.get(indKey(a))!,
      2,
    );
    expect(indBalForward.get(indKey(b))).toBeCloseTo(
      indBalReversed.get(indKey(b))!,
      2,
    );
    // The larger-balance account ("Large", 99) absorbs the residual.
    expect(indBalForward.get(indKey(b))).toBeGreaterThan(
      indBalForward.get(indKey(a))!,
    );
    const sum =
      (indBalForward.get(indKey(a)) ?? 0) + (indBalForward.get(indKey(b)) ?? 0);
    expect(sum).toBeCloseTo(100.01, 2);
  });
});

// ---------------------------------------------------------------------------
// distributeContributions
// ---------------------------------------------------------------------------

describe("distributeContributions", () => {
  const indKey = makeIndKey();

  function makeInput(overrides: Record<string, unknown> = {}) {
    const accounts: IndividualAccountInput[] = [
      makeIndividualAccount({
        name: "Trad 401k",
        category: "401k",
        taxType: "preTax",
        ownerName: "Alice",
      }),
      makeIndividualAccount({
        name: "Roth 401k",
        category: "401k",
        taxType: "taxFree",
        ownerName: "Alice",
      }),
    ];
    const indBal = new Map<string, number>();
    for (const a of accounts) indBal.set(indKey(a), a.startingBalance ?? 0);
    const indParentCat = new Map<string, string>();

    const specs: ContributionSpec[] = [
      makeContributionSpec({
        category: "401k",
        name: "Trad 401k",
        method: "percent_of_salary",
        value: 0.1,
        salaryFraction: 1,
        baseAnnual: 12000,
        taxTreatment: "pre_tax",
        ownerName: "Alice",
      }),
      makeContributionSpec({
        category: "401k",
        name: "Roth 401k",
        method: "percent_of_salary",
        value: 0.06,
        salaryFraction: 1,
        baseAnnual: 7200,
        taxTreatment: "tax_free",
        ownerName: "Alice",
      }),
    ];

    const specToAccount = new Map<string, string>();
    specToAccount.set("Trad 401k::pre_tax", indKey(accounts[0]!));
    specToAccount.set("Roth 401k::tax_free", indKey(accounts[1]!));
    const accountsWithSpecs = new Set(specToAccount.values());

    const slots: AccumulationSlot[] = [
      makeAccumulationSlot("401k", {
        employeeContrib: 19200,
        traditionalContrib: 12000,
        rothContrib: 7200,
        employerMatch: 6000,
      }),
    ];

    return {
      slots,
      contributionSpecs: specs,
      indAccts: accounts,
      indKey,
      indBal,
      indParentCat,
      specToAccount,
      accountsWithSpecs,
      projectedSalary: 120000,
      currentSalary: 120000,
      limitGrowthRate: 0.03,
      yearIndex: 0,
      proRate: 1,
      overflowToBrokerage: 0,
      rampAmount: 0,
      ...overrides,
    };
  }

  it("distributes roth_traditional slot contribs by tax treatment", () => {
    const input = makeInput();
    const result = distributeContributions(input);

    const tradKey = indKey(input.indAccts[0]!);
    const rothKey = indKey(input.indAccts[1]!);

    expect(result.indContribs.get(tradKey)).toBe(12000);
    expect(result.indContribs.get(rothKey)).toBe(7200);
  });

  it("mutates indBal with contributions", () => {
    const input = makeInput();
    const tradKey = indKey(input.indAccts[0]!);
    const startBal = input.indBal.get(tradKey) ?? 0;

    distributeContributions(input);

    expect(input.indBal.get(tradKey)!).toBeGreaterThan(startBal);
  });

  it("distributes employer match to preTax accounts", () => {
    const input = makeInput();
    const result = distributeContributions(input);

    const tradKey = indKey(input.indAccts[0]!);
    // Employer match of 6000 should go to preTax account
    expect(result.indMatch.get(tradKey)).toBe(6000);
  });

  it("distributes single-bucket category contribs by spec weight", () => {
    const brokA = makeIndividualAccount({
      name: "Brok A",
      category: "brokerage",
      taxType: "afterTax",
      ownerName: "Alice",
      startingBalance: 0,
    });
    const brokB = makeIndividualAccount({
      name: "Brok B",
      category: "brokerage",
      taxType: "afterTax",
      ownerName: "Alice",
      startingBalance: 0,
    });
    const accounts = [brokA, brokB];
    const indBal = new Map<string, number>();
    for (const a of accounts) indBal.set(indKey(a), 0);

    const specs: ContributionSpec[] = [
      makeContributionSpec({
        category: "brokerage",
        name: "Brok A",
        method: "percent_of_salary",
        value: 0.1,
        salaryFraction: 1,
        baseAnnual: 12000,
        taxTreatment: "after_tax",
        ownerName: "Alice",
      }),
      makeContributionSpec({
        category: "brokerage",
        name: "Brok B",
        method: "percent_of_salary",
        value: 0.05,
        salaryFraction: 1,
        baseAnnual: 6000,
        taxTreatment: "after_tax",
        ownerName: "Alice",
      }),
    ];

    const specToAccount = new Map<string, string>();
    specToAccount.set("Brok A::after_tax", indKey(brokA));
    specToAccount.set("Brok B::after_tax", indKey(brokB));

    const slots: AccumulationSlot[] = [
      makeAccumulationSlot("brokerage", {
        employeeContrib: 18000,
        irsLimit: Infinity,
        effectiveLimit: Infinity,
      }),
    ];

    const result = distributeContributions({
      slots,
      contributionSpecs: specs,
      indAccts: accounts,
      indKey,
      indBal,
      indParentCat: new Map(),
      specToAccount,
      accountsWithSpecs: new Set(specToAccount.values()),
      projectedSalary: 120000,
      currentSalary: 120000,
      limitGrowthRate: 0.03,
      yearIndex: 0,
      proRate: 1,
      overflowToBrokerage: 0,
      rampAmount: 0,
    });

    // 2:1 ratio (12000:6000) → 12000 to A, 6000 to B
    expect(result.indContribs.get(indKey(brokA))).toBe(12000);
    expect(result.indContribs.get(indKey(brokB))).toBe(6000);
  });

  it("distributes overflow to brokerage accounts respecting targetAnnual", () => {
    const brokA = makeIndividualAccount({
      name: "Brok A",
      category: "brokerage",
      taxType: "afterTax",
      startingBalance: 0,
    });
    const accounts = [brokA];
    const indBal = new Map<string, number>();
    indBal.set(indKey(brokA), 0);

    const specs: ContributionSpec[] = [
      makeContributionSpec({
        category: "brokerage",
        name: "Brok A",
        method: "fixed_per_period",
        value: 500,
        salaryFraction: 1,
        baseAnnual: 6000,
        taxTreatment: "after_tax",
        targetAnnual: 10000,
        allocationPriority: 0,
      }),
    ];

    const specToAccount = new Map<string, string>();
    specToAccount.set("Brok A::after_tax", indKey(brokA));

    const result = distributeContributions({
      slots: [],
      contributionSpecs: specs,
      indAccts: accounts,
      indKey,
      indBal,
      indParentCat: new Map(),
      specToAccount,
      accountsWithSpecs: new Set(specToAccount.values()),
      projectedSalary: 120000,
      currentSalary: 120000,
      limitGrowthRate: 0.03,
      yearIndex: 0,
      proRate: 1,
      overflowToBrokerage: 5000,
      rampAmount: 0,
    });

    // Overflow of 5000 should go to brokA (room = targetAnnual 10000 - 0 current = 10000, so 5000 fits)
    expect(result.indOverflow.get(indKey(brokA))).toBe(5000);
  });

  it("distributes ramp to brokerage accounts", () => {
    const brokA = makeIndividualAccount({
      name: "Brok A",
      category: "brokerage",
      taxType: "afterTax",
      startingBalance: 50000,
    });
    const accounts = [brokA];
    const indBal = new Map<string, number>();
    indBal.set(indKey(brokA), 50000);

    const specs: ContributionSpec[] = [
      makeContributionSpec({
        category: "brokerage",
        name: "Brok A",
        taxTreatment: "after_tax",
        baseAnnual: 6000,
      }),
    ];

    const specToAccount = new Map<string, string>();
    specToAccount.set("Brok A::after_tax", indKey(brokA));

    const result = distributeContributions({
      slots: [],
      contributionSpecs: specs,
      indAccts: accounts,
      indKey,
      indBal,
      indParentCat: new Map(),
      specToAccount,
      accountsWithSpecs: new Set(specToAccount.values()),
      projectedSalary: 120000,
      currentSalary: 120000,
      limitGrowthRate: 0.03,
      yearIndex: 1,
      proRate: 1,
      overflowToBrokerage: 0,
      rampAmount: 3000,
    });

    expect(result.indRamp.get(indKey(brokA))).toBe(3000);
  });

  it("tracks intentional contributions for brokerage specs", () => {
    const brokA = makeIndividualAccount({
      name: "Brok A",
      category: "brokerage",
      taxType: "afterTax",
      startingBalance: 0,
    });
    const accounts = [brokA];
    const indBal = new Map<string, number>();
    indBal.set(indKey(brokA), 0);

    const specs: ContributionSpec[] = [
      makeContributionSpec({
        category: "brokerage",
        name: "Brok A",
        method: "percent_of_salary",
        value: 0.05,
        salaryFraction: 1,
        baseAnnual: 6000,
        taxTreatment: "after_tax",
      }),
    ];

    const specToAccount = new Map<string, string>();
    specToAccount.set("Brok A::after_tax", indKey(brokA));

    const result = distributeContributions({
      slots: [],
      contributionSpecs: specs,
      indAccts: accounts,
      indKey,
      indBal,
      indParentCat: new Map(),
      specToAccount,
      accountsWithSpecs: new Set(specToAccount.values()),
      projectedSalary: 120000,
      currentSalary: 120000,
      limitGrowthRate: 0.03,
      yearIndex: 0,
      proRate: 1,
      overflowToBrokerage: 0,
      rampAmount: 0,
    });

    // Intentional = projectedSalary * salaryFraction * value * proRate = 120000 * 1 * 0.05 * 1 = 6000
    expect(result.indIntentional.get(indKey(brokA))).toBe(6000);
  });

  // Pinned-value tests below, ahead of a planned consolidation of this
  // formula with the identical one duplicated in contribution-routing.ts
  // (audit Batch 2 Finding 5). These cover the 3 branches/inputs not
  // exercised above — proRate scaling, contributionScaling "fixed_amount",
  // and fixedContribScalesWithSalary — so the refactor can be verified to
  // produce byte-identical results for both Step 1 (specRaw) and Step 5
  // (indIntentional).

  it("percent_of_salary scales by proRate (Step 1 + Step 5)", () => {
    const brokA = makeIndividualAccount({
      name: "Brok A",
      category: "brokerage",
      taxType: "afterTax",
      startingBalance: 0,
    });
    const indBal = new Map<string, number>();
    indBal.set(indKey(brokA), 0);

    const specs: ContributionSpec[] = [
      makeContributionSpec({
        category: "brokerage",
        name: "Brok A",
        method: "percent_of_salary",
        value: 0.05,
        salaryFraction: 1,
        baseAnnual: 6000,
        taxTreatment: "after_tax",
      }),
    ];
    const specToAccount = new Map<string, string>();
    specToAccount.set("Brok A::after_tax", indKey(brokA));

    const result = distributeContributions({
      slots: [],
      contributionSpecs: specs,
      indAccts: [brokA],
      indKey,
      indBal,
      indParentCat: new Map(),
      specToAccount,
      accountsWithSpecs: new Set(specToAccount.values()),
      projectedSalary: 120000,
      currentSalary: 120000,
      limitGrowthRate: 0.03,
      yearIndex: 0,
      proRate: 0.5,
      overflowToBrokerage: 0,
      rampAmount: 0,
    });

    // 120000 * 1 * 0.05 * 0.5 = 3000
    expect(result.indIntentional.get(indKey(brokA))).toBe(3000);
  });

  it("contributionScaling fixed_amount: baseAnnual × limitGrowthFactor × proRate, salary-independent (Step 5)", () => {
    // Step 5 (indIntentional) only tracks isOverflowTarget categories, i.e.
    // brokerage — use contributionScaling: "fixed_amount" there to isolate
    // that branch (it's checked before the salary-scaling branch).
    const brokA = makeIndividualAccount({
      name: "Brok A",
      category: "brokerage",
      taxType: "afterTax",
      startingBalance: 0,
    });
    const indBal = new Map<string, number>();
    indBal.set(indKey(brokA), 0);

    const specs: ContributionSpec[] = [
      makeContributionSpec({
        category: "brokerage",
        name: "Brok A",
        method: "fixed_monthly",
        contributionScaling: "fixed_amount",
        baseAnnual: 4000,
        taxTreatment: "after_tax",
      }),
    ];
    const specToAccount = new Map<string, string>();
    specToAccount.set("Brok A::after_tax", indKey(brokA));

    const result = distributeContributions({
      slots: [],
      contributionSpecs: specs,
      indAccts: [brokA],
      indKey,
      indBal,
      indParentCat: new Map(),
      specToAccount,
      accountsWithSpecs: new Set(specToAccount.values()),
      // Deliberately mismatched from currentSalary to prove this branch
      // ignores salary entirely.
      projectedSalary: 250000,
      currentSalary: 120000,
      limitGrowthRate: 0.03,
      yearIndex: 1,
      proRate: 0.5,
      overflowToBrokerage: 0,
      rampAmount: 0,
    });

    // 4000 * 1.03 * 0.5 = 2060
    expect(result.indIntentional.get(indKey(brokA))).toBe(2060);
  });

  it("fixedContribScalesWithSalary category: baseAnnual × (projectedSalary/currentSalary) × proRate", () => {
    const brokA = makeIndividualAccount({
      name: "Brok A",
      category: "brokerage",
      taxType: "afterTax",
      startingBalance: 0,
    });
    const indBal = new Map<string, number>();
    indBal.set(indKey(brokA), 0);

    const specs: ContributionSpec[] = [
      makeContributionSpec({
        category: "brokerage",
        name: "Brok A",
        method: "fixed_monthly",
        baseAnnual: 10000,
        taxTreatment: "after_tax",
      }),
    ];
    const specToAccount = new Map<string, string>();
    specToAccount.set("Brok A::after_tax", indKey(brokA));

    const result = distributeContributions({
      slots: [],
      contributionSpecs: specs,
      indAccts: [brokA],
      indKey,
      indBal,
      indParentCat: new Map(),
      specToAccount,
      accountsWithSpecs: new Set(specToAccount.values()),
      projectedSalary: 130000,
      currentSalary: 120000,
      limitGrowthRate: 0.03,
      yearIndex: 0,
      proRate: 0.5,
      overflowToBrokerage: 0,
      rampAmount: 0,
    });

    // 10000 * (130000/120000) * 0.5 = 5416.67
    expect(result.indIntentional.get(indKey(brokA))).toBe(5416.67);
  });

  it("returns empty maps when no specs or slots", () => {
    const result = distributeContributions({
      slots: [],
      contributionSpecs: [],
      indAccts: [],
      indKey,
      indBal: new Map(),
      indParentCat: new Map(),
      specToAccount: new Map(),
      accountsWithSpecs: new Set(),
      projectedSalary: 120000,
      currentSalary: 120000,
      limitGrowthRate: 0.03,
      yearIndex: 0,
      proRate: 1,
      overflowToBrokerage: 0,
      rampAmount: 0,
    });

    expect(result.indContribs.size).toBe(0);
    expect(result.indMatch.size).toBe(0);
    expect(result.indOverflow.size).toBe(0);
    expect(result.indRamp.size).toBe(0);
    expect(result.indIntentional.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildIndividualYearBalances
// ---------------------------------------------------------------------------

describe("buildIndividualYearBalances", () => {
  const indKey = makeIndKey();

  it("builds accumulation records with contribution breakdown", () => {
    const accounts: IndividualAccountInput[] = [
      makeIndividualAccount({
        name: "401k",
        category: "401k",
        taxType: "preTax",
        ownerName: "Alice",
      }),
    ];
    const k = indKey(accounts[0]!);
    const indBal = new Map([[k, 112000]]);
    const indParentCat = new Map([[k, "Retirement"]]);

    const result = buildIndividualYearBalances(
      accounts,
      indKey,
      indBal,
      indParentCat,
      "accumulation",
      {
        contribs: new Map([[k, 5000]]),
        match: new Map([[k, 2500]]),
        growth: new Map([[k, 4500]]),
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("401k");
    expect(result[0]!.balance).toBe(112000);
    expect(result[0]!.contribution).toBe(5000);
    expect(result[0]!.employerMatch).toBe(2500);
    expect(result[0]!.growth).toBe(4500);
    expect(result[0]!.parentCategory).toBe("Retirement");
  });

  it("includes overflow/intentional/ramp for brokerage accounts", () => {
    const accounts: IndividualAccountInput[] = [
      makeIndividualAccount({
        name: "Brokerage",
        category: "brokerage",
        taxType: "afterTax",
      }),
    ];
    const k = indKey(accounts[0]!);
    const indBal = new Map([[k, 50000]]);

    const result = buildIndividualYearBalances(
      accounts,
      indKey,
      indBal,
      new Map(),
      "accumulation",
      {
        contribs: new Map([[k, 8000]]),
        intentional: new Map([[k, 5000]]),
        overflow: new Map([[k, 2000]]),
        ramp: new Map([[k, 1000]]),
        growth: new Map([[k, 3000]]),
      },
    );

    expect(result[0]!.intentionalContribution).toBe(5000);
    expect(result[0]!.overflowContribution).toBe(2000);
    expect(result[0]!.rampContribution).toBe(1000);
  });

  it("does NOT include overflow fields for non-brokerage accounts", () => {
    const accounts: IndividualAccountInput[] = [
      makeIndividualAccount({
        name: "401k",
        category: "401k",
        taxType: "preTax",
      }),
    ];
    const k = indKey(accounts[0]!);
    const indBal = new Map([[k, 100000]]);

    const result = buildIndividualYearBalances(
      accounts,
      indKey,
      indBal,
      new Map(),
      "accumulation",
      { contribs: new Map([[k, 5000]]) },
    );

    expect(result[0]!).not.toHaveProperty("intentionalContribution");
    expect(result[0]!).not.toHaveProperty("overflowContribution");
    expect(result[0]!).not.toHaveProperty("rampContribution");
  });

  it("builds decumulation records with withdrawal", () => {
    const accounts: IndividualAccountInput[] = [
      makeIndividualAccount({
        name: "IRA",
        category: "ira",
        taxType: "preTax",
        ownerName: "Alice",
      }),
    ];
    const k = indKey(accounts[0]!);
    const indBal = new Map([[k, 85000]]);

    const result = buildIndividualYearBalances(
      accounts,
      indKey,
      indBal,
      new Map(),
      "decumulation",
      {
        growth: new Map([[k, 5000]]),
        withdrawal: new Map([[k, 20000]]),
      },
    );

    expect(result[0]!.contribution).toBe(0);
    expect(result[0]!.employerMatch).toBe(0);
    expect(result[0]!.growth).toBe(5000);
    expect(result[0]!.withdrawal).toBe(20000);
    expect(result[0]!.balance).toBe(85000);
  });

  it("passes eligibilityLocked/eligibilityReason through from the eligibility record (v0.7.8 follow-up)", () => {
    const accounts: IndividualAccountInput[] = [
      makeIndividualAccount({
        name: "Locked 401k",
        category: "401k",
        taxType: "preTax",
      }),
      makeIndividualAccount({
        name: "No Eligibility Data",
        category: "brokerage",
        taxType: "afterTax",
      }),
    ];
    const kLocked = indKey(accounts[0]!);
    const kNoData = indKey(accounts[1]!);
    const indBal = new Map([
      [kLocked, 50000],
      [kNoData, 10000],
    ]);
    const eligibility: EligibilityRecord = {
      byKey: new Map([
        [
          kLocked,
          {
            indKey: kLocked,
            category: "401k",
            taxType: "preTax",
            penaltyFreeAmount: 0,
            penaltyExposedAmount: 50000,
            reason: "Locked until Rule of 55 or age 59½ (currently 40)",
          },
        ],
      ]),
      totalPenaltyExposed: 50000,
      penaltyExposedTrad: {
        "401k": 50000,
        "403b": 0,
        ira: 0,
        hsa: 0,
        brokerage: 0,
      },
      penaltyExposedRoth: {
        "401k": 0,
        "403b": 0,
        ira: 0,
        hsa: 0,
        brokerage: 0,
      },
      penaltyExposedTotal: {
        "401k": 50000,
        "403b": 0,
        ira: 0,
        hsa: 0,
        brokerage: 0,
      },
    };

    const result = buildIndividualYearBalances(
      accounts,
      indKey,
      indBal,
      new Map(),
      "decumulation",
      {},
      eligibility,
    );

    const locked = result.find((r) => r.name === "Locked 401k")!;
    expect(locked.eligibilityLocked).toBe(true);
    expect(locked.eligibilityReason).toBe(
      "Locked until Rule of 55 or age 59½ (currently 40)",
    );

    // No entry in eligibility.byKey for this account (e.g. eligibility
    // wasn't computed this year, or the account has no owner) — fields
    // stay absent rather than defaulting to a misleading "not locked".
    const noData = result.find((r) => r.name === "No Eligibility Data")!;
    expect(noData.eligibilityLocked).toBeUndefined();
    expect(noData.eligibilityReason).toBeUndefined();
  });

  it("zeroes balance below $1 threshold", () => {
    const accounts: IndividualAccountInput[] = [
      makeIndividualAccount({ name: "A", category: "401k", taxType: "preTax" }),
    ];
    const k = indKey(accounts[0]!);
    const indBal = new Map([[k, 0.45]]); // less than $1

    const result = buildIndividualYearBalances(
      accounts,
      indKey,
      indBal,
      new Map(),
      "accumulation",
      {},
    );

    expect(result[0]!.balance).toBe(0);
  });

  it("handles multiple accounts", () => {
    const accounts: IndividualAccountInput[] = [
      makeIndividualAccount({ name: "A", category: "401k", taxType: "preTax" }),
      makeIndividualAccount({ name: "B", category: "ira", taxType: "taxFree" }),
      makeIndividualAccount({
        name: "C",
        category: "brokerage",
        taxType: "afterTax",
      }),
    ];
    const indBal = new Map<string, number>();
    for (const a of accounts) indBal.set(indKey(a), 10000);

    const result = buildIndividualYearBalances(
      accounts,
      indKey,
      indBal,
      new Map(),
      "accumulation",
      {},
    );

    expect(result).toHaveLength(3);
    expect(result.every((r) => r.balance === 10000)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tracked Roth basis (v0.7.8 follow-up)
// ---------------------------------------------------------------------------

describe("accrueIndividualBasis", () => {
  const indKey = makeIndKey();

  it("grows an account's tracked basis by its contribution this year", () => {
    const roth = makeIndividualAccount({
      name: "Roth 401k",
      category: "401k",
      taxType: "taxFree",
    });
    const k = indKey(roth);
    const indBasis = new Map<string, RothBasisState>([
      [k, initRothBasisState(null, 2026)],
    ]);
    accrueIndividualBasis([roth], indKey, indBasis, new Map([[k, 8000]]));
    expect(indBasis.get(k)!.contributionBasis).toBe(8000);
  });

  it("is a no-op for an account with no indBasis entry (non-Roth account)", () => {
    const trad = makeIndividualAccount({
      name: "Trad 401k",
      category: "401k",
      taxType: "preTax",
    });
    const k = indKey(trad);
    const indBasis = new Map<string, RothBasisState>(); // no entry
    accrueIndividualBasis([trad], indKey, indBasis, new Map([[k, 8000]]));
    expect(indBasis.has(k)).toBe(false);
  });
});

describe("depleteIndividualBasis", () => {
  const indKey = makeIndKey();

  it("decrements tracked basis by the basis portion of this year's withdrawal (basis_first / IRA)", () => {
    const ira = makeIndividualAccount({
      name: "Roth IRA",
      category: "ira",
      taxType: "taxFree",
    });
    const k = indKey(ira);
    const indBasis = new Map<string, RothBasisState>([
      [
        k,
        {
          contributionBasis: 10000,
          conversionBasis: 0,
          latestConversionYear: null,
          sourceYear: 2020,
          isSeeded: false,
          stale: false,
        },
      ],
    ]);
    const draws = depleteIndividualBasis({
      indAccts: [ira],
      indKey,
      indBasis,
      preWithdrawalBal: new Map([[k, 50000]]),
      withdrawals: new Map([[k, 6000]]),
    });
    expect(indBasis.get(k)!.contributionBasis).toBe(4000);
    expect(draws.get(k)!.contributionDrawn).toBe(6000);
    // Conservation: basis + conversion + growth drawn equals the withdrawal.
    const d = draws.get(k)!;
    expect(d.contributionDrawn + d.conversionDrawn + d.growthDrawn).toBe(6000);
  });

  it("depletes proportionally for pro_rata (401k Roth sub-election)", () => {
    const roth401k = makeIndividualAccount({
      name: "Roth 401k",
      category: "401k",
      taxType: "taxFree",
    });
    const k = indKey(roth401k);
    const indBasis = new Map<string, RothBasisState>([
      [
        k,
        {
          contributionBasis: 20000,
          conversionBasis: 0,
          latestConversionYear: null,
          sourceYear: 2020,
          isSeeded: false,
          stale: false,
        },
      ],
    ]);
    // 20k basis / 100k balance = 20% basis ratio.
    const draws = depleteIndividualBasis({
      indAccts: [roth401k],
      indKey,
      indBasis,
      preWithdrawalBal: new Map([[k, 100000]]),
      withdrawals: new Map([[k, 10000]]),
    });
    expect(draws.get(k)!.contributionDrawn).toBeCloseTo(2000, 0);
    expect(indBasis.get(k)!.contributionBasis).toBeCloseTo(18000, 0);
  });

  it("skips accounts with no withdrawal this year (no-op, no draw entry)", () => {
    const ira = makeIndividualAccount({
      name: "Roth IRA",
      category: "ira",
      taxType: "taxFree",
    });
    const k = indKey(ira);
    const indBasis = new Map<string, RothBasisState>([
      [k, initRothBasisState(null, 2026)],
    ]);
    const draws = depleteIndividualBasis({
      indAccts: [ira],
      indKey,
      indBasis,
      preWithdrawalBal: new Map([[k, 50000]]),
      withdrawals: new Map(), // no withdrawal entry at all
    });
    expect(draws.has(k)).toBe(false);
  });

  it("conservation invariant holds across multiple mixed accounts", () => {
    const iraRoth = makeIndividualAccount({
      name: "Roth IRA",
      category: "ira",
      taxType: "taxFree",
    });
    const k401kRoth = makeIndividualAccount({
      name: "Roth 401k",
      category: "401k",
      taxType: "taxFree",
    });
    const kIra = indKey(iraRoth);
    const k401k = indKey(k401kRoth);
    const indBasis = new Map<string, RothBasisState>([
      [
        kIra,
        {
          contributionBasis: 5000,
          conversionBasis: 2000,
          latestConversionYear: 2021,
          sourceYear: 2020,
          isSeeded: false,
          stale: false,
        },
      ],
      [
        k401k,
        {
          contributionBasis: 15000,
          conversionBasis: 0,
          latestConversionYear: null,
          sourceYear: 2020,
          isSeeded: false,
          stale: false,
        },
      ],
    ]);
    const withdrawals = new Map([
      [kIra, 4000],
      [k401k, 30000],
    ]);
    const draws = depleteIndividualBasis({
      indAccts: [iraRoth, k401kRoth],
      indKey,
      indBasis,
      preWithdrawalBal: new Map([
        [kIra, 20000],
        [k401k, 60000],
      ]),
      withdrawals,
    });
    for (const [key, wd] of withdrawals) {
      const d = draws.get(key)!;
      expect(
        d.contributionDrawn + d.conversionDrawn + d.growthDrawn,
      ).toBeCloseTo(wd, 0);
    }
  });
});

describe("clampIndividualBasis", () => {
  const indKey = makeIndKey();

  it("clamps tracked basis down when the balance has shrunk below it", () => {
    const ira = makeIndividualAccount({
      name: "Roth IRA",
      category: "ira",
      taxType: "taxFree",
    });
    const k = indKey(ira);
    const indBasis = new Map<string, RothBasisState>([
      [
        k,
        {
          contributionBasis: 10000,
          conversionBasis: 5000,
          latestConversionYear: 2020,
          sourceYear: 2020,
          isSeeded: false,
          stale: false,
        },
      ],
    ]);
    clampIndividualBasis([ira], indKey, indBasis, new Map([[k, 8000]]));
    expect(
      indBasis.get(k)!.contributionBasis + indBasis.get(k)!.conversionBasis,
    ).toBeLessThanOrEqual(8000);
  });

  it("zeroes basis for a dust-cleaned ($0) account", () => {
    const ira = makeIndividualAccount({
      name: "Roth IRA",
      category: "ira",
      taxType: "taxFree",
    });
    const k = indKey(ira);
    const indBasis = new Map<string, RothBasisState>([
      [
        k,
        {
          contributionBasis: 500,
          conversionBasis: 0,
          latestConversionYear: null,
          sourceYear: 2020,
          isSeeded: false,
          stale: false,
        },
      ],
    ]);
    clampIndividualBasis([ira], indKey, indBasis, new Map([[k, 0]]));
    expect(indBasis.get(k)!.contributionBasis).toBe(0);
  });
});

describe("buildIndividualYearBalances — tracked basis fields", () => {
  const indKey = makeIndKey();

  it("populates rothBasisRemaining/rothBasisDrawn/rothBasisUncertain when basis/draws maps are supplied", () => {
    const roth = makeIndividualAccount({
      name: "Roth IRA",
      category: "ira",
      taxType: "taxFree",
    });
    const k = indKey(roth);
    const indBal = new Map([[k, 20000]]);
    const indBasis = new Map<string, RothBasisState>([
      [
        k,
        {
          contributionBasis: 6000,
          conversionBasis: 0,
          latestConversionYear: null,
          sourceYear: 2019,
          isSeeded: true,
          stale: true,
        },
      ],
    ]);
    const draws = new Map([
      [k, { contributionDrawn: 1000, conversionDrawn: 0, growthDrawn: 500 }],
    ]);

    const result = buildIndividualYearBalances(
      [roth],
      indKey,
      indBal,
      new Map(),
      "decumulation",
      { withdrawal: new Map([[k, 1500]]), basis: indBasis, draws },
    );
    expect(result[0]!.rothBasisRemaining).toBe(6000);
    expect(result[0]!.rothBasisDrawn).toBe(1000);
    expect(result[0]!.rothBasisUncertain).toBe(true);
  });

  it("leaves basis fields absent when no basis map is supplied (byte-identity for non-Roth callers)", () => {
    const trad = makeIndividualAccount({
      name: "Trad 401k",
      category: "401k",
      taxType: "preTax",
    });
    const k = indKey(trad);
    const result = buildIndividualYearBalances(
      [trad],
      indKey,
      new Map([[k, 20000]]),
      new Map(),
      "decumulation",
      { withdrawal: new Map([[k, 1500]]) },
    );
    expect(result[0]!.rothBasisRemaining).toBeUndefined();
    expect(result[0]!.rothBasisDrawn).toBeUndefined();
    expect(result[0]!.rothBasisUncertain).toBeUndefined();
  });
});
