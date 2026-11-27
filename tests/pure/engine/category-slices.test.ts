/**
 * On a run that holds accounts, a category slice holds its parts' cents: at
 * each year's growth point and each year's draws point (after the parts'
 * floor), each slice is its parts' sum, both sides of a two-sided category
 * included.
 */
import { describe, it, expect, vi } from "vitest";

type SliceGap = Map<string, number>;
type Grown = { year: number; after: SliceGap };
const grown = vi.hoisted(() => [] as Grown[]);
const gaps = vi.hoisted(
  () =>
    (
      parts: readonly {
        category: string;
        taxType: string;
      }[],
      keyOf: (part: never) => string,
      partBalance: ReadonlyMap<string, number>,
      accountBalance: Record<string, Record<string, unknown>>,
    ): Map<string, number> => {
      const cents = new Map<string, number>();
      const add = (slice: string, amount: number) =>
        cents.set(slice, (cents.get(slice) ?? 0) + Math.round(amount * 100));
      for (const [category, balance] of Object.entries(accountBalance)) {
        if (balance.structure === "roth_traditional") {
          add(`${category}:traditional`, Number(balance.traditional));
          add(`${category}:roth`, Number(balance.roth));
        } else add(`${category}:balance`, Number(balance.balance));
      }
      for (const part of parts) {
        const twoSided =
          accountBalance[part.category]?.structure === "roth_traditional";
        const side = !twoSided
          ? "balance"
          : part.taxType === "taxFree"
            ? "roth"
            : "traditional";
        const amount = partBalance.get(keyOf(part as never)) ?? 0;
        add(`${part.category}:${side}`, -amount);
      }
      return cents;
    },
);
const floored = vi.hoisted(() => [] as Grown[]);
vi.mock(
  "@/lib/pure/engine/projection-year-handlers/settle",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/pure/engine/projection-year-handlers/settle")
      >();
    return {
      ...actual,
      settle: (...args: Parameters<typeof actual.settle>) => {
        const [ctx, state, point] = args;
        actual.settle(...args);
        const at = point.endsWith(".growth")
          ? grown
          : point === "decumulation.draws"
            ? floored
            : undefined;
        if (ctx.ledgerRuns && at)
          at.push({
            year: state.projectionByYear.length,
            after: gaps(ctx.indAccounts, ctx.indKey, state.indBalance, {
              ...state.accountBalance,
            }),
          });
      },
    };
  },
);

import { calculateProjection } from "@/lib/pure/engine";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import { accountIdKeyOf } from "@/lib/pure/accounts/account-part";
import {
  getRothBalance,
  getTotalBalance,
  getTraditionalBalance,
} from "@/lib/pure/accounts/account-balance";
import { floorParts } from "@/lib/pure/engine/category-slices";
import { openingTotals } from "@/lib/pure/engine/opening-parts";
import { growYear } from "@/lib/pure/engine/projection-year-handlers/year-growth";
import { refreshViews } from "@/lib/pure/engine/projection-year-handlers/settle";
import type {
  ProjectionContext,
  ProjectionLoopState,
} from "@/lib/pure/engine/projection-year-handlers/types";
import { capsFromBaseLimits, withCapsAge } from "../../helpers/irs-limit-caps";
import { shippedTaxTables } from "../../helpers/tax-data";
import {
  makeAccumulationDefaults,
  makeIndividualAccount,
} from "../fixtures/engine-fixtures";
import { onePerson } from "../../fixtures/engine-people";
import { engineInput } from "../fixtures/engine-input";

const AS_OF = new Date("2025-01-01");
const OWNER = {
  ownerName: "Alice",
  ownerPersonId: 1,
  parentCategory: "Retirement",
};

/** Each slice in two parts at odd cents, so the parts' rounded growth and
 *  the slice's own rounded product part by a cent. */
function heldParts(): IndividualAccountInput[] {
  const part = (
    name: string,
    category: IndividualAccountInput["category"],
    taxType: IndividualAccountInput["taxType"],
    startingBalance: number,
    startingBasis?: number,
  ) =>
    makeIndividualAccount({
      name,
      category,
      taxType,
      startingBalance,
      ...(startingBasis === undefined ? {} : { startingBasis }),
      ...OWNER,
    });
  return [
    part("401k A", "401k", "preTax", 40000.37),
    part("401k B", "401k", "preTax", 39999.63),
    part("Roth 401k", "401k", "taxFree", 20000.11),
    part("IRA A", "ira", "preTax", 15000.49),
    part("IRA B", "ira", "preTax", 14999.51),
    part("Roth IRA A", "ira", "taxFree", 10000.13),
    part("Roth IRA B", "ira", "taxFree", 9999.87),
    part("HSA", "hsa", "hsa", 15000),
    part("Brokerage A", "brokerage", "afterTax", 15000.29, 10000),
    part("Brokerage B", "brokerage", "afterTax", 14999.71, 10000),
  ];
}

function makeInput(spending = 72000, years = 12): ProjectionInput {
  const parts = heldParts();
  const { balances, accountBalance } = openingTotals(parts);
  return engineInput(
    withCapsAge({
      budgetContributionLines: 0,
      accumulationDefaults: makeAccumulationDefaults({
        accountSplits: {
          "401k": 0.4,
          "403b": 0,
          hsa: 0.1,
          ira: 0.15,
          brokerage: 0.35,
        },
      }),
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
        withdrawalSplits: {
          "401k": 0.35,
          "403b": 0,
          ira: 0.25,
          brokerage: 0.3,
          hsa: 0.1,
        },
        withdrawalTaxPreference: { "401k": "traditional", ira: "traditional" },
        distributionTaxRates: {
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
      accumulationOverrides: [],
      decumulationOverrides: [],
      currentAge: 60,
      people: onePerson(AS_OF.getFullYear() - 60),
      retirementYear: AS_OF.getFullYear() + 3,
      projectionEndYear: AS_OF.getFullYear() + years,
      currentSalary: 150000,
      salaryGrowthRate: 0.03,
      salaryCap: null,
      salaryOverrides: [],
      budgetOverrides: [],
      irsLimitCaps: capsFromBaseLimits({
        baseLimits: {
          "401k": 23500,
          "403b": 23500,
          hsa: 4300,
          ira: 7000,
          brokerage: 0,
        },
        catchupLimits: {
          "401k": 7500,
          ira: 1000,
          hsa: 1000,
          "401k_super": 11250,
        },
        currentAge: 60,
      }),
      limitGrowthRate: 0.02,
      employerMatchRateByCategory: {
        "401k": 0.03,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
      startingBalances: balances,
      startingAccountBalances: accountBalance,
      individualAccounts: parts,
      annualExpenses: spending,
      decumulationAnnualExpenses: spending,
      inflationRate: 0.025,
      returnRates: [{ label: "Age 60", rate: 0.0637 }],
      socialSecurityAnnual: 36000,
      ssStartAge: 67,
      asOfDate: AS_OF,
    }),
  );
}

function brokeragePart(name: string, startingBalance: number) {
  return makeIndividualAccount({
    name,
    category: "brokerage",
    taxType: "afterTax",
    startingBalance,
    ...OWNER,
  });
}

/** A held run's context and loop state, as much of them as the slice steps read. */
function heldRun(parts: IndividualAccountInput[], partBalance: number[]) {
  const { balances, accountBalance } = openingTotals(parts);
  const indBalance = new Map(
    parts.map((part, i) => [accountIdKeyOf(part), partBalance[i]]),
  );
  const runFields = {
    ledgerRuns: true,
    indAccounts: parts,
    indKey: accountIdKeyOf,
  };
  const stateFields = {
    balances,
    accountBalance,
    indBalance,
    brokBasis: new Map<string, number>(),
    projectionByYear: [],
  };
  return {
    // eslint-disable-next-line no-restricted-syntax -- only the fields growYear, floorParts and refreshViews read
    ctx: runFields as unknown as ProjectionContext,
    // eslint-disable-next-line no-restricted-syntax -- only the fields growYear, floorParts and refreshViews read
    state: stateFields as unknown as ProjectionLoopState,
  };
}

describe("category slices on a run that holds accounts", () => {
  it("hold their parts' cents at every year's growth point", () => {
    grown.length = 0;
    calculateProjection(makeInput());
    expect(grown.length).toBeGreaterThan(5);
    const apart = grown.flatMap(({ year, after }) =>
      [...after]
        .filter(([, cents]) => cents !== 0)
        .map(([slice, cents]) => `${year} ${slice}: ${cents}¢`),
    );
    expect(apart).toEqual([]);
  });

  it("take their parts' growth and floor raises at decumulation growth's settled point", () => {
    const a = brokeragePart("A", 100.02);
    const b = brokeragePart("B", -0.03);
    const { ctx, state } = heldRun([a, b], [100.02, -0.03]);
    growYear(ctx, state, 0.05, true);
    refreshViews(ctx, state);
    // parts: 100.02 grows 5.00 to 105.02; −0.03 floors to 0; the slice: 99.99 + 0.03 + 5.00
    expect(state.indBalance.get(accountIdKeyOf(a))).toBe(105.02);
    expect(state.indBalance.get(accountIdKeyOf(b))).toBe(0);
    expect(getTotalBalance(state.accountBalance.brokerage)).toBe(105.02);
  });

  it("take their parts' floor raises after a draw, at the draws' refresh", () => {
    const a = brokeragePart("A", 0.02);
    const b = brokeragePart("B", -0.03);
    const { ctx, state } = heldRun([a, b], [0.02, -0.03]);
    // the parts floor to 0.02 and 0; the slice is their sum
    floorParts(ctx, state);
    refreshViews(ctx, state);
    expect(state.indBalance.get(accountIdKeyOf(b))).toBe(0);
    expect(getTotalBalance(state.accountBalance.brokerage)).toBe(0.02);
  });

  it("floor each side of a two-sided category by its own parts", () => {
    const part = (
      name: string,
      taxType: IndividualAccountInput["taxType"],
      startingBalance: number,
    ) =>
      makeIndividualAccount({
        name,
        category: "401k",
        taxType,
        startingBalance,
        ...OWNER,
      });
    const parts = [
      part("401k A", "preTax", 0.02),
      part("401k B", "preTax", -0.03),
      part("Roth 401k", "taxFree", -0.05),
    ];
    const { ctx, state } = heldRun(parts, [0.02, -0.03, -0.05]);
    // traditional parts floor to 0.02 and 0; the Roth part to 0
    floorParts(ctx, state);
    refreshViews(ctx, state);
    expect(getTraditionalBalance(state.accountBalance["401k"])).toBe(0.02);
    expect(getRothBalance(state.accountBalance["401k"])).toBe(0);
  });

  it("hold their parts' cents at every year's draws point", () => {
    floored.length = 0;
    calculateProjection(makeInput(150000, 30));
    // every decumulation year settles its draws
    expect(floored.length).toBeGreaterThan(20);
    const apart = floored.flatMap(({ year, after }) =>
      [...after]
        .filter(([, cents]) => cents !== 0)
        .map(([slice, cents]) => `${year} ${slice}: ${cents}¢`),
    );
    expect(apart).toEqual([]);
  });
});
