"use client";

/** Client content for the Brokerage page — prefetched by page.tsx. */

import { flatDeflator, toTodaysDollars } from "@/lib/pure/simulation/dollars";
import type { DollarBasis } from "@/lib/config/enum-values";
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { calculateBrokerageGoals } from "@/lib/pure/savings/brokerage-goals";
import type { AccumOverride } from "@/components/retirement-projection/types";
import { isPortfolioParent, tracksCostBasis } from "@/lib/config/account-types";
import { sumBy } from "@/lib/utils/math";
import { SkeletonTable } from "@/components/ui/skeleton";
import { QueryBoundary, queryPending } from "@/components/ui/query-boundary";
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";
import { profileSelectionFrom } from "@/lib/pure/household/profile-selection";
import { useBrokerageLumpSums } from "./use-brokerage-lump-sums";
import { BrokerageYearSection } from "./brokerage-sections";
import { BrokerageGoalsPanel } from "./brokerage-sections";
import { BrokerageFundingPanel } from "./brokerage-sections";

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

      <BrokerageFundingPanel
        activeProfileName={activeProfileName}
        apiBalances={apiBalances}
        brokerageRamp={brokerageRamp}
        budgetLinks={budgetLinks}
        canEdit={canEdit}
        canEditCostBasis={canEditCostBasis}
        hasContextOverrides={hasContextOverrides}
        portfolioAccounts={portfolioAccounts}
        portfolioBrokerageAccounts={portfolioBrokerageAccounts}
        totalDirectContrib={totalDirectContrib}
        totalOverflow={totalOverflow}
        updateCostBasis={updateCostBasis}
        upsertSetting={upsertSetting}
      />

      <BrokerageGoalsPanel
        brokerageLumpSums={brokerageLumpSums}
        brokerageResult={brokerageResult}
        canEdit={canEdit}
        data={data}
        isGoalsOpen={isGoalsOpen}
        setBrokerageLumpSums={setBrokerageLumpSums}
        setIsGoalsOpen={setIsGoalsOpen}
      />

      {/* Year-by-Year Projection */}
      <BrokerageYearSection
        brokerageResult={brokerageResult}
        deflate={deflate}
        dollarMode={dollarMode}
        setDollarMode={setDollarMode}
      />
    </div>
  );
}
