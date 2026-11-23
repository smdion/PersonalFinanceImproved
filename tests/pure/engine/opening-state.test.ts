import { describe, expect, it } from "vitest";
import { calculateProjection } from "@/lib/pure/engine";
import { acct, household } from "../fixtures/two-person-household";
import { onePerson } from "../../fixtures/engine-people";
import {
  makeAccumulationDefaults,
  makeContributionSpec,
  paysInto,
} from "../fixtures/engine-fixtures";
import { withAccountId } from "../fixtures/engine-input";
import {
  declareOpeningParts,
  openingParts,
  openingTotals,
  syntheticOpeningParts,
} from "@/lib/pure/engine/opening-state";
import type { AccountBalances } from "@/lib/pure/accounts/account-balances.types";
import { accountIdKeyOf } from "@/lib/pure/accounts/account-part";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import { PROJECTED_RETIREMENT_BROKERAGE_LABEL } from "@/lib/config/display-labels";
import { buildCategoryRecord, zeroBalance } from "@/lib/config/account-types";

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
  parts.map((p) => accountIdKeyOf(p));

describe("declareOpeningParts", () => {
  it("a run with no accounts declares nothing", () => {
    expect(declareOpeningParts([], NO_FLOWS)).toEqual([]);
  });

  it("refuses two parts with one key, which would share one balance", () => {
    const sameAccount = {
      ...retirementBrokerage,
      name: "Retirement brokerage (ESPP)",
      startingBalance: 500,
    };
    expect(() =>
      declareOpeningParts([retirementBrokerage, sameAccount], NO_FLOWS),
    ).toThrow(/Two account parts have one key/);
  });

  it("takes one account's parts of two owners or two tax types apart", () => {
    expect(() =>
      declareOpeningParts(
        [
          retirementBrokerage,
          roth401k,
          { ...roth401k, ownerPersonId: 2 },
          { ...roth401k, taxType: "preTax", rothBasisMeta: undefined },
        ],
        NO_FLOWS,
      ),
    ).not.toThrow();
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

  it("synthetic parts beside a real account are dropped at $0 and refused holding money", () => {
    const { performanceAccountId: _id, ...noId } = roth401k;
    const synthetic = { ...noId, origin: "synthetic" as const };
    expect(
      declareOpeningParts(
        [retirementBrokerage, { ...synthetic, startingBalance: 0 }],
        NO_FLOWS,
      ),
    ).toEqual(declareOpeningParts([retirementBrokerage], NO_FLOWS));
    expect(() =>
      declareOpeningParts([retirementBrokerage, synthetic], NO_FLOWS),
    ).toThrow(/holds money/);
  });

  it("parts with no real account are left as given", () => {
    const pot = syntheticOpeningParts(
      buildCategoryRecord((c) => zeroBalance(c)),
    );
    expect(declareOpeningParts(pot, NO_FLOWS)).toEqual(pot);
    const simpleSpec = makeContributionSpec({
      contributionAccountId: 1,
      account: { kind: "synthetic" },
    });
    expect(
      declareOpeningParts(pot, {
        ...NO_FLOWS,
        contributionSpecs: [simpleSpec],
      }),
    ).toEqual(pot);
  });

  it("a contribution with no part declares its own $0 part, real, then its other tax part", () => {
    const unlinked = makeContributionSpec({
      personId: 1,
      contributionAccountId: 4,
      account: { kind: "unlinked" },
    });
    const parts = declareOpeningParts(
      syntheticOpeningParts(buildCategoryRecord((c) => zeroBalance(c))),
      { ...NO_FLOWS, contributionSpecs: [unlinked] },
    );
    expect(parts.filter((p) => p.origin === "synthetic")).toEqual([]);
    expect(
      parts
        .filter((p) => p.contributionAccountId === 4)
        .map((p) => [p.taxType, p.ownerPersonId, p.origin, p.startingBalance]),
    ).toEqual([
      ["taxFree", 1, "spec", 0],
      ["preTax", 1, "spec", 0],
    ]);
    expect(keysOf(parts)).toContain("contrib:4:401k::taxFree::1");
  });

  it("a contribution linked to an account with no balance row declares that account's part", () => {
    const linked = makeContributionSpec({
      personId: 1,
      contributionAccountId: 4,
      account: { kind: "performance", performanceAccountId: 12 },
    });
    const parts = declareOpeningParts([retirementBrokerage], {
      ...NO_FLOWS,
      profileSwitches: [
        {
          year: 2030,
          contributionSpecs: [linked],
          contributionRate: 0,
          employerMatchRateByCategory: zeroes,
          baseYearContributions: zeroes,
          baseYearEmployerMatch: zeroes,
        },
      ],
    });
    expect(keysOf(parts)).toEqual([
      accountIdKeyOf(retirementBrokerage),
      "acct:12:401k::taxFree::1",
      "acct:12:401k::preTax::1",
    ]);
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
      accountIdKeyOf(ira(1, "taxFree")),
      accountIdKeyOf(ira(2, "preTax")),
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

  // A spec that pays Ann's IRA, a part the run holds, so it declares none.
  const iraSpec = (account = paysInto(ira)) =>
    makeContributionSpec({
      category: "ira",
      contributionAccountId: 1,
      account,
    });

  it("specs throughout, or a stretch that saves nothing, declare none", () => {
    const spec = iraSpec();
    const withSpecs = saving({ contributionSpecs: [spec] });
    expect(declareOpeningParts([ira], withSpecs)).toHaveLength(3);
    expect(declareOpeningParts([ira], saving({}, 0))).toHaveLength(3);
  });

  it("a profile switch to no specs that saves declares them; one that stops saving doesn't", () => {
    const spec = iraSpec();
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
    spec = iraSpec(),
  ) =>
    saving(
      {
        contributionSpecs: [spec],
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
    // The spec pays the 401(k) held, so it declares none.
    const spec = makeContributionSpec({
      contributionAccountId: 1,
      personId: 1,
      account: paysInto(portfolio401k),
    });
    expect(
      declareOpeningParts(held, matching({ "401k": 0.04 }, undefined, spec)),
    ).toEqual(declareOpeningParts(held, NO_FLOWS));
    const named = declareOpeningParts(
      held,
      matching({ "401k": 0.04 }, [["Retirement", 4000]], spec),
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
  const ann401k = {
    ...acct("Ann 401k", "401k", 100000, 1),
    parentCategory: "Retirement",
  };
  const ann = {
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
        method: "percent_of_salary",
        value: 10,
        salaryFraction: 1,
        baseAnnual: 10000,
        taxTreatment: "pre_tax",
        allocationPriority: 0,
        personId: 1,
        ownerName: "Ann",
        contributionAccountId: 1,
        account: paysInto(withAccountId(ann401k)),
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
  } satisfies Parameters<typeof household>[1];
  const input = household([ann401k], ann);

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

  it("a household with no balance yet runs its contributions' own parts", () => {
    // No snapshot: synthetic parts at $0. The 401(k) contribution is linked
    // to no account, so it pays its own contribution account's part.
    const noSnapshot = household([], {
      ...ann,
      contributionSpecs: [
        { ...ann.contributionSpecs[0]!, account: { kind: "unlinked" } },
      ],
    });
    const year0 = calculateProjection(noSnapshot).projectionByYear[0]!;
    const own = (taxType: string) =>
      year0.individualAccountBalances.find(
        (r) => r.accountKey === `contrib:1:401k::${taxType}::1`,
      );
    expect(own("preTax")?.contribution).toBe(4166.66);
    expect(own("taxFree")?.contribution).toBe(4166.67);
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

  it("a run refuses a part whose tax type its account type doesn't book, naming the part", () => {
    expect(() =>
      calculateProjection(
        household([acct("Ann 401k", "401k", 1000, 1, "afterTax")]),
      ),
    ).toThrow(/Ann 401k.*"afterTax".*"preTax"/);
  });

  it("the opening parts are the held accounts, or synthetic parts when none is held", () => {
    expect(openingParts([roth401k], byCategory)).toEqual([roth401k]);
    expect(openingParts([], byCategory)).toEqual(
      syntheticOpeningParts(byCategory),
    );
  });
});
