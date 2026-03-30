"use client";

/** Displays taxable brokerage account balances, goals, and projection charts with permission-gated editing. */

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { HelpTip } from "@/components/ui/help-tip";
import { Tooltip } from "@/components/ui/tooltip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { BrokerageGoalsSection } from "@/components/cards/brokerage-goals";
import {
  calculateBrokerageGoals,
  type BrokerageGoalYear,
  type BrokerageGoalStatus,
} from "@/lib/calculators/brokerage-goals";
import type {
  AccumOverride,
  LumpSumEvent,
  TooltipData,
} from "@/components/cards/projection/types";
import { renderTooltip } from "@/components/cards/projection/tooltip-renderer";
import {
  LumpSumForm,
  LumpSumBadge,
} from "@/components/cards/projection/lump-sum-form";

export default function BrokeragePage() {
  const user = useUser();
  const canEdit = hasPermission(user, "brokerage");
  const utils = trpc.useUtils();
  const salaryOverrides = useSalaryOverrides();
  const [activeProfileId] = usePersistedSetting<number | null>(
    "active_contrib_profile_id",
    null,
  );
  // Brokerage planned events (persisted to DB)
  const brokerageLumpQuery = trpc.settings.projectionOverrides.get.useQuery({
    overrideType: "brokerage",
  });
  const saveBrokerageLumps = trpc.settings.projectionOverrides.save.useMutation(
    {
      onSuccess: () => utils.brokerage.invalidate(),
    },
  );
  const clearBrokerageLumps =
    trpc.settings.projectionOverrides.clear.useMutation({
      onSuccess: () => utils.brokerage.invalidate(),
    });
  const [brokerageTouched, setBrokerageTouched] = useState(false);
  const [brokerageLumpSumsLocal, setBrokerageLumpSumsLocal] = useState<
    LumpSumEvent[]
  >([]);
  const brokerageLumpSums: LumpSumEvent[] = brokerageTouched
    ? brokerageLumpSumsLocal
    : brokerageLumpQuery.data && brokerageLumpQuery.data.length > 0
      ? (brokerageLumpQuery.data as LumpSumEvent[])
      : brokerageLumpSumsLocal;
  const setBrokerageLumpSums = (
    updater: LumpSumEvent[] | ((prev: LumpSumEvent[]) => LumpSumEvent[]),
  ) => {
    setBrokerageTouched(true);
    setBrokerageLumpSumsLocal((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (next.length > 0) {
        saveBrokerageLumps.mutate({
          overrideType: "brokerage",
          // eslint-disable-next-line no-restricted-syntax -- Drizzle JSONB requires Record<string, unknown>[]
          overrides: next as unknown as Record<string, unknown>[],
        });
      } else {
        clearBrokerageLumps.mutate({ overrideType: "brokerage" });
      }
      return next;
    });
  };

  const accumOverridesFromLumpSums: AccumOverride[] = React.useMemo(() => {
    const byYear = new Map<number, AccumOverride>();
    for (const ls of brokerageLumpSums) {
      const y = parseInt(ls.year);
      const amt = parseFloat(ls.amount);
      if (isNaN(y) || isNaN(amt) || amt === 0) continue;
      let ov = byYear.get(y);
      if (!ov) {
        ov = { year: y, lumpSums: [] };
        byYear.set(y, ov);
      }
      ov.lumpSums!.push({
        id: ls.id,
        amount: Math.abs(amt),
        targetAccount: ls.targetAccount,
        ...(ls.targetAccountName
          ? { targetAccountName: ls.targetAccountName }
          : {}),
        ...(ls.label ? { label: ls.label } : {}),
      });
    }
    return Array.from(byYear.values()).sort((a, b) => a.year - b.year);
  }, [brokerageLumpSums]);

  const engineInput = {
    ...(salaryOverrides.length > 0 ? { salaryOverrides } : {}),
    ...(accumOverridesFromLumpSums.length > 0
      ? { accumulationOverrides: accumOverridesFromLumpSums }
      : {}),
  };
  const contribInput = {
    ...(salaryOverrides.length > 0 ? { salaryOverrides } : {}),
    ...(activeProfileId != null
      ? { contributionProfileId: activeProfileId }
      : {}),
  } as Parameters<typeof trpc.contribution.computeSummary.useQuery>[0];

  const { data, isLoading, error } =
    trpc.projection.computeProjection.useQuery(engineInput);
  const { data: contribData } =
    trpc.contribution.computeSummary.useQuery(contribInput);
  const { data: brokerageData } = trpc.brokerage.computeSummary.useQuery();
  const upsertSetting = trpc.settings.appSettings.upsert.useMutation({
    onSuccess: () => utils.invalidate(),
  });
  const [showGoals, setShowGoals] = useState(false);
  const [dollarMode, setDollarMode] = useState<"nominal" | "real">("nominal");

  if (isLoading) {
    return (
      <div>
        <PageHeader
          title="Brokerage Projection"
          subtitle="Non-retirement investment accounts"
        />
        <div className="text-faint text-sm mt-8 text-center">
          Loading projection...
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <PageHeader
          title="Brokerage Projection"
          subtitle="Non-retirement investment accounts"
        />
        <EmptyState message={`Failed to load: ${error.message}`} />
      </div>
    );
  }
  if (!data?.result) {
    return (
      <div>
        <PageHeader
          title="Brokerage Projection"
          subtitle="Non-retirement investment accounts"
        />
        <EmptyState message="No projection data available. Configure contribution accounts in Settings." />
      </div>
    );
  }

  // Run brokerage goals calculator on engine output
  const brokerageGoalsInput = {
    asOfDate: new Date(),
    goals: data.brokerageGoals ?? [],
    engineYears: data.result.projectionByYear,
    parentCategoryFilter: "Portfolio",
  };
  const brokerageResult = calculateBrokerageGoals(brokerageGoalsInput);

  // Portfolio-category accounts from contribution summary (parentCategory filter)
  const portfolioAccounts = contribData
    ? [
        ...contribData.people.flatMap((p) =>
          p.accountTypes.filter((at) => at.parentCategory === "Portfolio"),
        ),
        ...(contribData.jointAccountTypes ?? []).filter(
          (at) => at.parentCategory === "Portfolio",
        ),
      ]
    : [];

  // API balance overlay — match by accountCategory (raw DB type) against categoryKey
  const apiBalances = brokerageData?.apiBalances ?? [];
  const apiBalanceByCategory = new Map<string, (typeof apiBalances)[0]>();
  for (const ab of apiBalances) {
    if (ab.source === "api") apiBalanceByCategory.set(ab.accountCategory, ab);
  }
  const budgetLinks = brokerageData?.budgetLinks ?? [];

  // Deflation (Today's $ / Future $) — same pattern as retirement
  const inflationRate = data.settings?.annualInflation
    ? Number(data.settings.annualInflation)
    : 0.03;
  const baseYear = new Date().getFullYear();
  const deflate = (value: number, year: number) => {
    if (dollarMode === "nominal") return value;
    const years = year - baseYear;
    if (years <= 0) return value;
    return value / Math.pow(1 + inflationRate, years);
  };

  // Funding sources
  const totalDirectContrib = portfolioAccounts.reduce(
    (s, at) => s + at.totalContrib,
    0,
  );
  const firstYear = brokerageResult.projectionByYear[0];
  const totalOverflow = firstYear?.overflow ?? 0;
  const accYears = data.result.projectionByYear.filter(
    (yr) => yr.phase === "accumulation",
  );
  const firstAccYear = accYears[0] as
    | import("@/lib/calculators/types").EngineAccumulationYear
    | undefined;
  const brokerageRamp = firstAccYear?.brokerageRampContribution ?? 0;

  return (
    <div>
      <PageHeader
        title="Brokerage Projection"
        subtitle="Non-retirement investment accounts"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
        {/* Funding Sources */}
        <Card title="Funding Sources" className="lg:col-span-1">
          <FundingSources
            directContrib={totalDirectContrib}
            overflow={totalOverflow}
            ramp={brokerageRamp}
            costBasis={brokerageData?.costBasis ?? 0}
            canEdit={canEdit}
            onRampChange={(value) =>
              upsertSetting.mutate({
                key: "brokerage_contribution_increase",
                value: String(value),
              })
            }
          />
        </Card>

        {/* By Account */}
        <Card title="By Account" className="lg:col-span-2">
          <ByAccountSummary
            accounts={portfolioAccounts}
            apiBalanceByCategory={apiBalanceByCategory}
            budgetLinks={budgetLinks}
          />
        </Card>
      </div>

      {/* Goal Funding Status */}
      {brokerageResult.goals.length > 0 && (
        <Card title="Goal Funding Status" className="mt-6">
          <p className="text-xs text-muted mb-2">
            Set a target amount and year — the engine withdraws from brokerage
            when the target year arrives and shows whether you are on track.
            <HelpTip text="Goals are automatic: the projection engine deducts the target amount from your brokerage balance in the target year. If the balance is insufficient, the shortfall is shown." />
          </p>
          <GoalStatusTable goals={brokerageResult.goals} />
        </Card>
      )}

      {/* Manage Goals (collapsible) */}
      {canEdit && (
        <div className="border rounded-lg p-4 mt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                Manage Goals
              </h4>
              <HelpTip text="Create, edit, or delete brokerage goals. Each goal defines a target amount and year — the engine automatically withdraws from your brokerage in that year." />
            </div>
            <button
              type="button"
              onClick={() => setShowGoals(!showGoals)}
              className={`text-xs font-medium px-3 py-1 rounded transition-colors ${
                showGoals
                  ? "bg-surface-strong text-muted hover:text-primary"
                  : "bg-indigo-600 text-white hover:bg-indigo-700"
              }`}
            >
              {showGoals ? "Done" : "Edit Goals"}
            </button>
          </div>
          {showGoals && (
            <div className="mt-3">
              <BrokerageGoalsSection />
            </div>
          )}
        </div>
      )}

      {/* Planned Events */}
      {canEdit && (
        <Card title="Planned Events" className="mt-6">
          <p className="text-xs text-muted mb-2">
            One-time injections or withdrawals that modify the projection
            (bonus, inheritance, down payment).
            <HelpTip text="Unlike goals (which set a target and let the engine decide if it's funded), planned events directly add or remove dollars in a specific year." />
          </p>
          {brokerageLumpSums.length > 0 && (
            <div className="space-y-1 mb-3">
              {brokerageLumpSums.map((ls) => (
                <LumpSumBadge
                  key={ls.id}
                  event={ls}
                  onDelete={() =>
                    setBrokerageLumpSums((prev) =>
                      prev.filter((x) => x.id !== ls.id),
                    )
                  }
                />
              ))}
            </div>
          )}
          <LumpSumForm
            accounts={
              data?.result?.projectionByYear?.[0]?.individualAccountBalances
                ?.filter((ia) => ia.parentCategory === "Portfolio")
                ?.map((ia) => ({
                  name: ia.name,
                  category: ia.category,
                  taxType: ia.taxType,
                })) ?? []
            }
            onAdd={(ls) => setBrokerageLumpSums((prev) => [...prev, ls])}
            allowWithdrawals
          />
        </Card>
      )}

      {/* Year-by-Year Projection */}
      <Card title="Year-by-Year Projection" className="mt-6">
        <div className="flex items-center justify-end mb-3">
          <div className="inline-flex rounded-md border bg-surface-primary p-0.5">
            {(
              [
                ["nominal", "Future $"],
                ["real", "Today's $"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setDollarMode(key)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                  dollarMode === key
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-muted hover:text-secondary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <HelpTip text="Future $ shows projected nominal values. Today's $ adjusts for inflation so you can compare in current purchasing power." />
        </div>
        <YearByYearTable
          years={brokerageResult.projectionByYear}
          deflate={deflate}
        />
      </Card>

      {/* Warnings */}
      {brokerageResult.warnings.length > 0 && (
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
          {brokerageResult.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-700">
              {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Sub-components ---

function FundingSources({
  directContrib,
  overflow,
  ramp,
  costBasis,
  canEdit,
  onRampChange,
}: {
  directContrib: number;
  overflow: number;
  ramp: number;
  costBasis: number;
  canEdit: boolean;
  onRampChange: (value: number) => void;
}) {
  const total = directContrib + overflow + ramp;
  const rows = [
    {
      label: "Direct contributions",
      amount: directContrib,
      help: "Employee + employer contributions to Portfolio-category accounts",
    },
    {
      label: "Retirement overflow",
      amount: overflow,
      help: "Excess contributions that exceed IRS limits on retirement accounts, redirected here",
    },
  ];

  return (
    <div className="space-y-2 text-sm">
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between">
          <span className="text-muted">
            {r.label}
            {r.help && <HelpTip text={r.help} />}
          </span>
          <span className="font-medium text-primary">
            {formatCurrency(r.amount)}/yr
          </span>
        </div>
      ))}
      <div className="flex justify-between items-center">
        <span className="text-muted">
          Annual increase
          <HelpTip text="Additional fixed-dollar contribution added each year (e.g., $50/yr means year 1 adds $50, year 2 adds $100, etc.)" />
        </span>
        {canEdit ? (
          <span className="flex items-center gap-1">
            <span className="text-faint">$</span>
            <input
              type="number"
              min={0}
              step={10}
              defaultValue={ramp}
              className="w-20 text-right border rounded px-1.5 py-0.5 text-sm"
              onBlur={(e) => {
                const value = parseFloat(e.target.value) || 0;
                if (value !== ramp) onRampChange(value);
              }}
            />
            <span className="text-faint text-xs">/yr</span>
          </span>
        ) : (
          <span className="font-medium text-primary">
            {formatCurrency(ramp)}/yr
          </span>
        )}
      </div>
      <div className="flex justify-between items-center">
        <span className="text-muted">
          Starting cost basis
          <HelpTip text="Sum of cost basis across your brokerage accounts. Set per-account on the Portfolio page under Account Settings. Only gains above basis are taxable on withdrawal." />
        </span>
        <span className="font-medium text-primary">
          {formatCurrency(costBasis)}
        </span>
      </div>
      <div className="border-t pt-2 flex justify-between font-semibold">
        <span className="text-secondary">Total inflow</span>
        <span className="text-primary">{formatCurrency(total)}/yr</span>
      </div>
    </div>
  );
}

type ApiBalanceInfo = {
  performanceAccountId: number;
  accountCategory: string;
  resolvedBalance: number;
  snapshotBalance: number;
  source: "api" | "snapshot";
};

function ByAccountSummary({
  accounts,
  apiBalanceByCategory,
  budgetLinks,
}: {
  accounts: {
    accountType: string;
    categoryKey: string;
    employeeContrib: number;
    employerMatch: number;
    totalContrib: number;
    targetAnnual: number | null;
    fundingPct: number;
    hasDiscountBar: boolean;
    employerMatchLabel: string;
  }[];
  apiBalanceByCategory: Map<string, ApiBalanceInfo>;
  budgetLinks: Array<{
    accountType: string;
    budgetItemName: string;
    budgetCategory: string;
  }>;
}) {
  if (accounts.length === 0) {
    return (
      <p className="text-sm text-faint">
        No portfolio-category contribution accounts configured.
      </p>
    );
  }

  // Match by categoryKey (raw DB category) — both budgetLinks.accountType and categoryKey are the raw DB value
  const budgetLinkByType = new Map(
    budgetLinks.map((bl) => [bl.accountType, bl]),
  );

  return (
    <div className="space-y-3">
      {accounts.map((at) => {
        const apiInfo = apiBalanceByCategory.get(at.categoryKey);
        const budgetLink = budgetLinkByType.get(at.categoryKey);
        return (
          <div key={at.accountType}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-secondary font-medium">
                {at.accountType}
                {apiInfo?.source === "api" && (
                  <span className="ml-1.5 inline-block px-1.5 py-0.5 text-[9px] font-semibold uppercase rounded bg-blue-100 text-blue-700">
                    YNAB
                  </span>
                )}
              </span>
              <span className="text-primary font-semibold">
                {apiInfo?.source === "api"
                  ? formatCurrency(apiInfo.resolvedBalance)
                  : `${formatCurrency(at.totalContrib)}/yr`}
              </span>
            </div>
            {budgetLink && (
              <p className="text-[10px] text-emerald-600 mt-0.5">
                Linked to budget: {budgetLink.budgetItemName}
              </p>
            )}
            {apiInfo?.source === "api" && (
              <p className="text-[10px] text-blue-600 mt-0.5">
                Balance from YNAB (snapshot:{" "}
                {formatCurrency(apiInfo.snapshotBalance)})
              </p>
            )}
            {at.targetAnnual != null && at.targetAnnual > 0 && (
              <div className="mt-1">
                <div className="w-full bg-surface-strong rounded-full h-2">
                  <div
                    className="bg-emerald-500 h-2 rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (at.totalContrib / at.targetAnnual) * 100)}%`,
                    }}
                  />
                </div>
                <p className="text-[10px] text-faint mt-0.5">
                  {Math.round((at.totalContrib / at.targetAnnual) * 100)}% of{" "}
                  {formatCurrency(at.targetAnnual)} target
                </p>
              </div>
            )}
            {at.targetAnnual == null && (
              <p className="text-[10px] text-faint mt-0.5">No target set</p>
            )}
            {at.employerMatch > 0 && (
              <p className="text-[10px] text-muted mt-0.5">
                +{formatCurrency(at.employerMatch)}/yr {at.employerMatchLabel}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GoalStatusTable({ goals }: { goals: BrokerageGoalStatus[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-faint uppercase border-b">
            <th className="py-2 pr-4">Goal</th>
            <th className="py-2 pr-4 text-right">Target</th>
            <th className="py-2 pr-4 text-right">Year</th>
            <th className="py-2 pr-4 text-right">
              Projected Balance
              <HelpTip text="Estimated brokerage balance at target year, before the goal withdrawal" />
            </th>
            <th className="py-2 pr-4 text-right">Withdrawal</th>
            <th className="py-2 pr-4 text-right">
              Tax Cost
              <HelpTip text="Estimated capital gains tax on the gains portion of the withdrawal — basis (contributions) is tax-free" />
            </th>
            <th className="py-2 text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          {goals.map((g) => (
            <tr key={g.id} className="border-b border-subtle">
              <td className="py-2 pr-4 font-medium text-secondary">{g.name}</td>
              <td className="py-2 pr-4 text-right text-muted">
                {formatCurrency(g.targetAmount)}
              </td>
              <td className="py-2 pr-4 text-right text-muted">
                {g.targetYear}
              </td>
              <td className="py-2 pr-4 text-right text-muted">
                {formatCurrency(g.projectedBalance)}
              </td>
              <td className="py-2 pr-4 text-right text-muted">
                {formatCurrency(g.actualWithdrawal)}
              </td>
              <td className="py-2 pr-4 text-right text-muted">
                {formatCurrency(g.taxCost)}
              </td>
              <td className="py-2 text-center">
                {g.funded ? (
                  <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">
                    Funded
                  </span>
                ) : (
                  <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700">
                    {formatCurrency(g.shortfall)} short
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Tooltip builders ---

function contributionTooltip(yr: BrokerageGoalYear): TooltipData {
  const items = yr.individualAccounts.map((ia) => ({
    label: ia.name,
    amount: ia.intentionalContribution ?? ia.contribution,
    match: ia.employerMatch > 0 ? ia.employerMatch : undefined,
    matchLabel: "employer match",
    color: "blue" as const,
  }));
  return {
    kind: "money",
    header: "Brokerage Contributions",
    items,
    total: {
      label: "Total",
      amount: yr.contribution,
      match: yr.employerMatch > 0 ? yr.employerMatch : undefined,
      matchLabel: "match",
    },
    ...(yr.proRateFraction != null
      ? {
          proRate: {
            months: Math.round(yr.proRateFraction * 12),
            annualAmount:
              yr.proRateFraction > 0
                ? Math.round(yr.contribution / yr.proRateFraction)
                : yr.contribution,
            proRatedAmount: yr.contribution,
          },
        }
      : {}),
  };
}

function overflowTooltip(yr: BrokerageGoalYear): TooltipData {
  const items = yr.individualAccounts
    .filter((ia) => (ia.overflowContribution ?? 0) > 0)
    .map((ia) => ({
      label: ia.name,
      amount: ia.overflowContribution ?? 0,
      color: "amber" as const,
    }));
  return {
    kind: "money",
    header: "IRS Limit Overflow",
    meta: "Excess contributions redirected from retirement accounts",
    items: items.length > 0 ? items : undefined,
  };
}

function growthTooltip(yr: BrokerageGoalYear): TooltipData {
  const items = yr.individualAccounts.map((ia) => ({
    label: ia.name,
    amount: ia.growth,
    prefix: (ia.growth >= 0 ? "+" : "-") as "+" | "-",
    color: "emerald" as const,
  }));
  return {
    kind: "money",
    header: "Investment Growth",
    meta: `Return rate: ${formatPercent(yr.returnRate)}`,
    items,
    growth: { amount: yr.growth },
  };
}

function withdrawalTooltip(yr: BrokerageGoalYear): TooltipData {
  const items = yr.goalWithdrawals.map((gw) => ({
    label: gw.name,
    amount: gw.amount,
    prefix: "-" as const,
    color: "red" as const,
    sub: [
      {
        label: "Basis (tax-free)",
        amount: gw.basisPortion,
        color: "gray" as const,
      },
      {
        label: "Gains (taxable)",
        amount: gw.gainsPortion,
        color: "amber" as const,
      },
      { label: "Tax cost", amount: gw.taxCost, color: "red" as const },
    ],
  }));
  return {
    kind: "money",
    header: "Goal Withdrawals",
    items,
    withdrawals: { amount: yr.totalWithdrawal, taxCost: yr.totalTaxCost },
  };
}

function balanceTooltip(
  yr: BrokerageGoalYear,
  prevBalance: number,
): TooltipData {
  const items = yr.individualAccounts.map((ia) => ({
    label: ia.name,
    amount: ia.balance,
    color: "blue" as const,
  }));
  const change = yr.endBalance - prevBalance;
  return {
    kind: "money",
    header: "End Balance",
    meta: `Return rate: ${formatPercent(yr.returnRate)}`,
    items,
    yearChange: {
      total: yr.endBalance,
      change,
      parts: [
        {
          label: "Contributions",
          amount: yr.contribution + yr.overflow,
          color: "blue",
        },
        { label: "Growth", amount: yr.growth, color: "emerald" },
        ...(yr.totalWithdrawal > 0
          ? [
              {
                label: "Withdrawals",
                amount: -yr.totalWithdrawal,
                color: "red" as const,
              },
            ]
          : []),
      ],
    },
  };
}

// --- Year-by-Year Table ---

function YearByYearTable({
  years,
  deflate,
}: {
  years: BrokerageGoalYear[];
  deflate: (value: number, year: number) => number;
}) {
  if (years.length === 0) {
    return <p className="text-sm text-faint">No projection data.</p>;
  }

  // Currency formatting with optional deflation
  const fmt = (amount: number, year: number) =>
    formatCurrency(deflate(amount, year));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-surface-primary z-10">
          <tr className="text-left text-[10px] text-faint uppercase border-b">
            <th className="py-2 pr-3">Year</th>
            <th className="py-2 pr-3 text-right">
              Contribution
              <HelpTip text="Intentional brokerage contributions (employee + employer match). Hover for per-account breakdown." />
            </th>
            <th className="py-2 pr-3 text-right">
              Overflow
              <HelpTip text="Excess from retirement accounts that exceed IRS limits, redirected to brokerage" />
            </th>
            <th className="py-2 pr-3 text-right">
              Growth
              <HelpTip text="Investment returns — hover for return rate and per-account breakdown" />
            </th>
            <th className="py-2 pr-3 text-right">
              Withdrawals
              <HelpTip text="Goal withdrawals — hover for per-goal breakdown with tax cost" />
            </th>
            <th className="py-2 pr-3 text-right">
              Tax Cost
              <HelpTip text="Capital gains tax on the gains portion of withdrawals — basis is tax-free" />
            </th>
            <th className="py-2 pr-3 text-right">
              End Balance
              <HelpTip text="Total brokerage account value at year end — hover for breakdown" />
            </th>
            <th className="py-2 pr-3 text-right">
              Cost Basis
              <HelpTip text="Cumulative contributions — the tax-free portion of the balance" />
            </th>
            <th className="py-2 text-right">
              Unrealized Gain
              <HelpTip text="Balance minus cost basis — the portion subject to capital gains tax if withdrawn" />
            </th>
          </tr>
        </thead>
        <tbody>
          {years.map((yr, index) => {
            const hasWithdrawals = yr.totalWithdrawal > 0;
            const prevBalance = index > 0 ? years[index - 1]!.endBalance : 0;
            const hasAccounts = yr.individualAccounts.length > 0;
            return (
              <tr
                key={yr.year}
                className={`border-b border-subtle ${
                  hasWithdrawals ? "bg-amber-50/50" : ""
                }`}
              >
                <td className="py-1.5 pr-3 font-medium text-secondary">
                  {yr.year}
                  {yr.proRateFraction != null && (
                    <span className="ml-1 text-[9px] text-faint">
                      ({Math.round(yr.proRateFraction * 12)} mo)
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right text-muted">
                  {yr.contribution > 0 ? (
                    hasAccounts ? (
                      <Tooltip
                        content={renderTooltip(contributionTooltip(yr))}
                        side="top"
                      >
                        <span className="cursor-help border-b border-dotted border-current">
                          {fmt(yr.contribution, yr.year)}
                        </span>
                      </Tooltip>
                    ) : (
                      fmt(yr.contribution, yr.year)
                    )
                  ) : (
                    "\u2014"
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right text-amber-600">
                  {yr.overflow > 0 ? (
                    hasAccounts ? (
                      <Tooltip
                        content={renderTooltip(overflowTooltip(yr))}
                        side="top"
                      >
                        <span className="cursor-help border-b border-dotted border-current">
                          {fmt(yr.overflow, yr.year)}
                        </span>
                      </Tooltip>
                    ) : (
                      fmt(yr.overflow, yr.year)
                    )
                  ) : (
                    "\u2014"
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right text-emerald-600">
                  {yr.growth !== 0 ? (
                    hasAccounts ? (
                      <Tooltip
                        content={renderTooltip(growthTooltip(yr))}
                        side="top"
                      >
                        <span className="cursor-help border-b border-dotted border-current">
                          {fmt(yr.growth, yr.year)}
                        </span>
                      </Tooltip>
                    ) : (
                      fmt(yr.growth, yr.year)
                    )
                  ) : (
                    "\u2014"
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right text-red-600">
                  {yr.totalWithdrawal > 0 ? (
                    <Tooltip
                      content={renderTooltip(withdrawalTooltip(yr))}
                      side="top"
                    >
                      <span className="cursor-help border-b border-dotted border-current">
                        -{fmt(yr.totalWithdrawal, yr.year)}
                      </span>
                    </Tooltip>
                  ) : (
                    "\u2014"
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right text-muted">
                  {yr.totalTaxCost > 0
                    ? fmt(yr.totalTaxCost, yr.year)
                    : "\u2014"}
                </td>
                <td className="py-1.5 pr-3 text-right font-medium text-primary">
                  {hasAccounts ? (
                    <Tooltip
                      content={renderTooltip(balanceTooltip(yr, prevBalance))}
                      side="top"
                    >
                      <span className="cursor-help border-b border-dotted border-current">
                        {fmt(yr.endBalance, yr.year)}
                      </span>
                    </Tooltip>
                  ) : (
                    fmt(yr.endBalance, yr.year)
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right text-muted">
                  {fmt(yr.endBasis, yr.year)}
                </td>
                <td className="py-1.5 text-right text-muted">
                  {fmt(yr.unrealizedGain, yr.year)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
