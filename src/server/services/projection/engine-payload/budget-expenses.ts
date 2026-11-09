/**
 * The plan's yearly spending before and after retirement: each phase's
 * budget profile and column (the household's active ones unless the
 * caller picks others), with contribution-linked items resolved to real
 * dollars, or the caller's flat override.
 */
import type * as schema from "@/lib/db/schema";
import { pickActiveBudgetProfile } from "@/lib/pure/budget/active-profile";
import { resolveLinkedBudgetItemAmounts } from "@/server/services/budget/linked-items";
import { computeBudgetAnnualTotal } from "@/lib/pure/budget/annual-total";
import type { Db } from "@/lib/db";

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
      asOf: Date;
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
  // A picked profile that no longer exists falls back to the active one
  // rather than silently making the phase's spending $0.
  const accProfile =
    (opts.accumulationBudgetProfileId
      ? allBudgetProfiles.find((p) => p.id === opts.accumulationBudgetProfileId)
      : undefined) ?? defaultProfile;
  const accMaxCol = Math.max(0, accProfile?.columnLabels.length ?? 1) - 1;
  const accCol = Math.min(
    Math.max(0, opts.accumulationBudgetColumn ?? globalActiveCol),
    accMaxCol,
  );
  const accItems = accProfile
    ? allBudgetItems.filter((i) => i.profileId === accProfile.id)
    : [];
  // Decumulation phase: profile + column
  const decProfile =
    (opts.decumulationBudgetProfileId
      ? allBudgetProfiles.find((p) => p.id === opts.decumulationBudgetProfileId)
      : undefined) ?? defaultProfile;
  const decumulationMaxCol =
    Math.max(0, decProfile?.columnLabels.length ?? 1) - 1;
  const decCol = Math.min(
    Math.max(0, opts.decumulationBudgetColumn ?? globalActiveCol),
    decumulationMaxCol,
  );
  const decumulationItems = decProfile
    ? allBudgetItems.filter((i) => i.profileId === decProfile.id)
    : [];

  const accMonths = (accProfile?.columnMonths as number[] | null) ?? null;
  const decumulationMonths =
    (decProfile?.columnMonths as number[] | null) ?? null;
  // Resolved through the same contribution-account chain
  // computeActiveSummary uses (see resolveLinkedBudgetItemAmounts) rather
  // than raw `amounts`, which is intentionally stale for contribution-linked
  // items — reading it directly here silently dropped every linked item's
  // dollar amount from accumulation/decumulation expenses.
  const accNumColumns = accProfile?.columnLabels.length ?? 1;
  const decumulationNumColumns = decProfile?.columnLabels.length ?? 1;
  const dated = { db, scope: { asOf: opts.asOf } };
  const resolvedAccItems = opts.accumulationExpenseOverride
    ? accItems
    : await resolveLinkedBudgetItemAmounts(dated, accItems, accNumColumns, {
        contribProfileId: opts.contributionProfileId ?? null,
        salaryProfileId: opts.salaryProfileId ?? null,
      });
  const resolvedDecumulationItems = opts.decumulationExpenseOverride
    ? decumulationItems
    : await resolveLinkedBudgetItemAmounts(
        dated,
        decumulationItems,
        decumulationNumColumns,
        {
          contribProfileId: opts.contributionProfileId ?? null,
          salaryProfileId: opts.salaryProfileId ?? null,
        },
      );
  const accumulationExpenses =
    opts.accumulationExpenseOverride ??
    computeBudgetAnnualTotal(resolvedAccItems, accCol, accMonths);
  const decumulationExpenses =
    opts.decumulationExpenseOverride ??
    computeBudgetAnnualTotal(
      resolvedDecumulationItems,
      decCol,
      decumulationMonths,
    );
  return {
    accProfile,
    accCol,
    decProfile,
    decCol,
    accumulationExpenses,
    /** The part of that budget that is contribution lines. */
    accumulationContributionLines: opts.accumulationExpenseOverride
      ? 0
      : computeBudgetAnnualTotal(
          resolvedAccItems.filter((i) => i.contributionAccountId != null),
          accCol,
          accMonths,
        ),
    decumulationExpenses,
  };
}
