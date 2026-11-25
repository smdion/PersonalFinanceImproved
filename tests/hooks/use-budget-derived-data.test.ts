/**
 * REGRESSION TEST for a pre-existing bug in getCatTotals.
 *
 * THE BUG. The `editMode` branch computed `getDraft(it.id, col,
 * it.amounts[col] ?? 0)` — falling back to the raw `amounts[col]` when no
 * draft exists for an item, instead of the SAME resolved value (contribution
 * -linked amount, else raw amount) the non-editMode branch uses. So a
 * contribution-linked item's category total silently changed the instant
 * edit mode turned on, before the user touched anything, because the
 * fallback skipped the contribution-linked resolution chain entirely.
 *
 * THE TEST. With no draft set for a contribution-linked item, its total must
 * be IDENTICAL whether editMode is true or false.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBudgetDerivedData } from "@/app/(dashboard)/budget/use-budget-derived-data";
import type { RawItem } from "@/components/budget";
import { setQuery } from "../components/trpc-mock";

// Two "brokerage"-keyword contribution accounts on one person: id 12 (real
// account behind the "R Brokerage" budget item, which will be marked
// linked in the relevant tests below) and id 3 (behind "LT Brokerage",
// left unlinked in these tests so it stays eligible for fuzzy matching).
const paycheckPeople = [
  {
    paycheck: {
      periodsPerYear: 12,
      gross: 0,
      federalWithholding: 0,
      ficaSS: 0,
      ficaMedicare: 0,
      preTaxDeductions: [],
      postTaxDeductions: [],
    },
    job: { id: 1, payPeriod: "monthly" as const },
    salary: 0,
    person: { name: "Alex" },
    rawContribs: [
      {
        id: 12,
        jobId: null,
        contributionValue: 0,
        contributionMethod: "fixed_monthly" as const,
        accountType: "brokerage",
      },
      {
        id: 3,
        jobId: null,
        contributionValue: 950,
        contributionMethod: "fixed_monthly" as const,
        accountType: "brokerage",
      },
    ],
  },
];

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("../components/trpc-mock")).trpc,
}));

const rawItem: RawItem = {
  id: 1,
  category: "Retirement",
  subcategory: "401k",
  amounts: [0], // raw DB amount is stale/zero — the resolved figure below is what should win
  contribAmount: 500,
  contribAmounts: [500],
  isEssential: false,
  apiCategoryId: null,
  apiCategoryName: null,
  apiSyncDirection: null,
  contributionAccountId: 42,
} as RawItem;

function setup(editMode: boolean, rawItems: RawItem[] = [rawItem]) {
  return renderHook(() =>
    useBudgetDerivedData({
      data: {
        profile: {
          id: 1,
          columnMonths: null,
        },
        columnLabels: ["Standard"],
        allColumnResults: null,
        rawItems,
      },
      savingsGoals: undefined,
      apiActualsData: null,
      contributionProfileId: null,
      salaryProfileId: null,
      editMode,
      getDraft: (_id, _col, original) => original,
      visibleCount: 10,
    }),
  );
}

describe("useBudgetDerivedData — getCatTotals editMode consistency", () => {
  it("a contribution-linked item's total is the same with editMode on or off when no draft exists", () => {
    setQuery("paycheck.computeSummary", undefined);
    const { result: readOnly } = setup(false);
    const { result: editing } = setup(true);

    const readOnlyTotal = readOnly.current.getCatTotals([rawItem])[0];
    const editingTotal = editing.current.getCatTotals([rawItem])[0];

    expect(editingTotal).toBeCloseTo(500, 2);
    expect(editingTotal).toBeCloseTo(readOnlyTotal!, 2);
  });
});

/**
 * REGRESSION TEST for the "R Brokerage" / "LT Brokerage" bug: two real
 * contribution accounts sharing the canonical keyword "brokerage", one
 * (id 12) linked to a budget item, the other (id 3) not.
 *
 * THE BUG. contribByCanonicalPerCol aggregated ALL contribution accounts
 * of a given keyword into one pool, including ones already linked to a
 * budget item — so matchContribution("brokerage") returned the SUM of both
 * accounts ($950), not just the unlinked one, and getCatTotals folded that
 * fuzzy sum into the category total on top of the linked item's own real
 * resolved amount — silently disagreeing with the server-computed total.
 *
 * THE FIX. Accounts already linked to a budget item (rawItems[].
 * contributionAccountId) are excluded from the fuzzy pool entirely, and
 * matchContribution's result never feeds getCatTotals's total at all — it's
 * badge/tooltip-only display for genuinely unlinked items.
 */
describe("useBudgetDerivedData — fuzzy contribution pool excludes linked accounts", () => {
  const linkedRBrokerage: RawItem = {
    id: 10,
    category: "Investments",
    subcategory: "R Brokerage",
    amounts: [0],
    contribAmount: 0,
    contribAmounts: [0],
    isEssential: false,
    apiCategoryId: null,
    apiCategoryName: null,
    apiSyncDirection: null,
    contributionAccountId: 12,
  } as RawItem;

  const unlinkedLtBrokerage: RawItem = {
    id: 11,
    category: "Investments",
    subcategory: "LT Brokerage",
    amounts: [0],
    isEssential: false,
    apiCategoryId: null,
    apiCategoryName: null,
    apiSyncDirection: null,
    contributionAccountId: null,
  } as RawItem;

  it("matchContrib only sees the unlinked account's amount, not the linked account's too", () => {
    setQuery("paycheck.computeSummary", {
      people: paycheckPeople,
      jointContribs: [],
    });
    const { result } = setup(false, [linkedRBrokerage, unlinkedLtBrokerage]);

    // Only account id 3 (the unlinked one, $950) should be in the pool —
    // account id 12 ($0, linked to linkedRBrokerage) is excluded.
    expect(result.current.matchContribution("LT Brokerage")).toBeCloseTo(
      950,
      2,
    );
  });

  it("getCatTotals never includes the fuzzy match — the linked item's own $0 wins, not the pool's $950", () => {
    setQuery("paycheck.computeSummary", {
      people: paycheckPeople,
      jointContribs: [],
    });
    const { result } = setup(false, [linkedRBrokerage, unlinkedLtBrokerage]);

    const [rTotal] = result.current.getCatTotals([linkedRBrokerage]);
    expect(rTotal).toBeCloseTo(0, 2);
  });

  it("an unlinked item next to a linked item in the same category is not double-counted in the category total", () => {
    setQuery("paycheck.computeSummary", {
      people: paycheckPeople,
      jointContribs: [],
    });
    const { result } = setup(false, [linkedRBrokerage, unlinkedLtBrokerage]);

    const catTotal = result.current.getCatTotals([
      linkedRBrokerage,
      unlinkedLtBrokerage,
    ])[0]!;
    // linkedRBrokerage resolves to its own $0 (never the fuzzy pool);
    // unlinkedLtBrokerage has no contribAmount/contribAmounts of its own,
    // so it falls back to its raw amounts[0] ($0) — the fuzzy match never
    // contributes to either item's total.
    expect(catTotal).toBeCloseTo(0, 2);
  });
});

/**
 * REGRESSION TEST: buildNonPayrollContribs used jobId alone to decide
 * "payroll vs. net-level," but jobId only means "tied to this employer" —
 * the canonical signal for whether money actually comes out of THAT
 * paycheck is isPayrollDeducted (falling back to jobId presence only when
 * unset), matching src/lib/pure/paycheck/bonus.ts and
 * src/lib/pure/contributions/contribution-rows.ts. A job-tied account the user
 * explicitly marked "not payroll deducted" (funded manually from take-home
 * despite being associated with a job) was wrongly treated as payroll and
 * dropped from the budget fuzzy-matching pool entirely.
 */
describe("useBudgetDerivedData — non-payroll pool follows isPayrollDeducted, not jobId alone", () => {
  it("includes a job-tied account explicitly marked isPayrollDeducted: false", () => {
    setQuery("paycheck.computeSummary", {
      jointContribs: [],
      people: [
        {
          paycheck: {
            periodsPerYear: 12,
            gross: 0,
            federalWithholding: 0,
            ficaSS: 0,
            ficaMedicare: 0,
            preTaxDeductions: [],
            postTaxDeductions: [],
          },
          job: { id: 1, payPeriod: "monthly" as const },
          salary: 0,
          person: { name: "Alex" },
          rawContribs: [
            {
              id: 20,
              jobId: 1,
              isPayrollDeducted: false,
              contributionValue: 300,
              contributionMethod: "fixed_monthly" as const,
              accountType: "brokerage",
            },
          ],
        },
      ],
    });
    const { result } = setup(false, []);

    expect(result.current.matchContribution("Brokerage")).toBeCloseTo(300, 2);
  });

  it("still excludes a job-tied account with no explicit isPayrollDeducted override (falls back to jobId presence)", () => {
    setQuery("paycheck.computeSummary", {
      jointContribs: [],
      people: [
        {
          paycheck: {
            periodsPerYear: 12,
            gross: 0,
            federalWithholding: 0,
            ficaSS: 0,
            ficaMedicare: 0,
            preTaxDeductions: [],
            postTaxDeductions: [],
          },
          job: { id: 1, payPeriod: "monthly" as const },
          salary: 0,
          person: { name: "Alex" },
          rawContribs: [
            {
              id: 21,
              jobId: 1,
              isPayrollDeducted: null,
              contributionValue: 300,
              contributionMethod: "fixed_monthly" as const,
              accountType: "brokerage",
            },
          ],
        },
      ],
    });
    const { result } = setup(false, []);

    expect(result.current.matchContribution("Brokerage")).toBeNull();
  });
});

describe("useBudgetDerivedData — push preview", () => {
  it("marks an amount the push skips as unreadable, never as $0", () => {
    setQuery("paycheck.computeSummary", undefined);
    const pushed = (subcategory: string, stored: string): RawItem =>
      ({
        id: subcategory.length,
        category: "Food",
        subcategory,
        amounts: JSON.parse(stored),
        isEssential: false,
        apiCategoryId: `cat-${subcategory}`,
        apiCategoryName: subcategory,
        apiSyncDirection: "push",
      }) as RawItem;
    const { result } = setup(false, [
      pushed("Snacks", '["abc"]'),
      pushed("Short", "[]"),
      pushed("Odd", '{"0":5}'),
      pushed("Rent", "[1200]"),
    ]);

    const items = result.current.buildPushPreviewItems(0);
    expect(items.find((i) => i.name === "Snacks")).toMatchObject({
      skipReason: "unreadable",
    });
    // No saved amount for the column (none stored, or not a list): missing.
    for (const name of ["Short", "Odd"])
      expect(items.find((i) => i.name === name)).toMatchObject({
        skipReason: "missing",
      });
    expect(items.find((i) => i.name === "Rent")).toMatchObject({
      newValue: 1200,
    });
    expect(items.find((i) => i.name === "Rent")!.skipReason).toBeUndefined();
  });
});

describe("useBudgetDerivedData — pull preview", () => {
  const pulled = (subcategory: string, stored: string): RawItem =>
    ({
      id: subcategory.length,
      category: "Food",
      subcategory,
      amounts: JSON.parse(stored),
      isEssential: false,
      apiCategoryId: `cat-${subcategory}`,
      apiCategoryName: subcategory,
      apiSyncDirection: "pull",
    }) as RawItem;

  it("names an amount it can't read, as the pull treats it, never showing it as $0", () => {
    setQuery("paycheck.computeSummary", undefined);
    const { result } = setup(false, [
      pulled("Snacks", '["abc"]'), // the pull replaces it
      pulled("Odd", '{"0":5}'), // not a list: the pull skips it
      pulled("Short", "[]"), // no stored column: the pull skips it
      pulled("Rent", "[1200]"),
    ]);

    const items = result.current.buildPullPreviewItems(0);
    const named = (name: string) => items.find((i) => i.name === name)!;
    expect(named("Snacks")).toMatchObject({ currentUnreadable: true });
    expect(named("Snacks").skipReason).toBeUndefined();
    expect(named("Odd")).toMatchObject({ skipReason: "missing" });
    expect(named("Short")).toMatchObject({ skipReason: "missing" });
    expect(named("Rent")).toEqual({
      name: "Rent",
      field: "Goal Target",
      currentYnab: 1200,
      newValue: 0,
    });
  });

  it("previews the pull's own column: one past the items' amounts is skipped, as the pull skips it", () => {
    setQuery("paycheck.computeSummary", undefined);
    const { result } = setup(false, [pulled("Rent", "[1200]")]);
    expect(result.current.buildPullPreviewItems(1)).toEqual([
      expect.objectContaining({ name: "Rent", skipReason: "missing" }),
    ]);
  });

  it("category totals count an amount that isn't a number as $0, as the budget total does", () => {
    setQuery("paycheck.computeSummary", undefined);
    const items = [pulled("Snacks", '["abc"]'), pulled("Rent", "[1200]")];
    const { result } = setup(false, items);
    expect(result.current.getCatTotals(items)).toEqual([1200]);
  });
});
