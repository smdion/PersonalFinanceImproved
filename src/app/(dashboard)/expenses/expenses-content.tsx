"use client";

/** Client content for the Expenses page — prefetched by page.tsx. */

import { useState, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/ui/page-header";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useActiveSalaries } from "@/lib/hooks/use-salary-overrides";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { CardBoundary } from "@/components/cards/dashboard/utils";
// Imported from the leaf module, not the @/lib/budget-api barrel — the
// barrel also re-exports cache.ts (drizzle-orm + DB schema), which is
// server-only. Importing through the barrel pulled the whole server-side
// dependency graph into this client bundle (~540KB, see check:bundle).
import { YNAB_EXPENSE_EXCLUDED_GROUPS } from "@/lib/budget-api/ynab-client";
import {
  EXPENSE_PIE_COLORS,
  essentialColor,
  discretionaryColor,
  overUnderTextColor,
} from "@/lib/utils/colors";
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";
import { useActiveSalaryProfile } from "@/lib/hooks/use-active-salary-profile";
import { useBudgetProfilesList } from "@/lib/hooks/use-budget-profiles-list";

// Code-split the recharts-heavy chart row. Both
// charts share a single chunk so the recharts payload is fetched once on
// page mount instead of bundling into the page chunk. ssr:false because
// Recharts isn't SSR-friendly.
const BudgetVsActualBar = dynamic(
  () =>
    import("@/components/expenses/expenses-charts").then((m) => ({
      default: m.BudgetVsActualBar,
    })),
  { loading: () => <SkeletonChart />, ssr: false },
);
const SpendingPie = dynamic(
  () =>
    import("@/components/expenses/expenses-charts").then((m) => ({
      default: m.SpendingPie,
    })),
  { loading: () => <SkeletonChart />, ssr: false },
);

// ── Types ──

type ApiCategoryGroup = {
  id: string;
  name: string;
  categories: {
    id: string;
    name: string;
    budgeted: number;
    activity: number;
    balance: number;
  }[];
};

// ── Helpers ──

function formatSafePercent(value: number, total: number): string {
  if (total === 0) return "—";
  return formatPercent(safeDivide(value, total, 0)!, 1);
}

// ── Component ──

export function ExpensesContent() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [periodType, setPeriodType] = useState<"month" | "quarter" | "ytd">(
    "month",
  );
  const [activeContribProfileId] = usePersistedSetting<number | null>(
    "active_contrib_profile_id",
    null,
  );
  const [activeColumn] = usePersistedSetting<number>("budget_active_column", 0);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // ── Data queries ──

  const { data: apiCategories } = trpc.budget.listApiCategories.useQuery();
  const { data: apiActuals } = trpc.budget.listApiActuals.useQuery();
  const { data: budgetProfilesList } = useBudgetProfilesList();
  const { data: contribProfilesList } =
    trpc.contributionProfile.list.useQuery();

  // Salary overrides from scenario context (used by all pages) — mirrors
  // paycheck/page.tsx so a what-if salary scenario stays holistic across pages.
  const scenarioActiveSalaries = useActiveSalaries();
  // Independent Salary Profile axis (Plan pin -> globally-active setting).
  const { queryInput: salaryProfileInput } = useEffectiveSalaryProfileId();
  const [rawActiveSalaryProfileId] = useActiveSalaryProfile();
  const { data: salaryProfilesList } = trpc.salaryProfile.list.useQuery();
  const { planPinId: planSalaryProfileId } = useEffectiveProfileId("salary", {
    validIds: salaryProfilesList?.map((p) => p.id),
    localSelection: null,
    globalDefaultId: rawActiveSalaryProfileId,
  });

  // Plan pin -> globally-active profile for both budget and contribution —
  // this page has no local viewing picker of its own, so localSelection is
  // always null (single computation path — see useEffectiveProfileId).
  const activeBudgetProfileId =
    budgetProfilesList?.find((p) => p.isActive)?.id ?? null;
  const { profileId: effectiveBudgetProfileId } = useEffectiveProfileId(
    "budget",
    {
      validIds: budgetProfilesList?.map((p) => p.id),
      localSelection: null,
      globalDefaultId: activeBudgetProfileId,
    },
  );
  const {
    profileId: effectiveContribProfileId,
    planPinId: planContribProfileId,
  } = useEffectiveProfileId("contribution", {
    validIds: contribProfilesList?.map((p) => p.id),
    localSelection: null,
    globalDefaultId: activeContribProfileId,
  });

  const { data: budgetData } = trpc.budget.computeActiveSummary.useQuery({
    selectedColumn: activeColumn,
    ...(effectiveBudgetProfileId != null
      ? { profileId: effectiveBudgetProfileId }
      : {}),
    // Tiers, not a pre-resolved id — the Plan pin has to stay in its own tier
    // or a budget column's pin would outrank it (docs/RULES.md "Profile Pins").
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
    ...(scenarioActiveSalaries.length > 0
      ? { salaryActiveFields: scenarioActiveSalaries }
      : {}),
  });

  const paycheckInput = {
    ...(scenarioActiveSalaries.length > 0
      ? { salaryActiveFields: scenarioActiveSalaries }
      : {}),
    ...(effectiveContribProfileId != null
      ? { contributionProfileId: effectiveContribProfileId }
      : {}),
    ...salaryProfileInput,
  };
  const { data: paycheckData } = trpc.paycheck.computeSummary.useQuery(
    Object.keys(paycheckInput).length > 0 ? paycheckInput : undefined,
  );

  // Year-over-year comparison dates
  const { currentStart, currentEnd, priorStart, priorEnd, periodLabel } =
    useMemo(() => {
      const pad = (n: number) => String(n).padStart(2, "0");

      if (periodType === "month") {
        const cs = `${currentYear}-${pad(currentMonth)}-01`;
        const lastDay = new Date(currentYear, currentMonth, 0).getDate();
        const ce = `${currentYear}-${pad(currentMonth)}-${pad(lastDay)}`;
        const ps = `${currentYear - 1}-${pad(currentMonth)}-01`;
        const priorLastDay = new Date(
          currentYear - 1,
          currentMonth,
          0,
        ).getDate();
        const pe = `${currentYear - 1}-${pad(currentMonth)}-${pad(priorLastDay)}`;
        return {
          currentStart: cs,
          currentEnd: ce,
          priorStart: ps,
          priorEnd: pe,
          periodLabel: `${pad(currentMonth)}/${currentYear}`,
        };
      }
      if (periodType === "quarter") {
        const q = Math.ceil(currentMonth / 3);
        const qStart = (q - 1) * 3 + 1;
        const qEnd = q * 3;
        const lastDay = new Date(currentYear, qEnd, 0).getDate();
        const cs = `${currentYear}-${pad(qStart)}-01`;
        const ce = `${currentYear}-${pad(qEnd)}-${pad(lastDay)}`;
        const priorLastDay = new Date(currentYear - 1, qEnd, 0).getDate();
        const ps = `${currentYear - 1}-${pad(qStart)}-01`;
        const pe = `${currentYear - 1}-${pad(qEnd)}-${pad(priorLastDay)}`;
        return {
          currentStart: cs,
          currentEnd: ce,
          priorStart: ps,
          priorEnd: pe,
          periodLabel: `Q${q} ${currentYear}`,
        };
      }
      const cs = `${currentYear}-01-01`;
      const lastDay = new Date(currentYear, currentMonth, 0).getDate();
      const ce = `${currentYear}-${pad(currentMonth)}-${pad(lastDay)}`;
      const ps = `${currentYear - 1}-01-01`;
      const priorLastDay = new Date(currentYear - 1, currentMonth, 0).getDate();
      const pe = `${currentYear - 1}-${pad(currentMonth)}-${pad(priorLastDay)}`;
      return {
        currentStart: cs,
        currentEnd: ce,
        priorStart: ps,
        priorEnd: pe,
        periodLabel: `YTD ${currentYear}`,
      };
    }, [periodType, currentYear, currentMonth]);

  const { data: yoyData, isLoading: yoyLoading } =
    trpc.sync.computeExpenseComparison.useQuery({
      currentStart,
      currentEnd,
      priorStart,
      priorEnd,
    });

  // ── Derived data ──

  // Monthly net income from paycheck
  const monthlyNetIncome = useMemo(() => {
    if (!paycheckData?.people) return 0;
    return paycheckData.people.reduce((sum, p) => {
      if (!p.paycheck) return sum;
      return sum + (p.paycheck.netPay * p.paycheck.periodsPerYear) / 12;
    }, 0);
  }, [paycheckData]);

  // Build budget-vs-actual by matching API categories to budget items
  const budgetVsActual = useMemo(() => {
    const groups = (apiCategories?.groups ?? []) as ApiCategoryGroup[];
    // budgetData.result is null on the router's "no active profile" branch
    // (the only branch without rawItems) and the real result otherwise —
    // narrowing on it gives properly-typed rawItems access with no cast.
    const items = budgetData?.result ? budgetData.rawItems : [];
    const itemMap = new Map(
      items.filter((i) => i.apiCategoryId).map((i) => [i.apiCategoryId!, i]),
    );

    const rows: {
      group: string;
      category: string;
      budgeted: number;
      actual: number;
      diff: number;
      isEssential: boolean;
    }[] = [];

    for (const g of groups) {
      if (YNAB_EXPENSE_EXCLUDED_GROUPS.has(g.name)) continue;
      for (const c of g.categories) {
        // YNAB: negative activity = outflow (spending), positive = inflow (savings allocation).
        // Only count outflows as actual spending.
        const actual = c.activity < 0 ? Math.abs(c.activity) : 0;
        const linkedItem = itemMap.get(c.id);
        // Use API budgeted (same source as activity) for apples-to-apples comparison
        const budgetedMonthly = c.budgeted > 0 ? c.budgeted : 0;
        if (actual === 0 && budgetedMonthly === 0) continue;
        rows.push({
          group: g.name,
          category: c.name,
          budgeted: budgetedMonthly,
          actual,
          diff: actual - budgetedMonthly,
          isEssential: linkedItem?.isEssential ?? true,
        });
      }
    }

    return rows;
  }, [apiCategories, budgetData]);

  // Group-level summary for chart
  const groupSummary = useMemo(() => {
    const map = new Map<
      string,
      { budgeted: number; actual: number; isEssential: boolean }
    >();
    for (const r of budgetVsActual) {
      const existing = map.get(r.group) ?? {
        budgeted: 0,
        actual: 0,
        isEssential: true,
      };
      existing.budgeted += r.budgeted;
      existing.actual += r.actual;
      if (!r.isEssential) existing.isEssential = false;
      map.set(r.group, existing);
    }
    return Array.from(map.entries())
      .map(([name, data]) => ({
        name,
        budgeted: Math.round(data.budgeted),
        actual: Math.round(data.actual),
        diff: Math.round(data.actual - data.budgeted),
        isEssential: data.isEssential,
      }))
      .filter((g) => g.actual > 0 || g.budgeted > 0)
      .sort((a, b) => b.actual - a.actual);
  }, [budgetVsActual]);

  // Spending by category for pie chart
  const spendingPie = useMemo(() => {
    return groupSummary
      .filter((g) => g.actual > 0)
      .map((g, i) => ({
        name: g.name,
        value: g.actual,
        color: EXPENSE_PIE_COLORS[i % EXPENSE_PIE_COLORS.length],
      }));
  }, [groupSummary]);

  // Essential vs discretionary totals
  const { essentialTotal, discretionaryTotal, totalActual, totalBudgeted } =
    useMemo(() => {
      let essential = 0;
      let discretionary = 0;
      let budgeted = 0;
      for (const r of budgetVsActual) {
        if (r.isEssential) essential += r.actual;
        else discretionary += r.actual;
        budgeted += r.budgeted;
      }
      return {
        essentialTotal: essential,
        discretionaryTotal: discretionary,
        totalActual: essential + discretionary,
        totalBudgeted: budgeted,
      };
    }, [budgetVsActual]);

  const savingsRate = useMemo(
    () =>
      monthlyNetIncome > 0
        ? (monthlyNetIncome - totalActual) / monthlyNetIncome
        : 0,
    [monthlyNetIncome, totalActual],
  );

  const toggleGroup = useCallback((name: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  // ── No API fallback ──

  if (!apiActuals?.service && !yoyData?.service) {
    return (
      <div>
        <PageHeader title="Expenses" />
        <p className="text-muted mt-4 text-sm">
          Connect and sync a budget API to view expense data.
        </p>
      </div>
    );
  }

  // ── Render ──

  return (
    <div>
      <PageHeader title="Expenses" />

      {/* ── Summary Bar ── */}
      <CardBoundary title="Expense Summary">
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard
            label="Monthly Net Income"
            value={formatCurrency(monthlyNetIncome)}
            sub="from paycheck"
            color="text-primary"
          />
          <SummaryCard
            label="Total Budgeted"
            value={formatCurrency(totalBudgeted)}
            sub="this month"
            color="text-primary"
          />
          <SummaryCard
            label="Actual Spending"
            value={formatCurrency(totalActual)}
            sub={totalActual > totalBudgeted ? "over budget" : "under budget"}
            color={overUnderTextColor(totalActual - totalBudgeted)}
          />
          <SummaryCard
            label="Savings Rate"
            value={monthlyNetIncome > 0 ? formatPercent(savingsRate, 1) : "—"}
            sub={
              formatCurrency(Math.max(0, monthlyNetIncome - totalActual)) +
              " saved"
            }
            color={
              savingsRate >= 0.2
                ? "text-green-600"
                : savingsRate >= 0.1
                  ? "text-amber-600"
                  : "text-red-600"
            }
          />
        </div>
      </CardBoundary>

      {/* ── Charts Row ── */}
      <CardBoundary title="Budget vs Actual Charts">
        {groupSummary.length > 0 && (
          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Budget vs Actual Bar Chart */}
            <div className="bg-surface-primary rounded-lg border p-4 lg:col-span-2">
              <h3 className="text-muted mb-3 text-xs font-semibold tracking-wider uppercase">
                Budget vs Actual — This Month
              </h3>
              <BudgetVsActualBar data={groupSummary} />
            </div>

            {/* Spending Breakdown Pie */}
            <div className="bg-surface-primary rounded-lg border p-4">
              <h3 className="text-muted mb-3 text-xs font-semibold tracking-wider uppercase">
                Spending Breakdown
              </h3>
              {spendingPie.length > 0 ? (
                <SpendingPie data={spendingPie} />
              ) : (
                <p className="text-faint py-8 text-center text-xs">
                  No spending data
                </p>
              )}

              {/* Essential vs Discretionary mini-bar */}
              {totalActual > 0 && (
                <div className="mt-3 space-y-1">
                  <div className="text-caption text-muted flex justify-between">
                    <span>
                      Essential {formatSafePercent(essentialTotal, totalActual)}
                    </span>
                    <span>
                      Discretionary{" "}
                      {formatSafePercent(discretionaryTotal, totalActual)}
                    </span>
                  </div>
                  <div className="bg-surface-elevated flex h-2 overflow-hidden rounded-full">
                    <div
                      className={`${essentialColor()} transition-all`}
                      style={{
                        width: `${(essentialTotal / totalActual) * 100}%`,
                      }}
                    />
                    <div
                      className={`${discretionaryColor()} transition-all`}
                      style={{
                        width: `${(discretionaryTotal / totalActual) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </CardBoundary>

      {/* ── Category Detail Table ── */}
      <CardBoundary title="Category Detail">
        {budgetVsActual.length > 0 && (
          <div className="bg-surface-primary mb-6 rounded-lg border p-4">
            <h3 className="text-muted mb-3 text-xs font-semibold tracking-wider uppercase">
              Category Detail — This Month
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-strong border-b-2">
                    <th className="text-muted py-2 pr-3 text-left font-medium">
                      Category
                    </th>
                    <th className="text-muted px-3 py-2 text-right font-medium">
                      Budgeted
                    </th>
                    <th className="text-muted px-3 py-2 text-right font-medium">
                      Actual
                    </th>
                    <th className="text-muted px-3 py-2 text-right font-medium">
                      Diff
                    </th>
                    <th className="text-muted w-32 px-3 py-2 text-right font-medium">
                      % Used
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groupSummary.map((group) => {
                    const isExpanded = expandedGroups.has(group.name);
                    const groupItems = budgetVsActual.filter(
                      (r) => r.group === group.name,
                    );
                    const percentUsed =
                      group.budgeted > 0
                        ? group.actual / group.budgeted
                        : group.actual > 0
                          ? 999
                          : 0;
                    return (
                      <GroupRows
                        key={group.name}
                        group={group}
                        items={groupItems}
                        isExpanded={isExpanded}
                        onToggle={() => toggleGroup(group.name)}
                        percentUsed={percentUsed}
                      />
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-strong border-t-2 font-semibold">
                    <td className="text-primary py-2 pr-3">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(totalBudgeted)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(totalActual)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${overUnderTextColor(totalActual - totalBudgeted)}`}
                    >
                      {formatCurrency(Math.abs(totalActual - totalBudgeted))}
                      {totalActual > totalBudgeted ? " over" : " under"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <ProgressBar
                        value={safeDivide(totalActual, totalBudgeted, 0)}
                      />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </CardBoundary>

      {/* ── Year-over-Year Comparison ── */}
      <CardBoundary title="Year-over-Year Comparison">
        <div className="bg-surface-primary rounded-lg border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-muted text-xs font-semibold tracking-wider uppercase">
              Year-over-Year Comparison
            </h3>
            <div className="flex items-center gap-2">
              {(["month", "quarter", "ytd"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriodType(p)}
                  className={`rounded px-3 py-1 text-xs font-medium ${
                    periodType === p
                      ? "bg-blue-600 text-white"
                      : "bg-surface-elevated text-muted hover:bg-surface-strong"
                  }`}
                >
                  {p === "ytd" ? "YTD" : p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
              <span className="text-muted ml-2 text-xs">
                {periodLabel} vs {currentYear - 1}
              </span>
            </div>
          </div>

          {yoyLoading ? (
            <SkeletonChart height={128} />
          ) : yoyData?.categories && yoyData.categories.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-strong border-b-2">
                    <th className="text-muted py-2 pr-3 text-left font-medium">
                      Category
                    </th>
                    <th className="text-muted px-3 py-2 text-right font-medium">
                      {currentYear}
                    </th>
                    <th className="text-muted px-3 py-2 text-right font-medium">
                      {currentYear - 1}
                    </th>
                    <th className="text-muted px-3 py-2 text-right font-medium">
                      Diff
                    </th>
                    <th className="text-muted px-3 py-2 text-right font-medium">
                      % Change
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {yoyData.categories.map((cat) => (
                    <tr
                      key={cat.name}
                      className="border-subtle border-b hover:bg-blue-50/60"
                    >
                      <td className="text-secondary py-1.5 pr-3">{cat.name}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {formatCurrency(Math.abs(cat.current))}
                      </td>
                      <td className="text-muted px-3 py-1.5 text-right tabular-nums">
                        {formatCurrency(Math.abs(cat.prior))}
                      </td>
                      <td
                        className={`px-3 py-1.5 text-right tabular-nums ${overUnderTextColor(cat.diff)}`}
                      >
                        {cat.diff !== 0
                          ? formatCurrency(Math.abs(cat.diff))
                          : "—"}
                        {cat.diff < 0 ? " less" : cat.diff > 0 ? " more" : ""}
                      </td>
                      <td
                        className={`px-3 py-1.5 text-right tabular-nums ${overUnderTextColor(cat.percentChange ?? 0)}`}
                      >
                        {cat.percentChange !== null
                          ? `${cat.percentChange > 0 ? "+" : ""}${formatPercent(cat.percentChange / 100, 1)}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-strong border-t-2 font-semibold">
                    <td className="py-2 pr-3">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(
                        Math.abs(
                          yoyData.categories.reduce((s, c) => s + c.current, 0),
                        ),
                      )}
                    </td>
                    <td className="text-muted px-3 py-2 text-right tabular-nums">
                      {formatCurrency(
                        Math.abs(
                          yoyData.categories.reduce((s, c) => s + c.prior, 0),
                        ),
                      )}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="text-faint py-4 text-center text-xs">
              No comparison data available for this period.
            </p>
          )}
        </div>
      </CardBoundary>
    </div>
  );
}

// ── Sub-components ──

function SummaryCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="bg-surface-primary rounded-lg border p-3">
      <div className="text-caption text-muted font-medium tracking-wider uppercase">
        {label}
      </div>
      <div className={`text-lg font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-caption text-faint">{sub}</div>
    </div>
  );
}

function GroupRows({
  group,
  items,
  isExpanded,
  onToggle,
  percentUsed,
}: {
  group: {
    name: string;
    budgeted: number;
    actual: number;
    diff: number;
    isEssential: boolean;
  };
  items: {
    category: string;
    budgeted: number;
    actual: number;
    diff: number;
    isEssential: boolean;
  }[];
  isExpanded: boolean;
  onToggle: () => void;
  percentUsed: number;
}) {
  return (
    <>
      <tr
        className="bg-surface-sunken hover:bg-surface-elevated cursor-pointer border-b"
        onClick={onToggle}
      >
        <td className="text-primary py-1.5 pr-3 font-semibold">
          <span className="flex items-center gap-1.5">
            <svg
              aria-hidden="true"
              className={`text-faint h-2.5 w-2.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5l7 7-7 7"
              />
            </svg>
            <span
              className={`h-2 w-2 flex-shrink-0 rounded-full ${group.isEssential ? essentialColor() : discretionaryColor()}`}
            />
            {group.name}
            <span className="text-caption text-faint font-normal">
              ({items.length})
            </span>
          </span>
        </td>
        <td className="px-3 py-1.5 text-right font-semibold tabular-nums">
          {formatCurrency(group.budgeted)}
        </td>
        <td className="px-3 py-1.5 text-right font-semibold tabular-nums">
          {formatCurrency(group.actual)}
        </td>
        <td
          className={`px-3 py-1.5 text-right font-semibold tabular-nums ${overUnderTextColor(group.diff)}`}
        >
          {formatCurrency(Math.abs(group.diff))}
          {group.diff > 0 ? " over" : " under"}
        </td>
        <td className="px-3 py-1.5 text-right">
          <ProgressBar value={percentUsed} />
        </td>
      </tr>
      {isExpanded &&
        items
          .sort((a, b) => b.actual - a.actual)
          .map((item) => {
            const itemPct =
              item.budgeted > 0
                ? item.actual / item.budgeted
                : item.actual > 0
                  ? 999
                  : 0;
            return (
              <tr
                key={item.category}
                className="border-subtle border-b hover:bg-blue-50/60"
              >
                <td className="text-muted py-1 pr-3 pl-8">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${item.isEssential ? "bg-blue-400" : "bg-purple-300"}`}
                    />
                    {item.category}
                  </span>
                </td>
                <td className="text-muted px-3 py-1 text-right tabular-nums">
                  {item.budgeted > 0 ? formatCurrency(item.budgeted) : "—"}
                </td>
                <td className="text-secondary px-3 py-1 text-right tabular-nums">
                  {formatCurrency(item.actual)}
                </td>
                <td
                  className={`px-3 py-1 text-right text-xs tabular-nums ${overUnderTextColor(item.diff)}`}
                >
                  {item.budgeted > 0 ? (
                    <>
                      {formatCurrency(Math.abs(item.diff))}
                      {item.diff > 0 ? " over" : " under"}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-1 text-right">
                  {item.budgeted > 0 ? (
                    <ProgressBar value={itemPct} small />
                  ) : null}
                </td>
              </tr>
            );
          })}
    </>
  );
}

function ProgressBar({ value, small }: { value: number; small?: boolean }) {
  const clamped = Math.min(value, 1.5);
  const width = Math.min(clamped * 100, 100);
  const isOver = value > 1;
  const h = small ? "h-1.5" : "h-2";
  const name = `${formatPercent(value)} of budget${isOver ? " — over budget" : ""}`;

  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`flex-1 ${h} bg-surface-elevated min-w-[40px] overflow-hidden rounded-full`}
      >
        <div
          className={`${h} rounded-full transition-all ${isOver ? "bg-red-400" : "bg-green-400"}`}
          style={{ width: `${width}%` }}
          role="progressbar"
          aria-label={name}
          aria-valuenow={Math.round(Math.min(value, 1) * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          // valuenow is clamped to 100 (ARIA requires it in range); the
          // real over-budget figure lives here.
          aria-valuetext={formatPercent(value)}
        />
      </div>
      <span
        aria-hidden="true"
        className={`text-caption w-8 text-right tabular-nums ${isOver ? "font-semibold text-red-600" : "text-muted"}`}
      >
        {value >= 9.99 ? "—" : formatPercent(value)}
      </span>
    </div>
  );
}
