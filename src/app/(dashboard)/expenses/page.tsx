"use client";

import { useState, useMemo, useCallback } from "react";
import { SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/ui/page-header";
import { formatCurrency } from "@/lib/utils/format";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";

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

type BudgetItem = {
  id: number;
  category: string;
  subcategory: string;
  amounts: number[];
  isEssential: boolean;
  apiCategoryId?: string | null;
  apiCategoryName?: string | null;
};

// ── Helpers ──

const COLORS = {
  budgeted: "#94a3b8", // slate-400
  under: "#22c55e", // green-500
  over: "#ef4444", // red-500
  essential: "#3b82f6", // blue-500
  discretionary: "#a855f7", // purple-500
  neutral: "#64748b", // slate-500
};

const PIE_COLORS = [
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#06b6d4",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#6366f1",
  "#84cc16",
  "#e11d48",
];

function pct(value: number, total: number): string {
  if (total === 0) return "—";
  return `${((value / total) * 100).toFixed(1)}%`;
}

// ── Component ──

export default function ExpensesPage() {
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
  const { data: budgetData } = trpc.budget.getActiveSummary.useQuery({
    selectedColumn: activeColumn,
  });

  const paycheckInput =
    activeContribProfileId != null
      ? { contributionProfileId: activeContribProfileId }
      : {};
  const { data: paycheckData } =
    trpc.paycheck.getSummary.useQuery(paycheckInput);

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
    const items = ((budgetData as unknown as Record<string, unknown>)
      ?.rawItems ?? []) as BudgetItem[];
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
      for (const c of g.categories) {
        const actual = Math.abs(c.activity);
        const linkedItem = itemMap.get(c.id);
        // Monthly budgeted from our budget profile, or from API budgeted
        const budgetedMonthly = linkedItem
          ? (linkedItem.amounts[activeColumn] ?? 0) / 12
          : c.budgeted > 0
            ? c.budgeted / 1000
            : 0; // API amounts in milliunits
        if (actual === 0 && budgetedMonthly === 0) continue;
        rows.push({
          group: g.name,
          category: c.name,
          budgeted: budgetedMonthly,
          actual: actual / 1000, // YNAB milliunits → dollars
          diff: actual / 1000 - budgetedMonthly,
          isEssential: linkedItem?.isEssential ?? true,
        });
      }
    }

    return rows;
  }, [apiCategories, budgetData, activeColumn]);

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
        color: PIE_COLORS[i % PIE_COLORS.length],
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
        <p className="text-sm text-muted mt-4">
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
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
          color={
            totalActual > totalBudgeted ? "text-red-600" : "text-green-600"
          }
        />
        <SummaryCard
          label="Savings Rate"
          value={
            monthlyNetIncome > 0 ? `${(savingsRate * 100).toFixed(1)}%` : "—"
          }
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

      {/* ── Charts Row ── */}
      {groupSummary.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* Budget vs Actual Bar Chart */}
          <div className="lg:col-span-2 bg-surface-primary rounded-lg border p-4">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
              Budget vs Actual — This Month
            </h3>
            <ResponsiveContainer
              width="100%"
              height={Math.max(200, groupSummary.length * 40)}
            >
              <BarChart
                data={groupSummary}
                layout="vertical"
                margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                  fontSize={10}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={120}
                  fontSize={10}
                  tick={{ fill: "#6b7280" }}
                />
                <RechartsTooltip
                  formatter={(value: unknown, name: unknown) => [
                    formatCurrency(Number(value)),
                    name === "budgeted" ? "Budgeted" : "Actual",
                  ]}
                  labelStyle={{ fontSize: 11, fontWeight: 600 }}
                  contentStyle={{ fontSize: 11 }}
                />
                <Bar
                  dataKey="budgeted"
                  fill={COLORS.budgeted}
                  barSize={12}
                  radius={[0, 2, 2, 0]}
                  name="Budgeted"
                />
                <Bar
                  dataKey="actual"
                  barSize={12}
                  radius={[0, 2, 2, 0]}
                  name="Actual"
                >
                  {groupSummary.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.diff > 0 ? COLORS.over : COLORS.under}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Spending Breakdown Pie */}
          <div className="bg-surface-primary rounded-lg border p-4">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
              Spending Breakdown
            </h3>
            {spendingPie.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={spendingPie}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                  >
                    {spendingPie.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    formatter={(value: unknown) =>
                      formatCurrency(Number(value))
                    }
                    contentStyle={{ fontSize: 11 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-faint text-center py-8">
                No spending data
              </p>
            )}

            {/* Essential vs Discretionary mini-bar */}
            {totalActual > 0 && (
              <div className="mt-3 space-y-1">
                <div className="flex justify-between text-[10px] text-muted">
                  <span>Essential {pct(essentialTotal, totalActual)}</span>
                  <span>
                    Discretionary {pct(discretionaryTotal, totalActual)}
                  </span>
                </div>
                <div className="flex h-2 rounded-full overflow-hidden bg-surface-elevated">
                  <div
                    className="bg-blue-500 transition-all"
                    style={{
                      width: `${(essentialTotal / totalActual) * 100}%`,
                    }}
                  />
                  <div
                    className="bg-purple-400 transition-all"
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

      {/* ── Category Detail Table ── */}
      {budgetVsActual.length > 0 && (
        <div className="bg-surface-primary rounded-lg border p-4 mb-6">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
            Category Detail — This Month
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-strong">
                  <th className="text-left py-2 pr-3 text-muted font-medium">
                    Category
                  </th>
                  <th className="text-right py-2 px-3 text-muted font-medium">
                    Budgeted
                  </th>
                  <th className="text-right py-2 px-3 text-muted font-medium">
                    Actual
                  </th>
                  <th className="text-right py-2 px-3 text-muted font-medium">
                    Diff
                  </th>
                  <th className="text-right py-2 px-3 text-muted font-medium w-32">
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
                  const pctUsed =
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
                      pctUsed={pctUsed}
                    />
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-strong font-semibold">
                  <td className="py-2 pr-3 text-primary">Total</td>
                  <td className="text-right py-2 px-3 tabular-nums">
                    {formatCurrency(totalBudgeted)}
                  </td>
                  <td className="text-right py-2 px-3 tabular-nums">
                    {formatCurrency(totalActual)}
                  </td>
                  <td
                    className={`text-right py-2 px-3 tabular-nums ${totalActual - totalBudgeted > 0 ? "text-red-600" : "text-green-600"}`}
                  >
                    {formatCurrency(Math.abs(totalActual - totalBudgeted))}
                    {totalActual > totalBudgeted ? " over" : " under"}
                  </td>
                  <td className="text-right py-2 px-3">
                    <ProgressBar
                      value={
                        totalBudgeted > 0 ? totalActual / totalBudgeted : 0
                      }
                    />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── Year-over-Year Comparison ── */}
      <div className="bg-surface-primary rounded-lg border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
            Year-over-Year Comparison
          </h3>
          <div className="flex items-center gap-2">
            {(["month", "quarter", "ytd"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriodType(p)}
                className={`px-3 py-1 text-xs font-medium rounded ${
                  periodType === p
                    ? "bg-blue-600 text-white"
                    : "bg-surface-elevated text-muted hover:bg-surface-strong"
                }`}
              >
                {p === "ytd" ? "YTD" : p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
            <span className="text-xs text-muted ml-2">
              {periodLabel} vs {currentYear - 1}
            </span>
          </div>
        </div>

        {yoyLoading ? (
          <SkeletonChart height={128} />
        ) : yoyData?.categories && yoyData.categories.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-strong">
                  <th className="text-left py-2 pr-3 text-muted font-medium">
                    Category
                  </th>
                  <th className="text-right py-2 px-3 text-muted font-medium">
                    {currentYear}
                  </th>
                  <th className="text-right py-2 px-3 text-muted font-medium">
                    {currentYear - 1}
                  </th>
                  <th className="text-right py-2 px-3 text-muted font-medium">
                    Diff
                  </th>
                  <th className="text-right py-2 px-3 text-muted font-medium">
                    % Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {yoyData.categories.map((cat) => (
                  <tr
                    key={cat.name}
                    className="border-b border-subtle hover:bg-blue-50/60"
                  >
                    <td className="py-1.5 pr-3 text-secondary">{cat.name}</td>
                    <td className="text-right py-1.5 px-3 tabular-nums">
                      {formatCurrency(Math.abs(cat.current))}
                    </td>
                    <td className="text-right py-1.5 px-3 tabular-nums text-muted">
                      {formatCurrency(Math.abs(cat.prior))}
                    </td>
                    <td
                      className={`text-right py-1.5 px-3 tabular-nums ${cat.diff < 0 ? "text-green-600" : cat.diff > 0 ? "text-red-600" : ""}`}
                    >
                      {cat.diff !== 0
                        ? formatCurrency(Math.abs(cat.diff))
                        : "—"}
                      {cat.diff < 0 ? " less" : cat.diff > 0 ? " more" : ""}
                    </td>
                    <td
                      className={`text-right py-1.5 px-3 tabular-nums ${(cat.pctChange ?? 0) < 0 ? "text-green-600" : (cat.pctChange ?? 0) > 0 ? "text-red-600" : ""}`}
                    >
                      {cat.pctChange !== null
                        ? `${cat.pctChange > 0 ? "+" : ""}${cat.pctChange.toFixed(1)}%`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-strong font-semibold">
                  <td className="py-2 pr-3">Total</td>
                  <td className="text-right py-2 px-3 tabular-nums">
                    {formatCurrency(
                      Math.abs(
                        yoyData.categories.reduce((s, c) => s + c.current, 0),
                      ),
                    )}
                  </td>
                  <td className="text-right py-2 px-3 tabular-nums text-muted">
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
          <p className="text-xs text-faint text-center py-4">
            No comparison data available for this period.
          </p>
        )}
      </div>
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
      <div className="text-[10px] font-medium text-muted uppercase tracking-wider">
        {label}
      </div>
      <div className={`text-lg font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-[10px] text-faint">{sub}</div>
    </div>
  );
}

function GroupRows({
  group,
  items,
  isExpanded,
  onToggle,
  pctUsed,
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
  pctUsed: number;
}) {
  return (
    <>
      <tr
        className="border-b bg-surface-sunken cursor-pointer hover:bg-surface-elevated"
        onClick={onToggle}
      >
        <td className="py-1.5 pr-3 font-semibold text-primary">
          <span className="flex items-center gap-1.5">
            <svg
              className={`w-2.5 h-2.5 text-faint transition-transform ${isExpanded ? "rotate-90" : ""}`}
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
              className={`w-2 h-2 rounded-full flex-shrink-0 ${group.isEssential ? "bg-blue-500" : "bg-purple-400"}`}
            />
            {group.name}
            <span className="text-[10px] font-normal text-faint">
              ({items.length})
            </span>
          </span>
        </td>
        <td className="text-right py-1.5 px-3 tabular-nums font-semibold">
          {formatCurrency(group.budgeted)}
        </td>
        <td className="text-right py-1.5 px-3 tabular-nums font-semibold">
          {formatCurrency(group.actual)}
        </td>
        <td
          className={`text-right py-1.5 px-3 tabular-nums font-semibold ${group.diff > 0 ? "text-red-600" : "text-green-600"}`}
        >
          {formatCurrency(Math.abs(group.diff))}
          {group.diff > 0 ? " over" : " under"}
        </td>
        <td className="text-right py-1.5 px-3">
          <ProgressBar value={pctUsed} />
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
                className="border-b border-subtle hover:bg-blue-50/60"
              >
                <td className="py-1 pr-3 pl-8 text-muted">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.isEssential ? "bg-blue-400" : "bg-purple-300"}`}
                    />
                    {item.category}
                  </span>
                </td>
                <td className="text-right py-1 px-3 tabular-nums text-muted">
                  {item.budgeted > 0 ? formatCurrency(item.budgeted) : "—"}
                </td>
                <td className="text-right py-1 px-3 tabular-nums text-secondary">
                  {formatCurrency(item.actual)}
                </td>
                <td
                  className={`text-right py-1 px-3 tabular-nums text-xs ${item.diff > 0 ? "text-red-600" : "text-green-500"}`}
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
                <td className="text-right py-1 px-3">
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

  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`flex-1 ${h} rounded-full overflow-hidden bg-surface-elevated min-w-[40px]`}
      >
        <div
          className={`${h} rounded-full transition-all ${isOver ? "bg-red-400" : "bg-green-400"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span
        className={`text-[10px] tabular-nums w-8 text-right ${isOver ? "text-red-600 font-semibold" : "text-muted"}`}
      >
        {value >= 9.99 ? "—" : `${(value * 100).toFixed(0)}%`}
      </span>
    </div>
  );
}
