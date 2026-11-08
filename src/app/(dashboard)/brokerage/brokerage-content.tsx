"use client";

/** Client content for the Brokerage page — prefetched by page.tsx. */

import { investedAtStartOf } from "@/lib/pure/advice/goldilocks";
import { flatDeflator, toTodaysDollars } from "@/lib/pure/simulation/dollars";
import type { DollarBasis } from "@/lib/config/enum-values";
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { HelpTip } from "@/components/ui/help-tip";
import { maskAmountsInText } from "@/lib/utils/format";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { BrokerageGoalsSection } from "@/components/brokerage/brokerage-goals";
import { calculateBrokerageGoals } from "@/lib/pure/savings/brokerage-goals";
import type { AccumOverride } from "@/components/retirement-projection/types";
import {
  LumpSumForm,
  LumpSumBadge,
} from "@/components/retirement-projection/lump-sum-form";
import { isPortfolioParent, tracksCostBasis } from "@/lib/config/account-types";
import { sumBy } from "@/lib/utils/math";
import { SkeletonTable } from "@/components/ui/skeleton";
import { QueryBoundary, queryPending } from "@/components/ui/query-boundary";
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";
import { profileSelectionFrom } from "@/lib/pure/household/profile-selection";
import { useBrokerageLumpSums } from "./use-brokerage-lump-sums";
import {
  CostBasisEditor,
  FundingSources,
  ByAccountSummary,
} from "./brokerage-funding";
import { GoalStatusTable } from "./brokerage-goal-status";
import { YearByYearTable } from "./brokerage-year-table";

export function BrokerageContent() {
  const user = useUser();
  const canEdit = hasPermission(user, "brokerage");
  // updateCostBasis is gated on "performance" server-side (same gate as the
  // Performance page's own cost-basis editor) — distinct from this page's
  // "brokerage" permission, so check it separately for the Cost Basis card.
  const canEditCostBasis = hasPermission(user, "performance");
  const utils = trpc.useUtils();
  // Portfolio-category brokerage accounts only — Retirement-category ones
  // (e.g. an ESPP or a "Retirement Brokerage") are Tax Buckets' scope, this
  // page's scope is specifically the accounts Tax Buckets excludes.
  const perfAccountsQuery =
    trpc.performance.performanceAccounts.list.useQuery();
  const portfolioBrokerageAccounts = (perfAccountsQuery.data ?? []).filter(
    (a) =>
      tracksCostBasis(a.accountType) && isPortfolioParent(a.parentCategory),
  );
  const updateCostBasis = trpc.performance.updateCostBasis.useMutation({
    onSuccess: () => utils.performance.performanceAccounts.list.invalidate(),
  });
  // Independent Salary Profile axis (the active profile).
  const { queryInput: salaryProfileInput } = useEffectiveSalaryProfileId();
  const [activeProfileId] = usePersistedSetting<number | null>(
    SK_ACTIVE_CONTRIB_PROFILE_ID,
    null,
  );
  // Brokerage planned events (persisted to DB)
  const { brokerageLumpSums, setBrokerageLumpSums } = useBrokerageLumpSums();

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
        // Brokerage-page lump sums are Portfolio savings.
        targetParentCategory: "Portfolio" as const,
        ...(ls.targetAccountName
          ? { targetAccountName: ls.targetAccountName }
          : {}),
        ...(ls.label ? { label: ls.label } : {}),
      });
    }
    return Array.from(byYear.values()).sort((a, b) => a.year - b.year);
  }, [brokerageLumpSums]);

  // The household's saved Changes by year still apply: sending only the
  // lump sums would replace them (an omitted list = the saved rows, a sent
  // one = exactly that list). Merge by year — the saved row keeps its
  // fields, and the year's lump sums are both lists'.
  const savedAccumQuery = trpc.retirement.projectionOverrides.get.useQuery({
    overrideType: "accumulation",
  });
  const mergedAccumOverrides: AccumOverride[] | null = React.useMemo(() => {
    if (accumOverridesFromLumpSums.length === 0) return null;
    const byYear = new Map<number, AccumOverride>();
    for (const o of (savedAccumQuery.data ?? []) as AccumOverride[])
      byYear.set(o.year, { ...o, lumpSums: [...(o.lumpSums ?? [])] });
    for (const o of accumOverridesFromLumpSums) {
      const row = byYear.get(o.year);
      if (row) row.lumpSums = [...(row.lumpSums ?? []), ...(o.lumpSums ?? [])];
      else byYear.set(o.year, o);
    }
    return Array.from(byYear.values()).sort((a, b) => a.year - b.year);
  }, [accumOverridesFromLumpSums, savedAccumQuery.data]);
  const contribInput = {
    ...(activeProfileId != null
      ? { contributionProfileId: activeProfileId }
      : {}),
    ...salaryProfileInput,
  };
  const engineInput = {
    ...(mergedAccumOverrides
      ? { accumulationOverrides: mergedAccumOverrides }
      : {}),
    selection: profileSelectionFrom(contribInput),
  };

  // With lump sums, wait for the saved rows they're merged into.
  const engineReady =
    !mergedAccumOverrides || savedAccumQuery.data !== undefined;
  const projectionQuery = trpc.projection.computeProjection.useQuery(
    engineInput,
    { enabled: engineReady },
  );
  const { data } = projectionQuery;
  const isLoading =
    projectionQuery.isLoading || (!engineReady && !projectionQuery.data);
  const { data: contribData } =
    trpc.contribution.computeSummary.useQuery(contribInput);
  const { data: brokerageData } = trpc.brokerage.computeSummary.useQuery();
  const { data: contribProfiles } = trpc.contributionProfile.list.useQuery();
  const upsertSetting = trpc.settings.appSettings.upsert.useMutation({
    onSuccess: () => utils.invalidate(),
  });
  const [isGoalsOpen, setIsGoalsOpen] = useState(false);
  const [dollarMode, setDollarMode] = useState<DollarBasis>("nominal");

  // Waiting on the saved rows shows the skeleton; their failure shows.
  if (isLoading || queryPending([projectionQuery, savedAccumQuery])) {
    return (
      <QueryBoundary
        query={[projectionQuery, savedAccumQuery]}
        frame={(body) => (
          <div>
            <PageHeader
              title="Brokerage Projection"
              subtitle="Non-retirement investment accounts"
            />
            {body}
          </div>
        )}
        fallback={<SkeletonTable rows={12} className="mt-4" />}
      />
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
    goals: data.brokerageGoals,
    engineYears: data.result.projectionByYear,
  };
  const brokerageResult = calculateBrokerageGoals(brokerageGoalsInput);

  // Portfolio-category accounts from contribution summary
  const portfolioAccounts = contribData
    ? [
        ...contribData.people.flatMap((p) =>
          p.accountTypes.filter((at) => isPortfolioParent(at.parentCategory)),
        ),
        ...contribData.jointAccountTypes.filter((at) =>
          isPortfolioParent(at.parentCategory),
        ),
      ]
    : [];

  // API balance overlay — per tracked account (two accounts can share a type)
  const apiBalances = (brokerageData?.apiBalances ?? []).filter(
    (ab) => ab.source === "api",
  );
  const budgetLinks = brokerageData?.budgetLinks ?? [];

  // Deflation (Today's $ / Future $) — same pattern as retirement
  const inflationRate = Number(data.settings.annualInflation);
  const deflator = flatDeflator(new Date().getFullYear(), inflationRate);
  const deflate = (value: number, year: number) =>
    dollarMode === "nominal" ? value : toTodaysDollars(value, year, deflator);

  // Funding sources
  const totalDirectContrib = sumBy(portfolioAccounts, (at) => at.totalContrib);
  const firstYear = brokerageResult.projectionByYear[0];
  const totalOverflow = firstYear?.overflow ?? 0;
  const accYears = data.result.projectionByYear.filter(
    (yr) => yr.phase === "accumulation",
  );
  const firstAccYear = accYears[0] as
    import("@/lib/pure/engine/types").EngineAccumulationYear | undefined;
  const brokerageRamp = firstAccYear?.brokerageRampContribution ?? 0;

  const activeProfileName =
    activeProfileId != null
      ? (contribProfiles?.find((p) => p.id === activeProfileId)?.name ?? null)
      : null;
  const hasContextOverrides = activeProfileName != null;

  return (
    <div>
      <PageHeader
        title="Brokerage Projection"
        subtitle="Non-retirement investment accounts"
      />

      {hasContextOverrides && (
        <div className="border-subtle bg-surface-secondary text-muted mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-4 py-2 text-xs">
          <span className="text-secondary font-medium">Projection basis:</span>
          <span>
            Contribution profile:{" "}
            <span className="text-primary font-medium">
              {activeProfileName}
            </span>
          </span>
          <HelpTip text="These settings are applied to both the funding summary and the year-by-year projection. Change them on the Paycheck page." />
        </div>
      )}

      {portfolioBrokerageAccounts.length > 0 && (
        <Card title="Cost Basis" className="mt-4">
          <CostBasisEditor
            accounts={portfolioBrokerageAccounts}
            canEdit={canEditCostBasis}
            onSave={(performanceAccountId, costBasis) =>
              updateCostBasis.mutate({ performanceAccountId, costBasis })
            }
          />
        </Card>
      )}

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Funding Sources */}
        <Card title="Funding Sources" className="lg:col-span-1">
          <FundingSources
            directContrib={totalDirectContrib}
            overflow={totalOverflow}
            ramp={brokerageRamp}
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
            apiBalances={apiBalances}
            budgetLinks={budgetLinks}
          />
        </Card>
      </div>

      {/* Goal Funding Status */}
      {brokerageResult.goals.length > 0 && (
        <Card title="Goal Funding Status" className="mt-6">
          <p className="text-muted mb-2 text-xs">
            Set a target amount and year — the engine withdraws from brokerage
            when the target year arrives and shows whether you are on track.
            <HelpTip text="Goals are automatic: the projection engine deducts the target amount from your brokerage balance in the target year. If the balance is insufficient, the shortfall is shown." />
          </p>
          <GoalStatusTable goals={brokerageResult.goals} />
        </Card>
      )}

      {/* Manage Goals (collapsible) */}
      {canEdit && (
        <div className="mt-6 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h4 className="text-label text-muted font-semibold tracking-wider uppercase">
                Manage Goals
              </h4>
              <HelpTip text="Create, edit, or delete brokerage goals. Each goal defines a target amount and year — the engine automatically withdraws from your brokerage in that year." />
            </div>
            <button
              type="button"
              onClick={() => setIsGoalsOpen(!isGoalsOpen)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                isGoalsOpen
                  ? "bg-surface-strong text-muted hover:text-primary"
                  : "bg-indigo-600 text-white hover:bg-indigo-700"
              }`}
            >
              {isGoalsOpen ? "Done" : "Edit Goals"}
            </button>
          </div>
          {isGoalsOpen && (
            <div className="mt-3">
              <BrokerageGoalsSection />
            </div>
          )}
        </div>
      )}

      {/* Planned Events */}
      {canEdit && (
        <Card title="Planned Events" className="mt-6">
          <p className="text-muted mb-2 text-xs">
            One-time injections or withdrawals that modify the projection
            (bonus, inheritance, down payment).
            <HelpTip text="Unlike goals (which set a target and let the engine decide if it's funded), planned events directly add or remove dollars in a specific year." />
          </p>
          {brokerageLumpSums.length > 0 && (
            <div className="mb-3 space-y-1">
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
              data.result.projectionByYear[0]?.individualAccountBalances
                .filter((ia) => isPortfolioParent(ia.parentCategory))
                .map((ia) => ({
                  name: ia.name,
                  category: ia.category,
                  taxType: ia.taxType,
                })) ?? []
            }
            onAdd={(ls) => setBrokerageLumpSums((prev) => [...prev, ls])}
            allowWithdrawals
            investedAtStartOf={(year) =>
              investedAtStartOf(data.result.projectionByYear, year)
            }
          />
        </Card>
      )}

      {/* Year-by-Year Projection */}
      <Card title="Year-by-Year Projection" className="mt-6">
        <div className="mb-3 flex items-center justify-end">
          <div className="bg-surface-primary inline-flex rounded-md border p-0.5">
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
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
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
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          {brokerageResult.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-700">
              {maskAmountsInText(w)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
