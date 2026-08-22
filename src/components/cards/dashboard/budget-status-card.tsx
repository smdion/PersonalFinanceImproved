"use client";

import { memo } from "react";

import { trpc } from "@/lib/trpc";
import { Card, ProgressBar } from "@/components/ui/card";
import { formatCurrency, formatDate, formatPercent } from "@/lib/utils/format";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useActiveSalaryProfile } from "@/lib/hooks/use-active-salary-profile";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useBudgetProfilesList } from "@/lib/hooks/use-budget-profiles-list";
import { safeDivide, sumBy } from "@/lib/utils/math";
import { LoadingCard, ErrorCard } from "./utils";

const TOP_CATEGORY_COUNT = 3;

function BudgetStatusCardImpl() {
  const [activeColumn] = usePersistedSetting<number>("budget_active_column", 0);
  // Same three-tier resolution (Plan pin -> [no local view here] -> globally
  // active) budget-content.tsx uses — without this, the card always shows
  // the globally-active budget profile regardless of what a Plan pins,
  // unlike the Salary/Contribution axes below which already resolve this.
  const { data: budgetProfilesList } = useBudgetProfilesList();
  const globalActiveBudgetId =
    budgetProfilesList?.find((p) => p.isActive)?.id ?? null;
  const { profileId: displayBudgetProfileId, isPinned: isBudgetPinned } =
    useEffectiveProfileId("budget", {
      validIds: budgetProfilesList?.map((p) => p.id),
      localSelection: null,
      globalDefaultId: globalActiveBudgetId,
    });
  const [activeContribProfileId] = useActiveContribProfile();
  const { data: contribProfilesList } =
    trpc.contributionProfile.list.useQuery();
  const { planPinId: planContribProfileId } = useEffectiveProfileId(
    "contribution",
    {
      validIds: contribProfilesList?.map((p) => p.id),
      localSelection: null,
      globalDefaultId: activeContribProfileId,
    },
  );
  const [rawActiveSalaryProfileId] = useActiveSalaryProfile();
  const { data: salaryProfilesList } = trpc.salaryProfile.list.useQuery();
  const { planPinId: planSalaryProfileId } = useEffectiveProfileId("salary", {
    validIds: salaryProfilesList?.map((p) => p.id),
    localSelection: null,
    globalDefaultId: rawActiveSalaryProfileId,
  });
  const { data, isLoading, error } = trpc.budget.computeActiveSummary.useQuery({
    selectedColumn: activeColumn,
    ...(displayBudgetProfileId != null
      ? { profileId: displayBudgetProfileId }
      : {}),
    contributionProfile: {
      planPinId: planContribProfileId,
      localSelectionId: null,
      globalDefaultId: activeContribProfileId,
    },
    salaryProfile: {
      planPinId: planSalaryProfileId,
      localSelectionId: null,
      globalDefaultId: rawActiveSalaryProfileId,
    },
  });
  const { data: actualsData } = trpc.budget.listApiActuals.useQuery();
  if (isLoading) return <LoadingCard title="Budget" />;
  if (error) return <ErrorCard title="Budget" message="Failed to load" />;
  if (!data?.result)
    return (
      <Card title="Budget" href="/budget">
        <p className="text-sm text-faint">
          Create a budget profile on the Budget page to track spending.
        </p>
      </Card>
    );

  const { result, columnLabels, columnMonths, weightedAnnualTotal } = data;
  const modeName = columnMonths
    ? "Weighted"
    : ((columnLabels as string[])?.[activeColumn] ?? "Standard");
  const displayMonthly = columnMonths
    ? (weightedAnnualTotal ?? 0) / 12
    : result.totalMonthly;

  // Actual spend this month, from linked API categories (YNAB/Actual) — a
  // "how am I actually doing" signal alongside the static plan total above.
  const actuals = actualsData?.actuals ?? [];
  const actualBudgeted = sumBy(actuals, (a) => a.budgeted);
  const actualSpent = sumBy(actuals, (a) => Math.max(0, -a.activity));
  const spentPercent = safeDivide(actualSpent, actualBudgeted, null);
  const isOverBudget = spentPercent !== null && spentPercent > 1;

  const topCategories = [...result.categories]
    .sort((a, b) => b.total - a.total)
    .slice(0, TOP_CATEGORY_COUNT);
  const categoriesTotal = sumBy(result.categories, (c) => c.total);

  return (
    <Card
      title="Budget"
      subtitle={`${data.profile?.name}${isBudgetPinned ? " (pinned)" : ""} — ${modeName}`}
      href="/budget"
    >
      <div className="flex items-baseline justify-between">
        <span className="text-lg font-semibold">
          {formatCurrency(displayMonthly)}
        </span>
        <span className="text-xs text-faint">
          /month{columnMonths ? " avg" : ""}
        </span>
      </div>
      <div className="mt-2 flex gap-3 text-xs text-muted">
        <span>Essential: {formatCurrency(result.essentialTotal)}</span>
        <span>Discretionary: {formatCurrency(result.discretionaryTotal)}</span>
      </div>

      {actualsData?.service && actuals.length > 0 && (
        <div className="mt-3">
          <ProgressBar
            value={spentPercent ?? 0}
            label="Spent this month"
            variant={isOverBudget ? "danger" : "success"}
            tooltip={`${formatCurrency(actualSpent)} spent of ${formatCurrency(actualBudgeted)} budgeted (linked categories only)`}
          />
        </div>
      )}

      {topCategories.length > 0 && (
        <div className="mt-3 pt-3 border-t border-subtle space-y-1">
          {topCategories.map((c) => (
            <div
              key={c.name}
              className="flex justify-between text-xs text-faint"
            >
              <span>{c.name}</span>
              <span className="flex items-center gap-1.5">
                {formatCurrency(c.total)}
                {categoriesTotal > 0 && (
                  // lint-violation-ok: guarded by categoriesTotal > 0 above
                  <span>({formatPercent(c.total / categoriesTotal, 0)})</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {actualsData?.month && (
        <p className="text-caption text-faint mt-2">
          Synced for {formatDate(actualsData.month, "short")}
        </p>
      )}
    </Card>
  );
}

export const BudgetStatusCard = memo(BudgetStatusCardImpl);
