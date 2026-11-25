/**
 * On a run that holds accounts, a category slice moves with its parts' cents:
 * across each year's growth and each floor after a run's draws, and through
 * the floors of a two-sided category and of a slice already apart from its
 * parts, each slice keeps its difference from its parts' sum (D2) to the cent.
 */
import { describe, it, expect, vi } from "vitest";

type SliceGap = Map<string, number>;
type Grown = { year: number; before: SliceGap; after: SliceGap };
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
type Floored = { before: SliceGap; after: SliceGap };
const floored = vi.hoisted(() => [] as Floored[]);
vi.mock("@/lib/pure/engine/category-slices", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/pure/engine/category-slices")>();
  return {
    ...actual,
    floorPartsAndSlices: (
      ...args: Parameters<typeof actual.floorPartsAndSlices>
    ) => {
      const [ctx, state, ownRaises] = args;
      const gapNow = () =>
        gaps(ctx.indAccounts, ctx.indKey, state.indBalance, {
          ...state.accountBalance,
        });
      // D2 before the floor: each slice less the raise its own clamp gave it
      const held = new Set(
        ctx.indAccounts.map((part) =>
          state.accountBalance[part.category].structure !== "roth_traditional"
            ? `${part.category}:balance`
            : `${part.category}:${part.taxType === "taxFree" ? "roth" : "traditional"}`,
        ),
      );
      const onlyHeld = (gap: SliceGap) =>
        new Map([...gap].filter(([slice]) => held.has(slice)));
      const before = gapNow();
      for (const [slice, raise] of ownRaises)
        before.set(slice, (before.get(slice) ?? 0) - Math.round(raise * 100));
      actual.floorPartsAndSlices(...args);
      floored.push({
        before: onlyHeld(before),
        after: onlyHeld(gapNow()),
      });
    },
  };
});
vi.mock(
  "@/lib/pure/engine/projection-year-handlers/year-growth",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/pure/engine/projection-year-handlers/year-growth")
      >();
    return {
      ...actual,
      growYear: (...args: Parameters<typeof actual.growYear>) => {
        const [ctx, state] = args;
        const gapNow = () =>
          gaps(ctx.indAccounts, ctx.indKey, state.indBalance, {
            ...state.accountBalance,
          });
        const before = gapNow();
        const result = actual.growYear(...args);
        if (ctx.ledgerRuns)
          grown.push({
            year: state.projectionByYear.length,
            before,
            after: gapNow(),
          });
        return result;
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
import { clampBalances } from "@/lib/pure/engine/balance-deduction";
import { floorPartsAndSlices } from "@/lib/pure/engine/category-slices";
import { openingTotals } from "@/lib/pure/engine/opening-state";
import { growYear } from "@/lib/pure/engine/projection-year-handlers/year-growth";
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
    // eslint-disable-next-line no-restricted-syntax -- only the fields growYear and floorPartsAndSlices read
    ctx: runFields as unknown as ProjectionContext,
    // eslint-disable-next-line no-restricted-syntax -- only the fields growYear and floorPartsAndSlices read
    state: stateFields as unknown as ProjectionLoopState,
  };
}

describe("category slices on a run that holds accounts", () => {
  it("keep their difference from their parts across every year's growth", () => {
    grown.length = 0;
    calculateProjection(makeInput());
    expect(grown.length).toBeGreaterThan(5);
    const moved = grown.flatMap(({ year, before, after }) =>
      [...after]
        .filter(([slice, cents]) => cents !== before.get(slice))
        .map(
          ([slice, cents]) =>
            `${year} ${slice}: ${before.get(slice)}¢ -> ${cents}¢`,
        ),
    );
    expect(moved).toEqual([]);
  });

  it("take their parts' floor raises before decumulation growth", () => {
    const a = brokeragePart("A", 100.02);
    const b = brokeragePart("B", -0.03);
    const { ctx, state } = heldRun([a, b], [100.02, -0.03]);
    growYear(ctx, state, 0.05, true);
    // parts: 100.02 grows 5.00 to 105.02; −0.03 floors to 0; the slice: 99.99 + 0.03 + 5.00
    expect(state.indBalance.get(accountIdKeyOf(a))).toBe(105.02);
    expect(state.indBalance.get(accountIdKeyOf(b))).toBe(0);
    expect(getTotalBalance(state.accountBalance.brokerage)).toBe(105.02);
  });

  it("take their parts' floor raises in place of their own after a draw", () => {
    const a = brokeragePart("A", 0.02);
    const b = brokeragePart("B", -0.03);
    const { ctx, state } = heldRun([a, b], [0.02, -0.03]);
    // the slice is −0.01: its own floor raises it 0.01, its parts' raise them 0.03
    const ownRaises = clampBalances(state.balances, state.accountBalance);
    floorPartsAndSlices(ctx, state, ownRaises);
    expect(state.indBalance.get(accountIdKeyOf(b))).toBe(0);
    expect(getTotalBalance(state.accountBalance.brokerage)).toBe(0.02);
  });

  it("floor each side of a two-sided category by its own parts' raises", () => {
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
    // traditional −0.01: its own floor raises it 0.01, its parts' 0.03; Roth −0.05: 0.05 either way
    const ownRaises = clampBalances(state.balances, state.accountBalance);
    floorPartsAndSlices(ctx, state, ownRaises);
    expect(getTraditionalBalance(state.accountBalance["401k"])).toBe(0.02);
    expect(getRothBalance(state.accountBalance["401k"])).toBe(0);
  });

  it("keep a slice's difference from its parts through the floor", () => {
    // the slice holds 0.01, a cent under its parts' 0.02; the parts' raise moves both by 0.03
    const a = brokeragePart("A", 0.04);
    const b = brokeragePart("B", -0.03);
    const { ctx, state } = heldRun([a, b], [0.05, -0.03]);
    const ownRaises = clampBalances(state.balances, state.accountBalance);
    floorPartsAndSlices(ctx, state, ownRaises);
    expect(state.indBalance.get(accountIdKeyOf(a))).toBe(0.05);
    expect(state.indBalance.get(accountIdKeyOf(b))).toBe(0);
    expect(getTotalBalance(state.accountBalance.brokerage)).toBe(0.04);
  });

  it("keep their difference from their parts across every floor after a run's draws", () => {
    floored.length = 0;
    calculateProjection(makeInput(150000, 30));
    // every decumulation year floors after its draws
    expect(floored.length).toBeGreaterThan(20);
    const moved = floored.flatMap(({ before, after }, i) =>
      [...after]
        .filter(([slice, cents]) => cents !== before.get(slice))
        .map(
          ([slice, cents]) =>
            `floor ${i} ${slice}: ${before.get(slice)}¢ -> ${cents}¢`,
        ),
    );
    expect(moved).toEqual([]);
  });
});
