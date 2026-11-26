/**
 * A spread places its whole amount (place-whole.ts `placeWhole`): every
 * spread of money over account parts, specs or parent categories rounds
 * each member's amount to the cent and gives the member with the largest
 * share (the earlier on a tie) the cents left, so the parts take exactly
 * what their category takes.
 */
import { describe, expect, it } from "vitest";
import { roundToCents } from "@/lib/utils/math";
import type { AccountCategory } from "@/lib/config/account-types";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import { distributeContributions } from "@/lib/pure/engine/individual-accounts/contributions";
import {
  makeIndKey,
  specKeyOf,
} from "@/lib/pure/engine/individual-accounts/ledger";
import { otherParts } from "@/lib/pure/engine/individual-accounts/other-tax-part";
import { distributeGoalWithdrawal } from "@/lib/pure/engine/individual-accounts/withdrawals";
import { decumulationPortfolioContributions } from "@/lib/pure/engine/projection-year-handlers/portfolio-contributions";
import type { ContributionSpec } from "@/lib/pure/engine/types";
import {
  makeAccumulationSlot,
  makeContributionSpec,
  makeIndividualAccount,
  paysInto,
} from "../fixtures/engine-fixtures";

const indKey = makeIndKey();
const cents = (x: number) => Math.round(x * 100);
const total = (map: Map<string, number>) =>
  [...map.values()].reduce((s, x) => s + x, 0);

/** $100 in equal thirds: 33.33 each, and the first of the equal largest shares takes the cent left. */
const THIRDS = [33.34, 33.33, 33.33];
/** The raw shares of $100 in equal thirds. */
const RAW_THIRDS = [100 / 3, 100 / 3, 100 / 3];

/** The members sum to the raw shares' total, and none sits below its raw share
 *  (to the cent) by more than (n − 1)/2 cents. */
function expectPlacedWhole(placed: (number | undefined)[], raw: number[]) {
  const n = placed.length;
  const amount = raw.reduce((s, r) => s + r, 0);
  expect(cents(placed.reduce<number>((s, x) => s + (x ?? 0), 0))).toBe(
    cents(amount),
  );
  placed.forEach((x, i) =>
    expect(x!).toBeGreaterThanOrEqual(
      roundToCents(raw[i]!) - (n - 1) / 200 - 1e-9,
    ),
  );
}

/** Three parts of a category at $1,000 each, so $100 splits in thirds. */
function threeParts(
  category: AccountCategory,
  taxType: IndividualAccountInput["taxType"],
  parentCategory: string,
): IndividualAccountInput[] {
  return ["A", "B", "C"].map((name) =>
    makeIndividualAccount({
      name: `${category} ${name}`,
      category,
      taxType,
      parentCategory,
      startingBalance: 1000,
    }),
  );
}

function input(
  accounts: IndividualAccountInput[],
  overrides: Partial<Parameters<typeof distributeContributions>[0]> = {},
): Parameters<typeof distributeContributions>[0] {
  return {
    slots: [],
    contributionSpecs: [],
    indAccounts: accounts,
    indKey,
    indBalance: new Map(accounts.map((a) => [indKey(a), a.startingBalance])),
    indParentCat: new Map(),
    specToAccount: new Map(),
    accountsWithSpecs: new Set(),
    projectedSalary: 120000,
    currentSalary: 120000,
    limitGrowthRate: 0,
    yearIndex: 0,
    proRate: 1,
    overflowToBrokerage: 0,
    rampAmount: 0,
    ...overrides,
  };
}

/** Each part paid by its own spec, with `spec`'s fields. */
function specsFor(
  parts: IndividualAccountInput[],
  spec: Partial<ContributionSpec>,
): ContributionSpec[] {
  return parts.map((p, i) =>
    makeContributionSpec({
      name: p.name,
      contributionAccountId: i + 1,
      account: paysInto(p),
      ...spec,
    }),
  );
}

describe("a spread places its whole amount", () => {
  it("the employer match: $100 over three equal parts is 33.34, 33.33, 33.33", () => {
    const parts = threeParts("401k", "preTax", "Retirement");
    const { indMatch } = distributeContributions(
      input(parts, {
        slots: [makeAccumulationSlot("401k", { employerMatch: 100 })],
      }),
    );
    const placed = parts.map((p) => indMatch.get(indKey(p)));
    expect(placed).toEqual(THIRDS);
    expectPlacedWhole(placed, RAW_THIRDS);
  });

  it("the match across parent categories: $100.01 split evenly is $100.01, not $100.02", () => {
    const parts = [
      ...threeParts("401k", "preTax", "Retirement").slice(0, 1),
      ...threeParts("401k", "preTax", "Portfolio").slice(1, 2),
    ];
    const run = input(parts, {
      slots: [makeAccumulationSlot("401k", { employerMatch: 100.01 })],
      indParentCat: new Map([
        [indKey(parts[0]!), "Retirement"],
        [indKey(parts[1]!), "Portfolio"],
      ]),
      employerMatchByParentCat: new Map([
        [
          "401k",
          new Map([
            ["Retirement", 50],
            ["Portfolio", 50],
          ]),
        ],
      ]),
    });
    const { indMatch } = distributeContributions(run);
    expect(cents(total(indMatch))).toBe(10001);
    // 50.005 rounds up for both parents; the first of the equal shares gives back the cent.
    expect(parts.map((p) => indMatch.get(indKey(p)))).toEqual([50, 50.01]);
  });

  it("the ramp: $100 over three equal brokerages is $100", () => {
    const parts = threeParts("brokerage", "afterTax", "Portfolio");
    const { indRamp } = distributeContributions(
      input(parts, { rampAmount: 100 }),
    );
    const placed = parts.map((p) => indRamp.get(indKey(p)));
    expect(placed).toEqual(THIRDS);
    expectPlacedWhole(placed, RAW_THIRDS);
  });

  it("the overflow with no spec: $100 over three joint brokerages is $100", () => {
    const parts = threeParts("brokerage", "afterTax", "Retirement");
    const { indOverflow } = distributeContributions(
      input(parts, {
        slots: [makeAccumulationSlot("brokerage", { employeeContrib: 100 })],
        overflowToBrokerage: 100,
      }),
    );
    const placed = parts.map((p) => indOverflow.get(indKey(p)));
    expect(placed).toEqual(THIRDS);
    expectPlacedWhole(placed, RAW_THIRDS);
  });

  it("the overflow over specs with no target: $100 over three brokerage specs is 33.34, 33.33, 33.33", () => {
    const parts = threeParts("brokerage", "afterTax", "Retirement");
    const specs = specsFor(parts, {
      category: "brokerage",
      taxTreatment: "after_tax",
    });
    expect(specs.every((s) => s.targetAnnual == null)).toBe(true);
    const run = input(parts, {
      contributionSpecs: specs,
      specToAccount: new Map(
        specs.map((s, i) => [specKeyOf(s), [indKey(parts[i]!)]]),
      ),
      accountsWithSpecs: new Set(parts.map((p) => indKey(p))),
      slots: [makeAccumulationSlot("brokerage", { employeeContrib: 100 })],
      overflowToBrokerage: 100,
    });
    const { indOverflow } = distributeContributions(run);
    const placed = parts.map((p) => indOverflow.get(indKey(p)));
    expect(placed).toEqual(THIRDS);
    expectPlacedWhole(placed, RAW_THIRDS);
  });

  it("scaling specs: a $100 slot over three equal specs is $100", () => {
    const parts = threeParts("hsa", "hsa", "Retirement");
    const specs = specsFor(parts, {
      category: "hsa",
      taxTreatment: "pre_tax",
      value: 0.01,
      baseAnnual: 1200,
    });
    const run = input(parts, {
      slots: [makeAccumulationSlot("hsa", { employeeContrib: 100 })],
      contributionSpecs: specs,
      specToAccount: new Map(
        specs.map((s, i) => [specKeyOf(s), [indKey(parts[i]!)]]),
      ),
      accountsWithSpecs: new Set(parts.map((p) => indKey(p))),
    });
    const { indContributions } = distributeContributions(run);
    const placed = parts.map((p) => indContributions.get(indKey(p)));
    expect(placed).toEqual(THIRDS);
    expectPlacedWhole(placed, RAW_THIRDS);
  });

  it("scaling specs that project $0: a spec with no account doesn't hand its third to the others", () => {
    const parts = threeParts("hsa", "hsa", "Retirement");
    // Each projects $0, so each takes an equal third; the third spec pays no account.
    const specs = specsFor(parts, {
      category: "hsa",
      taxTreatment: "pre_tax",
      value: 0,
      baseAnnual: 0,
    });
    const paid = parts.slice(0, 2);
    const run = input(parts, {
      slots: [makeAccumulationSlot("hsa", { employeeContrib: 90 })],
      contributionSpecs: specs,
      specToAccount: new Map(
        specs.slice(0, 2).map((s, i) => [specKeyOf(s), [indKey(paid[i]!)]]),
      ),
      accountsWithSpecs: new Set(paid.map((p) => indKey(p))),
    });
    const { indContributions } = distributeContributions(run);
    expect(paid.map((p) => indContributions.get(indKey(p)))).toEqual([30, 30]);
    expect(indContributions.get(indKey(parts[2]!))).toBeUndefined();
  });

  /** One spec paying `paid`, its run over `parts` and the slot `slot`. */
  function oneSpecRun(
    parts: IndividualAccountInput[],
    paid: IndividualAccountInput,
    spec: Partial<ContributionSpec>,
    slot: Parameters<typeof makeAccumulationSlot>,
    overrides: Partial<Parameters<typeof distributeContributions>[0]> = {},
  ) {
    const [only] = specsFor([paid], spec);
    return distributeContributions(
      input(parts, {
        slots: [makeAccumulationSlot(...slot)],
        contributionSpecs: [only!],
        specToAccount: new Map([[specKeyOf(only!), [indKey(paid)]]]),
        accountsWithSpecs: new Set([indKey(paid)]),
        ...overrides,
      }),
    ).indContributions;
  }

  it("a slot its specs leave short: a $0.30 IRS spill beside a Portfolio brokerage spec lands on the Retirement brokerage, so $1,000.30 is placed", () => {
    const taxable = makeIndividualAccount({
      name: "Taxable",
      category: "brokerage",
      taxType: "afterTax",
      parentCategory: "Portfolio",
      startingBalance: 5000,
    });
    const retirement = makeIndividualAccount({
      name: "Retirement brokerage",
      category: "brokerage",
      taxType: "afterTax",
      parentCategory: "Retirement",
      startingBalance: 0,
    });
    // The spill is under the $1 overflow tolerance, so it stays in the slot.
    const placed = oneSpecRun(
      [taxable, retirement],
      taxable,
      {
        category: "brokerage",
        taxTreatment: "after_tax",
        method: "fixed_monthly",
        baseAnnual: 1000,
        parentCategory: "Portfolio",
      },
      ["brokerage", { employeeContrib: 1000.3 }],
    );
    expect(placed.get(indKey(taxable))).toBe(1000);
    expect(placed.get(indKey(retirement))).toBe(0.3);
    expect(cents(total(placed))).toBe(100030);
  });

  it("year 0's money beyond the months left, past a fixed-amount spec, lands on the category's Retirement parts by balance", () => {
    const ann = makeIndividualAccount({
      name: "Ann 401k",
      parentCategory: "Retirement",
      startingBalance: 2000,
    });
    const bo = makeIndividualAccount({
      name: "Bo 401k",
      parentCategory: "Retirement",
      startingBalance: 1000,
    });
    // $2,000 a year, half a year left: the spec's $1,000; the slot $1,400.
    // The $400 left splits by the balances after the spec's credit, 3:1.
    const placed = oneSpecRun(
      [ann, bo],
      ann,
      {
        taxTreatment: "pre_tax",
        method: "fixed_monthly",
        baseAnnual: 2000,
        contributionScaling: "fixed_amount",
        parentCategory: "Retirement",
      },
      ["401k", { employeeContrib: 1400, traditionalContrib: 1400 }],
      { proRate: 0.5 },
    );
    expect(placed.get(indKey(ann))).toBe(1300);
    expect(placed.get(indKey(bo))).toBe(100);
  });

  it("a tax type no spec carries: $100 over three spec accounts' other parts is $100", () => {
    const roth = threeParts("401k", "taxFree", "Retirement");
    const trad = threeParts("401k", "preTax", "Retirement");
    const accounts = [...roth, ...trad];
    const specs = specsFor(roth, { category: "401k" });
    const ledger = {
      indAccounts: accounts,
      indKey,
      indBalance: new Map(accounts.map((a) => [indKey(a), a.startingBalance])),
    };
    const contributions = new Map<string, number>();
    otherParts(
      ledger,
      new Map(specs.map((s, i) => [specKeyOf(s), [indKey(roth[i]!)]])),
      new Map(specs.map((s) => [specKeyOf(s), 1000])),
      contributions,
    )(specs, "pre_tax", 100);
    expect(cents(total(contributions))).toBe(10000);
    const placed = trad.map((p) => contributions.get(indKey(p)));
    expect(placed).toEqual(THIRDS);
    expectPlacedWhole(placed, RAW_THIRDS);
  });

  it("a goal draw: a $1,000 brokerage takes the cents left, so a $0 part listed last stays at $0", () => {
    const parts = [
      ...threeParts("brokerage", "afterTax", "Portfolio"),
      makeIndividualAccount({
        name: "brokerage D",
        category: "brokerage",
        taxType: "afterTax",
        parentCategory: "Portfolio",
        startingBalance: 0,
      }),
    ];
    const balances = new Map(parts.map((p) => [indKey(p), p.startingBalance]));
    // $1 in thirds is 0.33 + 0.33 + 0.33: the cent left goes to a $1,000
    // part (the largest share), never to the $0 part.
    distributeGoalWithdrawal(1, parts, indKey, balances);
    expect(cents(total(balances))).toBe(299900);
    expect(parts.map((p) => balances.get(indKey(p)))).toEqual([
      999.66, 999.67, 999.67, 0,
    ]);
  });

  it("the decumulation ramp (shown only): $100 over three equal brokerages is $100", () => {
    const parts = threeParts("brokerage", "afterTax", "Portfolio");
    // The step reads only these fields of the run's context and state.
    const context = {
      input: { brokerageContributionRamp: 100, limitGrowthRate: 0 },
      indKey,
      indAccounts: parts,
    };
    const state = { indBalance: new Map(parts.map((p) => [indKey(p), 1000])) };
    type Step = typeof decumulationPortfolioContributions;
    const { decumContributionByAccount } = decumulationPortfolioContributions(
      // eslint-disable-next-line no-restricted-syntax -- a fixture with just the fields the step reads
      context as unknown as Parameters<Step>[0],
      // eslint-disable-next-line no-restricted-syntax -- a fixture with just the fields the step reads
      state as unknown as Parameters<Step>[1],
      1,
    );
    const placed = parts.map((p) => decumContributionByAccount.get(indKey(p)));
    expect(placed).toEqual(THIRDS);
    expectPlacedWhole(placed, RAW_THIRDS);
  });

  it("a goal draw: $100 from three equal brokerages takes $100", () => {
    const parts = threeParts("brokerage", "afterTax", "Portfolio");
    const balances = new Map(parts.map((p) => [indKey(p), 1000]));
    distributeGoalWithdrawal(100, parts, indKey, balances);
    expect(cents(total(balances))).toBe(290000);
    expect(parts.map((p) => balances.get(indKey(p)))).toEqual([
      966.66, 966.67, 966.67,
    ]);
  });
});
