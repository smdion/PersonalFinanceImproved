/** The input of the active budget summary (budget.computeActiveSummary):
 *  the profile and column, the pay pair, and the What-If tab's edits. */
import { z } from "zod/v4";
import { payProfileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";
import {
  zSandboxSalaryEntries,
  zItemAmountActiveFields,
  zSandboxDeductionEdits,
  zSandboxDeductionAdditions,
  zSandboxContribActiveFields,
  zSandboxContribAdditions,
} from "@/lib/pure/household/what-if.schema";
import type { Db } from "@/lib/db";
import type { RequestScope } from "@/server/data/request-scope";
import { eq, asc, and, gte, lt } from "drizzle-orm";
import { log } from "@/lib/logger";
import { toItemAmountActiveMap } from "@/lib/pure/household/what-if.schema";
import * as schema from "@/lib/db/schema";
import { calculateBudget } from "@/lib/pure/budget/budget";
import type { BudgetInput } from "@/lib/pure/budget/budget.types";
import { loadBudgetItemLinks } from "@/server/data/category-links";
import { resolveTargetBudgetProfile } from "@/server/data/budget-profiles";
import { resolveLinkedBudgetItemAmounts } from "@/server/services/budget/linked-items";
import { computeBudgetAnnualTotal } from "@/lib/pure/budget/annual-total";
import { getActiveBudgetApi } from "@/lib/budget-api";
import { currentMonthKey } from "@/lib/utils/date-keys";
import {
  resolveProfileSelection,
  summaryProfileIdsInput,
} from "@/server/services/profile-selection";
import { computePaycheckSummary } from "@/server/services/paycheck/summary";

export const zBudgetActiveSummaryInput = z
  .object({
    selectedColumn: z.number().optional(),
    profileId: z.number().optional(),
    /** The page's own Contribution/Salary picks (What-If); absent =
     *  the active profiles. */
    selection: payProfileSelectionSchema.optional(),
    /** The What-If tab's salary/bonus entries, as in zPaycheckSummaryInput:
     *  every paycheck summary this computes reads them (linked amounts and
     *  netMonthlyIncome), so both see the same income. */
    sandboxSalaryEntries: zSandboxSalaryEntries,
    /** The What-If tab's budget item amounts, one more layer on the
     *  per-item resolution chain (see toItemAmountActiveMap). */
    itemAmountActiveFields: zItemAmountActiveFields,
    /** As in zPaycheckSummaryInput; they reach netMonthlyIncome's paycheck
     *  summary, so a deduction edit moves the income the budget is checked
     *  against. */
    sandboxDeductionEdits: zSandboxDeductionEdits,
    sandboxDeductionAdditions: zSandboxDeductionAdditions,
    /** As in zPaycheckSummaryInput; applied to linked-item resolution and
     *  to netMonthlyIncome's paycheck summary alike. */
    sandboxContribActiveFields: zSandboxContribActiveFields,
    /** As in zPaycheckSummaryInput. */
    sandboxContribAdditions: zSandboxContribAdditions,
  })
  .optional();

/**
 * Household monthly take-home from computePaycheckSummary: each job's net
 * pay × the paychecks per month the budget counts. netPay is gross −
 * pre-tax − withholding − FICA − post-tax, so this is the same take-home the
 * client's buildPayrollBreakdown derives line by line. Null when no one has
 * a paycheck.
 */
export function netMonthlyTakeHome(data: {
  people: readonly {
    job?: unknown;
    paycheck?: { netPay: number; periodsPerYear: number } | null;
    budgetPerMonth?: number | null;
  }[];
}): number | null {
  let total: number | null = null;
  for (const d of data.people) {
    const pc = d.paycheck;
    if (!pc || !d.job) continue;
    total =
      (total ?? 0) + pc.netPay * (d.budgetPerMonth ?? pc.periodsPerYear / 12);
  }
  return total;
}

export async function computeBudgetActiveSummary(
  ctx: { db: Db; scope: RequestScope },
  input: z.output<typeof zBudgetActiveSummaryInput>,
) {
  const activeProfile = await resolveTargetBudgetProfile(
    ctx.db,
    input?.profileId,
  );

  // Sum of budget_income_adjustments (Budget-mode extra-paycheck
  // materializer output) landing in the REAL current calendar month.
  // Computed unconditionally, before activeProfile is even checked —
  // deliberately NOT parameterized by selectedColumn/profileId, so it
  // can't be used to silently corrupt a What-If scenario comparison
  // (the advisor rejected folding this into netMonthlyIncome for
  // exactly that reason: netMonthlyIncome is per-selectedColumn and has
  // no "this is the live view" signal). Same value for every scenario
  // column (invariant test: tests/routers/budget-coverage.test.ts).
  const { asOf } = ctx.scope;
  const nowMonthStart = currentMonthKey(asOf);
  const nextMonthStart = currentMonthKey(
    new Date(asOf.getFullYear(), asOf.getMonth() + 1, 1),
  );
  const budgetIncomeAdjustmentRows = await ctx.db
    .select({ amount: schema.budgetIncomeAdjustments.amount })
    .from(schema.budgetIncomeAdjustments)
    .where(
      and(
        gte(schema.budgetIncomeAdjustments.monthDate, nowMonthStart),
        lt(schema.budgetIncomeAdjustments.monthDate, nextMonthStart),
      ),
    );
  const budgetIncomeAdjustmentThisMonth = budgetIncomeAdjustmentRows.reduce(
    (sum, r) => sum + Number(r.amount),
    0,
  );

  if (!activeProfile) {
    return {
      profile: null,
      result: null,
      columnLabels: [] as string[],
      budgetIncomeAdjustmentThisMonth,
    };
  }

  const rawItemRows = await ctx.db
    .select()
    .from(schema.budgetItems)
    .where(eq(schema.budgetItems.profileId, activeProfile.id))
    .orderBy(asc(schema.budgetItems.sortOrder));

  // Read-only display path — resolve links for the currently active
  // service only (no cross-service ambiguity here; see
  // src/server/data/category-links.ts).
  const displayService = await getActiveBudgetApi(ctx.db);
  const displayItemLinks =
    displayService === "none"
      ? new Map()
      : await loadBudgetItemLinks(
          ctx.db,
          rawItemRows.map((i) => i.id),
          displayService,
        );
  const items = rawItemRows.map((i) => {
    const link = displayItemLinks.get(i.id);
    return {
      ...i,
      apiCategoryId: link?.categoryId ?? null,
      apiCategoryName: link?.categoryName ?? null,
      apiLastSyncedAt: link?.lastSyncedAt ?? null,
      apiSyncDirection: link?.syncDirection ?? "pull",
    };
  });

  const columnLabels = activeProfile.columnLabels;
  const numColumns = columnLabels.length;
  const selectedColumn = Math.min(input?.selectedColumn ?? 0, numColumns - 1);

  // ── Contribution-linked budget amounts ──
  // Budget items linked to a contribution account (via
  // contributionAccountId) use the contribution's monthly amount
  // directly — no fill-in heuristics — under the (Contribution, Salary)
  // pair the page shows: its own local selection (What-If), else the
  // active profiles. A budget column is a spending level, so the pair is
  // the same for every column (and matches use-budget-derived-data.ts).
  const profiles = await resolveProfileSelection(ctx.scope, input?.selection);
  // Resolved through the SAME helper listProfiles uses above
  // (resolveLinkedBudgetItemAmounts) — this procedure used to maintain
  // its own independent copy of this exact resolution (the only
  // difference being What-If sandbox support), which the helper now
  // accepts directly, so a linked item's $ figure can never drift
  // between the two call sites.
  const resolvedItemsById = new Map(
    (
      await resolveLinkedBudgetItemAmounts(ctx, items, numColumns, profiles, {
        sandboxContribActiveFields: input?.sandboxContribActiveFields,
        sandboxSalaryEntries: input?.sandboxSalaryEntries,
      })
    ).map((r) => [r.id, r]),
  );

  // For linked items, the contribution's monthly amount (the same in
  // every column) replaces the column's DB amount. For unlinked items, use DB amounts
  // as-is. The What-If tab's hand-edited amounts are ONE MORE LAYER on
  // top of that resolution chain — never a replacement for it, per
  // toItemAmountActiveMap's docblock — applied here so every
  // downstream total (result, allColumnResults, weightedAnnualTotal,
  // netMonthlyIncome's leftover) reflects the sandbox's edits through
  // the ONE resolution path instead of a second client-side computation.
  const itemActiveMap = toItemAmountActiveMap(input?.itemAmountActiveFields);
  const applyItemActiveFields = (itemId: number, amounts: number[]) =>
    itemActiveMap.size === 0
      ? amounts
      : amounts.map(
          (amount, col) => itemActiveMap.get(`${itemId}:${col}`) ?? amount,
        );
  const budgetItems = items.map((i) => {
    const resolved = resolvedItemsById.get(i.id)!;
    if (!i.contributionAccountId)
      return {
        ...i,
        amounts: applyItemActiveFields(i.id, resolved.amounts),
        contribAmounts: null as number[] | null,
        contribAmount: null as number | null,
      };
    const contribAmounts = resolved.amounts;
    return {
      ...i,
      amounts: applyItemActiveFields(i.id, contribAmounts),
      contribAmounts,
      // Kept for the display path that only knows about one figure; it is
      // the SELECTED column's amount, not a value valid for all columns.
      contribAmount: contribAmounts[selectedColumn] ?? 0,
    };
  });

  const budgetInput: BudgetInput = {
    items: budgetItems.map((i) => ({
      category: i.category,
      label: i.subcategory,
      amounts: i.amounts,
      isEssential: i.isEssential,
    })),
    columnLabels,
    selectedColumn,
    asOfDate: ctx.scope.asOf,
  };

  const result = calculateBudget(budgetInput);

  // Also compute all columns for side-by-side comparison
  const allColumnResults = columnLabels.map((_: string, colIndex: number) =>
    calculateBudget({ ...budgetInput, selectedColumn: colIndex }),
  );

  // Raw items: DB amounts for editing, contribution amounts for display on linked items.
  const rawItems = items.map((i) => {
    const dbAmounts = i.amounts as number[];
    const linked = budgetItems.find((b) => b.id === i.id);
    return {
      id: i.id,
      category: i.category,
      subcategory: i.subcategory,
      amounts: dbAmounts,
      contribAmount: linked?.contribAmount ?? null,
      /** Contribution $ per column — computed once from the active
       *  profiles, the same in every column. Null for unlinked items. */
      contribAmounts: linked?.contribAmounts ?? null,
      isEssential: i.isEssential,
      apiCategoryId: i.apiCategoryId,
      apiCategoryName: i.apiCategoryName,
      apiSyncDirection: i.apiSyncDirection,
      contributionAccountId: i.contributionAccountId,
      // Per-column reason a linked item's amount is $0 (one per column,
      // from the same active profiles). See classifyContribResolution.
      contribStatus: resolvedItemsById.get(i.id)?.contribStatus ?? null,
    };
  });

  const columnMonths = activeProfile.columnMonths ?? null;
  const weightedAnnualTotal = computeBudgetAnnualTotal(
    budgetItems.map((i) => ({ amounts: i.amounts })),
    selectedColumn,
    columnMonths,
  );

  // Monthly take-home under the (Contribution, Salary) pair in use,
  // honoring sandboxSalaryEntries — the same computePaycheckSummary
  // call and the same netMonthlyTakeHome as listProfiles, so the What-If tab's "available income"
  // figure can't disagree with what Savings' Unspent shows for the same
  // inputs. Not derived from WhatIfPaycheckSummary's client-side annual
  // total, which uses a naive periodsPerYear multiplication that ignores
  // job.budgetPeriodsPerMonth.
  let netMonthlyIncome: number | null = null;
  try {
    const incomePaycheckData = await computePaycheckSummary(ctx, {
      ...summaryProfileIdsInput(profiles),
      ...(input?.sandboxSalaryEntries
        ? { sandboxSalaryEntries: input.sandboxSalaryEntries }
        : {}),
      ...(input?.sandboxDeductionEdits
        ? { sandboxDeductionEdits: input.sandboxDeductionEdits }
        : {}),
      ...(input?.sandboxDeductionAdditions
        ? { sandboxDeductionAdditions: input.sandboxDeductionAdditions }
        : {}),
      ...(input?.sandboxContribActiveFields
        ? { sandboxContribActiveFields: input.sandboxContribActiveFields }
        : {}),
      ...(input?.sandboxContribAdditions
        ? { sandboxContribAdditions: input.sandboxContribAdditions }
        : {}),
    });
    netMonthlyIncome = netMonthlyTakeHome(incomePaycheckData);
  } catch (err) {
    // Supplementary figure for the What-If tab's income handoff — a
    // failure here (e.g. malformed contribution-account data elsewhere
    // in the household) must not take down the budget items themselves.
    log("warn", "computeActiveSummary.netMonthlyIncome_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    profile: activeProfile,
    result,
    columnLabels,
    allColumnResults,
    rawItems,
    columnMonths,
    weightedAnnualTotal,
    /** Monthly take-home for the profile pair in use — see the
     *  computation above for why this must be read
     *  instead of re-deriving income client-side. */
    netMonthlyIncome,
    /** Sum of Budget-mode extra-paycheck adjustments landing in the
     *  REAL current calendar month — independent of selectedColumn, see
     *  computation above. A separate, additively-labeled figure; never
     *  folded into netMonthlyIncome or any What-If total. */
    budgetIncomeAdjustmentThisMonth,
  };
}
