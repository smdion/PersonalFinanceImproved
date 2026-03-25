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
} from "@/lib/calculators/engine/individual-account-tracking";
import type {
  IndividualAccountInput,
  DecumulationSlot,
  AccountCategory,
  ContributionSpec,
  AccumulationSlot,
} from "@/lib/calculators/types";
import {
  makeDecumulationSlot,
  makeIndividualAccount,
  makeAccumulationSlot,
  makeContributionSpec,
} from "./fixtures/engine-fixtures";

describe("makeIndKey", () => {
  it("creates composite key from name, category, and taxType", () => {
    const fn = makeIndKey();
    expect(fn({ name: "My 401k", category: "401k", taxType: "preTax" })).toBe(
      "My 401k::401k::preTax",
    );
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
        name: "Sean 401k",
        method: "percent_of_salary" as const,
        value: 0.14,
        salaryFraction: 1,
        baseAnnual: 16800,
        taxTreatment: "pre_tax",
        ownerName: "Sean",
      },
    ];
    const accounts: IndividualAccountInput[] = [
      makeIndividualAccount({
        name: "Sean 401k",
        category: "401k",
        taxType: "preTax",
        ownerName: "Sean",
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
    expect(specToAccount.get("Sean 401k::pre_tax")).toBe(
      "Sean 401k::401k::preTax",
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
    const result = distributeWithdrawals(slots, accounts, indKey, indBal);
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
    const result = distributeWithdrawals(slots, accounts, indKey, indBal);
    expect(result.get(indKey(accounts[0]!))!).toBe(10000); // trad
    expect(result.get(indKey(accounts[1]!))!).toBe(5000); // roth
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
    const result = distributeWithdrawals(slots, accounts, indKey, indBal);
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
        ownerName: "Sean",
      }),
      makeIndividualAccount({
        name: "Roth 401k",
        category: "401k",
        taxType: "taxFree",
        ownerName: "Sean",
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
        ownerName: "Sean",
      }),
      makeContributionSpec({
        category: "401k",
        name: "Roth 401k",
        method: "percent_of_salary",
        value: 0.06,
        salaryFraction: 1,
        baseAnnual: 7200,
        taxTreatment: "tax_free",
        ownerName: "Sean",
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
      ownerName: "Sean",
      startingBalance: 0,
    });
    const brokB = makeIndividualAccount({
      name: "Brok B",
      category: "brokerage",
      taxType: "afterTax",
      ownerName: "Sean",
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
        ownerName: "Sean",
      }),
      makeContributionSpec({
        category: "brokerage",
        name: "Brok B",
        method: "percent_of_salary",
        value: 0.05,
        salaryFraction: 1,
        baseAnnual: 6000,
        taxTreatment: "after_tax",
        ownerName: "Sean",
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
        ownerName: "Sean",
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
        ownerName: "Sean",
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
