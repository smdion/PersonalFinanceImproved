"use client";

/** Displays taxable brokerage account balances, goals, and projection charts with permission-gated editing. */

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency } from "@/lib/utils/format";
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
} from "@/components/cards/projection/types";
import {
  LumpSumForm,
  LumpSumBadge,
} from "@/components/cards/projection/lump-sum-form";

type BrokerageTab = "projection" | "goals";

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
        amount: Math.abs(amt), // engine handles positive amounts; withdrawals are modeled separately
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

  const [activeTab, setActiveTab] = useState<BrokerageTab>("projection");

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

  // API balance overlay from brokerage router
  const apiBalances = brokerageData?.apiBalances ?? [];
  const apiBalanceByPerfId = new Map(
    apiBalances.map((ab) => [ab.performanceAccountId, ab]),
  );

  // Funding sources — fully separated from retirement engine data.
  // Direct contributions: sum of Portfolio-category accounts only (from contribution summary)
  const totalDirectContrib = portfolioAccounts.reduce(
    (s, at) => s + at.totalContrib,
    0,
  );

  // Overflow from retirement: the only thing that crosses from the engine
  const firstYear = brokerageResult.projectionByYear[0];
  const totalOverflow = firstYear?.overflow ?? 0;

  // Brokerage ramp from engine settings (shared global setting)
  const accYears = data.result.projectionByYear.filter(
    (yr) => yr.phase === "accumulation",
  );
  const firstAccYear = accYears[0] as
    | import("@/lib/calculators/types").EngineAccumulationYear
    | undefined;
  const brokerageRamp = firstAccYear?.brokerageRampContribution ?? 0;

  const tabs: { key: BrokerageTab; label: string }[] = [
    { key: "projection", label: "Projection" },
    { key: "goals", label: "Goals" },
  ];

  return (
    <div>
      <PageHeader
        title="Brokerage Projection"
        subtitle="Non-retirement investment accounts"
      />

      <div className="flex border-b mb-4 mt-4">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.key
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-muted hover:text-secondary hover:border-strong"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "projection" && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Funding Sources */}
            <Card title="Funding Sources" className="lg:col-span-1">
              <FundingSources
                directContrib={totalDirectContrib}
                overflow={totalOverflow}
                ramp={brokerageRamp}
              />
            </Card>

            {/* By Account */}
            <Card title="By Account" className="lg:col-span-2">
              <ByAccountSummary
                accounts={portfolioAccounts}
                apiBalanceByPerfId={apiBalanceByPerfId}
              />
            </Card>
          </div>

          {/* Goal Status */}
          {brokerageResult.goals.length > 0 && (
            <Card title="Brokerage Goals" className="mt-6">
              <GoalStatusTable goals={brokerageResult.goals} />
            </Card>
          )}

          {/* Planned Events (lump sum injections/withdrawals) */}
          {canEdit && (
            <Card title="Planned Events" className="mt-6">
              <p className="text-xs text-muted mb-2">
                One-time dollar injections or withdrawals (bonus, inheritance,
                down payment).
                <HelpTip text="Planned events bypass IRS contribution limits and are applied in the specified year. They feed directly into the projection engine. Negative amounts model withdrawals." />
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
            <YearByYearTable years={brokerageResult.projectionByYear} />
          </Card>
        </>
      )}

      {activeTab === "goals" && <BrokerageGoalsSection />}

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
}: {
  directContrib: number;
  overflow: number;
  ramp: number;
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
    {
      label: "Brokerage ramp",
      amount: ramp,
      help: "Annual increase from Settings — same value used on Retirement page",
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
      <div className="border-t pt-2 flex justify-between font-semibold">
        <span className="text-secondary">Total inflow</span>
        <span className="text-primary">{formatCurrency(total)}/yr</span>
      </div>
    </div>
  );
}

type ApiBalanceInfo = {
  performanceAccountId: number;
  resolvedBalance: number;
  snapshotBalance: number;
  source: "api" | "snapshot";
};

function ByAccountSummary({
  accounts,
  apiBalanceByPerfId,
}: {
  accounts: {
    accountType: string;
    employeeContrib: number;
    employerMatch: number;
    totalContrib: number;
    targetAnnual: number | null;
    fundingPct: number;
    hasDiscountBar: boolean;
    employerMatchLabel: string;
    performanceAccountId?: number;
  }[];
  apiBalanceByPerfId: Map<number, ApiBalanceInfo>;
}) {
  if (accounts.length === 0) {
    return (
      <p className="text-sm text-faint">
        No portfolio-category contribution accounts configured.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {accounts.map((at) => {
        const apiInfo = at.performanceAccountId
          ? apiBalanceByPerfId.get(at.performanceAccountId)
          : undefined;
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

function YearByYearTable({ years }: { years: BrokerageGoalYear[] }) {
  if (years.length === 0) {
    return <p className="text-sm text-faint">No projection data.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-surface-primary z-10">
          <tr className="text-left text-[10px] text-faint uppercase border-b">
            <th className="py-2 pr-3">Year</th>
            <th className="py-2 pr-3 text-right">
              Contribution
              <HelpTip text="Intentional brokerage contributions (employee + employer match)" />
            </th>
            <th className="py-2 pr-3 text-right">
              Overflow
              <HelpTip text="Excess from retirement accounts that exceed IRS limits, redirected to brokerage" />
            </th>
            <th className="py-2 pr-3 text-right">
              Growth
              <HelpTip text="Investment returns — balance change minus net contributions and withdrawals" />
            </th>
            <th className="py-2 pr-3 text-right">
              Withdrawals
              <HelpTip text="Goal withdrawals processed by the engine in target year" />
            </th>
            <th className="py-2 pr-3 text-right">
              Tax Cost
              <HelpTip text="Capital gains tax on the gains portion of withdrawals — basis is tax-free" />
            </th>
            <th className="py-2 pr-3 text-right">
              End Balance
              <HelpTip text="Total brokerage account value at year end" />
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
          {years.map((yr) => {
            const hasWithdrawals = yr.totalWithdrawal > 0;
            return (
              <tr
                key={yr.year}
                className={`border-b border-subtle ${
                  hasWithdrawals ? "bg-amber-50/50" : ""
                }`}
              >
                <td className="py-1.5 pr-3 font-medium text-secondary">
                  {yr.year}
                </td>
                <td className="py-1.5 pr-3 text-right text-muted">
                  {yr.contribution > 0
                    ? formatCurrency(yr.contribution)
                    : "\u2014"}
                </td>
                <td className="py-1.5 pr-3 text-right text-amber-600">
                  {yr.overflow > 0 ? formatCurrency(yr.overflow) : "\u2014"}
                </td>
                <td className="py-1.5 pr-3 text-right text-emerald-600">
                  {yr.growth !== 0 ? formatCurrency(yr.growth) : "\u2014"}
                </td>
                <td className="py-1.5 pr-3 text-right text-red-600">
                  {yr.totalWithdrawal > 0
                    ? `-${formatCurrency(yr.totalWithdrawal)}`
                    : "\u2014"}
                </td>
                <td className="py-1.5 pr-3 text-right text-muted">
                  {yr.totalTaxCost > 0
                    ? formatCurrency(yr.totalTaxCost)
                    : "\u2014"}
                </td>
                <td className="py-1.5 pr-3 text-right font-medium text-primary">
                  {formatCurrency(yr.endBalance)}
                </td>
                <td className="py-1.5 pr-3 text-right text-muted">
                  {formatCurrency(yr.endBasis)}
                </td>
                <td className="py-1.5 text-right text-muted">
                  {formatCurrency(yr.unrealizedGain)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
