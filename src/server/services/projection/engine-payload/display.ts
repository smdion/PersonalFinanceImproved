/** What the payload returns for the UI only: no engine input reads it. */
import type { Db } from "@/lib/db";
import { resolveLinkedBudgetItemAmounts } from "@/server/services/budget/linked-items";
import { roundToCents, sumBy } from "@/lib/utils/math";
import type { fetchRetirementData } from "./load";

/**
 * Each budget profile's column totals (the budget override's "from
 * profile" choices), with linked items at the amount their contribution
 * account resolves to, not the stale `amounts` column.
 */
export async function budgetSummaries(
  allBudgetProfiles: Awaited<
    ReturnType<typeof fetchRetirementData>
  >["allBudgetProfiles"],
  allBudgetItems: Awaited<
    ReturnType<typeof fetchRetirementData>
  >["allBudgetItems"],
  db: Db,
  opts: {
    asOf: Date;
    contributionProfileId?: number;
    salaryProfileId?: number;
  },
) {
  const budgetProfileSummaries = await Promise.all(
    allBudgetProfiles.map(async (p) => {
      const items = allBudgetItems.filter((i) => i.profileId === p.id);
      const labels = p.columnLabels;
      const months = (p.columnMonths as number[] | null) ?? null;
      const numColumns = labels.length;
      const resolvedItems = await resolveLinkedBudgetItemAmounts(
        { db, scope: { asOf: opts.asOf } },
        items,
        numColumns,
        {
          contribProfileId: opts.contributionProfileId ?? null,
          salaryProfileId: opts.salaryProfileId ?? null,
        },
      );
      const totals = labels.map((_: string, colIndex: number) =>
        sumBy(resolvedItems, (item) => item.amounts[colIndex] ?? 0),
      );
      const weightedAnnualTotal = months
        ? roundToCents(
            sumBy(
              totals.map((t, i) => t * (months[i] ?? 0)),
              (v) => v,
            ),
          )
        : null;
      return {
        id: p.id,
        name: p.name,
        isActive: p.isActive,
        columnLabels: labels,
        columnMonths: months,
        columnTotals: totals,
        weightedAnnualTotal,
      };
    }),
  );

  return { budgetProfileSummaries };
}
