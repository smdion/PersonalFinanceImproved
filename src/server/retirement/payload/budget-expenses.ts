/**
 * The plan's yearly spending before and after retirement: each phase's
 * budget profile and column (the household's active ones unless the
 * caller picks others), with contribution-linked items resolved to real
 * dollars, or the caller's flat override.
 */
import type { db as _db } from "@/lib/db";
import type * as schema from "@/lib/db/schema";
import {
  computeBudgetAnnualTotal,
  pickActiveBudgetProfile,
  resolveLinkedBudgetItemAmounts,
} from "@/server/helpers";

type Db = typeof _db;

export async function resolvePhaseExpenses(
  db: Db,
  {
    allBudgetProfiles,
    allBudgetItems,
    globalActiveCol,
    opts,
  }: {
    allBudgetProfiles: (typeof schema.budgetProfiles.$inferSelect)[];
    allBudgetItems: (typeof schema.budgetItems.$inferSelect)[];
    globalActiveCol: number;
    opts: {
      contributionProfileId?: number;
      salaryProfileId?: number;
      accumulationBudgetProfileId?: number;
      accumulationBudgetColumn?: number;
      accumulationExpenseOverride?: number;
      decumulationBudgetProfileId?: number;
      decumulationBudgetColumn?: number;
      decumulationExpenseOverride?: number;
    };
  },
) {
  const defaultProfile = pickActiveBudgetProfile(allBudgetProfiles);
  // Accumulation phase: profile + column
  const accProfile = opts.accumulationBudgetProfileId
    ? allBudgetProfiles.find((p) => p.id === opts.accumulationBudgetProfileId)
    : defaultProfile;
  const accMaxCol =
    Math.max(0, (accProfile?.columnLabels as string[] | null)?.length ?? 1) - 1;
  const accCol = Math.min(
    Math.max(0, opts.accumulationBudgetColumn ?? globalActiveCol),
    accMaxCol,
  );
  const accItems = accProfile
    ? allBudgetItems.filter((i) => i.profileId === accProfile.id)
    : [];
  // Decumulation phase: profile + column
  const decProfile = opts.decumulationBudgetProfileId
    ? allBudgetProfiles.find((p) => p.id === opts.decumulationBudgetProfileId)
    : defaultProfile;
  const decMaxCol =
    Math.max(0, (decProfile?.columnLabels as string[] | null)?.length ?? 1) - 1;
  const decCol = Math.min(
    Math.max(0, opts.decumulationBudgetColumn ?? globalActiveCol),
    decMaxCol,
  );
  const decItems = decProfile
    ? allBudgetItems.filter((i) => i.profileId === decProfile.id)
    : [];

  const accMonths = (accProfile?.columnMonths as number[] | null) ?? null;
  const decMonths = (decProfile?.columnMonths as number[] | null) ?? null;
  // Resolved through the same contribution-account chain
  // computeActiveSummary uses (see resolveLinkedBudgetItemAmounts) rather
  // than raw `amounts`, which is intentionally stale for contribution-linked
  // items — reading it directly here silently dropped every linked item's
  // dollar amount from accumulation/decumulation expenses.
  const accNumColumns =
    (accProfile?.columnLabels as string[] | null)?.length ?? 1;
  const decNumColumns =
    (decProfile?.columnLabels as string[] | null)?.length ?? 1;
  const resolvedAccItems = opts.accumulationExpenseOverride
    ? accItems
    : await resolveLinkedBudgetItemAmounts(db, accItems, accNumColumns, {
        contribProfileId: opts.contributionProfileId ?? null,
        salaryProfileId: opts.salaryProfileId ?? null,
      });
  const resolvedDecItems = opts.decumulationExpenseOverride
    ? decItems
    : await resolveLinkedBudgetItemAmounts(db, decItems, decNumColumns, {
        contribProfileId: opts.contributionProfileId ?? null,
        salaryProfileId: opts.salaryProfileId ?? null,
      });
  const accumulationExpenses =
    opts.accumulationExpenseOverride ??
    computeBudgetAnnualTotal(resolvedAccItems, accCol, accMonths);
  const decumulationExpenses =
    opts.decumulationExpenseOverride ??
    computeBudgetAnnualTotal(resolvedDecItems, decCol, decMonths);
  return {
    accProfile,
    accCol,
    decProfile,
    decCol,
    accumulationExpenses,
    decumulationExpenses,
  };
}
