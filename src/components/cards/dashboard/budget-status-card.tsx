"use client";

import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/format";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { LoadingCard, ErrorCard } from "./utils";

export function BudgetStatusCard() {
  const [activeColumn] = usePersistedSetting<number>("budget_active_column", 0);
  const { data, isLoading, error } = trpc.budget.getActiveSummary.useQuery({
    selectedColumn: activeColumn,
  });
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

  return (
    <Card
      title="Budget"
      subtitle={`${data.profile?.name} — ${modeName}`}
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
        <span>Disc: {formatCurrency(result.discretionaryTotal)}</span>
      </div>
    </Card>
  );
}
