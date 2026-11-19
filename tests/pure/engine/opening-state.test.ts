import { describe, expect, it } from "vitest";
import { calculateProjection } from "@/lib/pure/engine";
import { acct, household } from "../fixtures/two-person-household";
import { onePerson } from "../../fixtures/engine-people";
import {
  makeAccumulationDefaults,
  makeContributionSpec,
} from "../fixtures/engine-fixtures";
import {
  declareOpeningParts,
  openingParts,
  openingTotals,
  syntheticOpeningParts,
} from "@/lib/pure/engine/opening-state";
import type { AccountBalances } from "@/lib/pure/accounts/account-balances.types";
import { accountKeyOf } from "@/lib/pure/accounts/account-part";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import { PROJECTED_RETIREMENT_BROKERAGE_LABEL } from "@/lib/config/display-labels";

/** No lump sums or other flows reach a slice the parts don't cover. */
const zeroes = { "401k": 0, "403b": 0, hsa: 0, ira: 0, brokerage: 0 };
const NO_FLOWS = {
  accumulationDefaults: makeAccumulationDefaults({ contributionRate: 0 }),
  employerMatchRateByCategory: zeroes,
  accumulationOverrides: [],
  decumulationOverrides: [],
};

const retirementBrokerage: IndividualAccountInput = {
  name: "Retirement brokerage",
  performanceAccountId: 3,
  category: "brokerage",
  taxType: "afterTax",
  startingBalance: 1000,
  startingBasis: 800,
  parentCategory: "Retirement",
};

const roth401k: IndividualAccountInput = {
  name: "Alice 401(k)",
  performanceAccountId: 7,
  category: "401k",
  taxType: "taxFree",
  startingBalance: 50000,
  ownerName: "Alice",
  ownerPersonId: 1,
  parentCategory: "Retirement",
  rothBasisMeta: {
    year: 2026,
    contributionBasis: 20000,
    conversionBasis: 0,
    latestConversionYear: null,
    isSeeded: false,
    updatedAt: "2026-01-01",
  },
  ruleOf55: null,
};

const keysOf = (parts: IndividualAccountInput[]) =>
  parts.map((p) => accountKeyOf(p));

describe("declareOpeningParts", () => {
  it("a run with no accounts declares nothing", () => {
    expect(declareOpeningParts([], NO_FLOWS)).toEqual([]);
  });

  it("a Roth-only 401(k) gains its owner's Traditional part at $0, with the account's facts and none of the held part's money", () => {
    const parts = declareOpeningParts(
      [retirementBrokerage, roth401k],
      NO_FLOWS,
    );
    expect(parts.slice(0, 2)).toEqual([retirementBrokerage, roth401k]);
    expect(parts).toHaveLength(3);
    const { rothBasisMeta: _basis, ...facts } = roth401k;
    expect(parts[2]).toEqual({
      ...facts,
      taxType: "preTax",
      startingBalance: 0,
      origin: "declared",
    });
  });

  it("a synthetic account's missing tax part is synthetic too", () => {
    const synthetic = { ...roth401k, origin: "synthetic" as const };
    const parts = declareOpeningParts(
      [retirementBrokerage, synthetic],
      NO_FLOWS,
    );
    expect(parts[2]).toMatchObject({ taxType: "preTax", origin: "synthetic" });
  });

  it("an account held in both tax parts declares nothing more", () => {
    const parts = declareOpeningParts(
      [
        retirementBrokerage,
        roth401k,
        { ...roth401k, taxType: "preTax", rothBasisMeta: undefined },
      ],
      NO_FLOWS,
    );
    expect(parts).toHaveLength(3);
    expect(parts.some((p) => p.origin === "declared")).toBe(false);
  });

  it("an IRA held in parts by two owners declares each owner's missing part", () => {
    const ira = (ownerPersonId: number, taxType: string) => ({
      name: "Joint IRA",
      performanceAccountId: 5,
      category: "ira" as const,
      taxType,
      startingBalance: 10000,
      ownerPersonId,
      parentCategory: "Retirement",
    });
    const parts = declareOpeningParts(
      [retirementBrokerage, ira(1, "preTax"), ira(2, "taxFree")],
      NO_FLOWS,
    );
    expect(keysOf(parts.filter((p) => p.origin === "declared"))).toEqual([
      accountKeyOf(ira(1, "taxFree")),
      accountKeyOf(ira(2, "preTax")),
    ]);
  });

  it("accounts with no Roth split declare no other part", () => {
    const hsa: IndividualAccountInput = {
      name: "HSA",
      performanceAccountId: 6,
      category: "hsa",
      taxType: "hsa",
      startingBalance: 5000,
      parentCategory: "Retirement",
    };
    expect(declareOpeningParts([retirementBrokerage, hsa], NO_FLOWS)).toEqual([
      retirementBrokerage,
      hsa,
    ]);
  });

  it("with no Retirement brokerage, the projected one is declared after the held parts", () => {
    const portfolioBrokerage = {
      ...retirementBrokerage,
      parentCategory: "Portfolio",
    };
    const parts = declareOpeningParts([portfolioBrokerage], NO_FLOWS);
    expect(parts).toEqual([
      portfolioBrokerage,
      {
        name: PROJECTED_RETIREMENT_BROKERAGE_LABEL,
        category: "brokerage",
        taxType: "afterTax",
        startingBalance: 0,
        startingBasis: 0,
        parentCategory: "Retirement",
        origin: "projected",
      },
    ]);
  });

  // K19: a lump sum's slice no part takes gets a projected part at the start.
  const lumpSumInto = (
    targetAccount: "ira" | "hsa" | "401k",
    extra: { taxType?: "roth"; targetParentCategory?: "Portfolio" } = {},
  ) => ({
    ...NO_FLOWS,
    decumulationOverrides: [
      { year: 2040, lumpSums: [{ amount: 5000, targetAccount, ...extra }] },
    ],
  });

  it("a lump sum into a kind of account no part holds declares a projected part of its slice, with its other tax part", () => {
    const parts = declareOpeningParts(
      [retirementBrokerage],
      lumpSumInto("ira"),
    );
    const projected = {
      name: "Retirement IRA (projected)",
      category: "ira",
      startingBalance: 0,
      parentCategory: "Retirement",
      origin: "projected",
    };
    expect(parts).toEqual([
      retirementBrokerage,
      { ...projected, taxType: "preTax", startingBasis: 0 },
      { ...projected, taxType: "taxFree" },
    ]);
  });

  it("a lump sum's parent names its projected part, Retirement when unset", () => {
    const parts = declareOpeningParts(
      [retirementBrokerage],
      lumpSumInto("hsa", { targetParentCategory: "Portfolio" }),
    );
    expect(parts.map((p) => p.name)).toEqual([
      "Retirement brokerage",
      "Portfolio HSA (projected)",
    ]);
  });

  it("a lump sum a part or its declared other tax part takes declares nothing more", () => {
    const held = [retirementBrokerage, roth401k];
    expect(
      declareOpeningParts(held, lumpSumInto("401k", { taxType: "roth" })),
    ).toEqual(declareOpeningParts(held, NO_FLOWS));
    expect(declareOpeningParts(held, lumpSumInto("401k"))).toEqual(
      declareOpeningParts(held, NO_FLOWS),
    );
  });

  // A stretch that saves with no contribution specs reaches each
  // category routing fills, as Retirement money.
  const saving = (
    extra: Partial<Parameters<typeof declareOpeningParts>[1]> = {},
    contributionRate = 0.1,
  ) => ({
    ...NO_FLOWS,
    accumulationDefaults: makeAccumulationDefaults({
      contributionRate,
      accountOrder: ["401k", "brokerage"],
      accountSplits: { "401k": 0, "403b": 0, hsa: 0, ira: 0, brokerage: 0 },
    }),
    ...extra,
  });
  const ira = {
    ...retirementBrokerage,
    name: "Ann IRA",
    category: "ira" as const,
    taxType: "preTax",
    startingBasis: undefined,
  };

  it("saving with no specs declares a projected Retirement part, both tax parts, of each category no Retirement part takes", () => {
    const parts = declareOpeningParts([ira], saving());
    expect(parts.map((p) => [p.name, p.taxType, p.origin])).toEqual([
      ["Ann IRA", "preTax", undefined],
      [PROJECTED_RETIREMENT_BROKERAGE_LABEL, "afterTax", "projected"],
      ["Retirement 401k (projected)", "preTax", "projected"],
      ["Ann IRA", "taxFree", "declared"],
      ["Retirement 401k (projected)", "taxFree", "projected"],
    ]);
  });

  it("a Retirement 401(k) part takes the 401(k)'s savings, so none is projected", () => {
    const parts = declareOpeningParts(
      [retirementBrokerage, roth401k],
      saving(),
    );
    expect(parts.some((p) => p.origin === "projected")).toBe(false);
  });

  it("specs throughout, or a stretch that saves nothing, declare none", () => {
    const spec = makeContributionSpec();
    const withSpecs = saving({ contributionSpecs: [spec] });
    expect(declareOpeningParts([ira], withSpecs)).toHaveLength(3);
    expect(declareOpeningParts([ira], saving({}, 0))).toHaveLength(3);
  });

  it("a profile switch to no specs that saves declares them; one that stops saving doesn't", () => {
    const spec = makeContributionSpec();
    const switchTo = (contributionRate: number) =>
      saving({
        contributionSpecs: [spec],
        profileSwitches: [
          {
            year: 2030,
            contributionSpecs: [],
            contributionRate,
            employerMatchRateByCategory: zeroes,
            baseYearContributions: zeroes,
            baseYearEmployerMatch: zeroes,
          },
        ],
      });
    expect(declareOpeningParts([ira], switchTo(0.1))).toHaveLength(5);
    expect(declareOpeningParts([ira], switchTo(0))).toHaveLength(3);
  });

  // An employer match reaches its category's Traditional side in any
  // stretch, specs or not.
  const matching = (
    match: Partial<typeof zeroes>,
    byParent?: [string, number][],
  ) =>
    saving(
      {
        contributionSpecs: [makeContributionSpec()],
        employerMatchRateByCategory: { ...zeroes, ...match },
        ...(byParent
          ? { employerMatchByParentCat: new Map([["401k", new Map(byParent)]]) }
          : {}),
      },
      0,
    );

  it("a match in a category no part holds declares a projected Retirement part there, with specs too", () => {
    const parts = declareOpeningParts([ira], matching({ "401k": 0.04 }));
    expect(
      parts.filter((p) => p.origin === "projected").map((p) => p.taxType),
    ).toEqual(["afterTax", "preTax", "taxFree"]);
    expect(parts.find((p) => p.taxType === "preTax" && p.origin)!.name).toBe(
      "Retirement 401k (projected)",
    );
  });

  it("a match a part of its category takes, of any parent when the match names none, declares none", () => {
    const portfolio401k = { ...roth401k, parentCategory: "Portfolio" };
    const held = [retirementBrokerage, portfolio401k];
    expect(declareOpeningParts(held, matching({ "401k": 0.04 }))).toEqual(
      declareOpeningParts(held, NO_FLOWS),
    );
    const named = declareOpeningParts(
      held,
      matching({ "401k": 0.04 }, [["Retirement", 4000]]),
    );
    expect(
      named.filter((p) => p.origin === "projected").map((p) => p.name),
    ).toEqual(["Retirement 401k (projected)", "Retirement 401k (projected)"]);
  });

  it("an account with no parent is retirement money, so no projected brokerage is added", () => {
    const { parentCategory: _parent, ...noParent } = retirementBrokerage;
    expect(declareOpeningParts([noParent], NO_FLOWS)).toEqual([noParent]);
  });
});

describe("a slot's money with no spec of its tax type", () => {
  // Ann (40, working) holds a Traditional 401(k) and saves through a
  // pre-tax spec only; year 0's paycheck amounts follow her 401(k) split,
  // half Roth.
  const input = household(
    [{ ...acct("Ann 401k", "401k", 100000, 1), parentCategory: "Retirement" }],
    {
      currentAge: 40,
      birthYear: 1986,
      retirementYear: 2050,
      projectionEndYear: 2030,
      currentSalary: 100000,
      accumulationDefaults: makeAccumulationDefaults({
        contributionRate: 0.1,
        accountSplits: { "401k": 1, "403b": 0, hsa: 0, ira: 0, brokerage: 0 },
        taxSplits: { "401k": 0.5, ira: 1 },
      }),
      contributionSpecs: [
        {
          category: "401k",
          name: "Ann 401k",
          accountName: "Ann 401k",
          method: "percent_of_salary",
          value: 10,
          salaryFraction: 1,
          baseAnnual: 10000,
          taxTreatment: "pre_tax",
          allocationPriority: 0,
          personId: 1,
          ownerName: "Ann",
          parentCategory: "Retirement",
        },
      ],
      baseYearContributions: {
        "401k": 10000,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
      baseYearEmployerMatch: {
        "401k": 0,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
      socialSecurityEntries: [],
      perPersonBirthYears: [1986],
      people: onePerson(1986),
    },
  );

  it("lands on the same account's declared part of that tax type", () => {
    const result = calculateProjection(input);
    const year0 = result.projectionByYear[0]!;
    const part = (taxType: string) =>
      year0.individualAccountBalances.find(
        (r) => r.name === "Ann 401k" && r.taxType === taxType,
      );
    // 10 of 12 months of $10,000, split half and half to the cent.
    expect(part("taxFree")?.contribution).toBe(4166.67);
    expect(part("preTax")?.contribution).toBe(4166.66);
    expect(
      result.projectionByYear.flatMap((y) => y.warnings ?? []),
    ).not.toContainEqual(expect.stringContaining("drifted"));
  });
});

describe("parts no real account stands behind", () => {
  const parts = [
    { ...acct("Ann IRA", "ira", 400000, 1), parentCategory: "Retirement" },
    { ...acct("Bo IRA", "ira", 300000, 2), parentCategory: "Retirement" },
  ];
  const run = (synthetic: boolean) =>
    calculateProjection(
      household(
        parts.map((p) =>
          synthetic ? { ...p, origin: "synthetic" as const } : p,
        ),
      ),
    ).projectionByYear;

  it("show no per-account rows", () => {
    expect(run(false)[0]!.individualAccountBalances).not.toEqual([]);
    for (const y of run(true)) expect(y.individualAccountBalances).toEqual([]);
  });
});

describe("a run whose parts are all synthetic", () => {
  const parts = [
    { ...acct("Ann IRA", "ira", 400000, 1), parentCategory: "Retirement" },
    { ...acct("Bo IRA", "ira", 300000, 2), parentCategory: "Retirement" },
  ];
  const firstRetiredYear = (synthetic: boolean) =>
    calculateProjection(
      household(
        parts.map((p) =>
          synthetic ? { ...p, origin: "synthetic" as const } : p,
        ),
      ),
    ).projectionByYear.find((y) => y.phase === "decumulation")!;

  it("takes the household's RMD and eligibility, not each owner's", () => {
    expect(firstRetiredYear(false).rmdByPerson).toBeDefined();
    expect(firstRetiredYear(true).rmdByPerson).toBeUndefined();
    expect(firstRetiredYear(true).rmdDivisor).toBeDefined();
  });
});

describe("the starting money as parts", () => {
  const byCategory: AccountBalances = {
    "401k": { structure: "roth_traditional", traditional: 100000, roth: 50000 },
    "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
    hsa: { structure: "single_bucket", balance: 20000 },
    ira: { structure: "roth_traditional", traditional: 0, roth: 7000 },
    brokerage: { structure: "basis_tracking", balance: 30000, basis: 12000 },
  };

  it("synthetic parts hold each category's money in its tax parts, as Retirement money", () => {
    const parts = syntheticOpeningParts(byCategory);
    const of = (category: string, taxType: string) =>
      parts.find((p) => p.category === category && p.taxType === taxType);
    expect(parts.every((p) => p.origin === "synthetic")).toBe(true);
    expect(parts.every((p) => p.parentCategory === "Retirement")).toBe(true);
    expect(of("401k", "preTax")?.startingBalance).toBe(100000);
    expect(of("401k", "taxFree")?.startingBalance).toBe(50000);
    expect(of("hsa", "hsa")?.startingBalance).toBe(20000);
    expect(of("brokerage", "afterTax")).toMatchObject({
      startingBalance: 30000,
      startingBasis: 12000,
    });
  });

  it("the parts' totals are the money they were built from", () => {
    const { accountBalance, balances } = openingTotals(
      syntheticOpeningParts(byCategory),
    );
    expect(accountBalance).toEqual(byCategory);
    expect(balances).toEqual({
      preTax: 100000,
      taxFree: 57000,
      hsa: 20000,
      afterTax: 30000,
      afterTaxBasis: 12000,
    });
  });

  it("a held Roth part counts as Roth, any other part of a Roth-capable account as Traditional, to the cent", () => {
    const { accountBalance, balances } = openingTotals([
      { ...roth401k, startingBalance: 1000.006 },
      { ...roth401k, taxType: "preTax", startingBalance: 2000 },
    ]);
    expect(accountBalance["401k"]).toEqual({
      structure: "roth_traditional",
      traditional: 2000,
      roth: 1000.01,
    });
    expect(balances.taxFree).toBe(1000.01);
    expect(balances.preTax).toBe(2000);
  });

  it("a part whose tax type is no tax bucket throws, naming the part", () => {
    expect(() => openingTotals([{ ...roth401k, taxType: "roth401k" }])).toThrow(
      /Alice 401\(k\).*"roth401k"/,
    );
  });

  it("the opening parts are the held accounts, or synthetic parts when none is held", () => {
    expect(openingParts([roth401k], byCategory)).toEqual([roth401k]);
    expect(openingParts([], byCategory)).toEqual(
      syntheticOpeningParts(byCategory),
    );
  });
});
