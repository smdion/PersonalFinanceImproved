import type { DollarBasis } from "@/lib/config/enum-values";
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import type { AccumOverride } from "@/components/retirement-projection/types";
import { isPortfolioParent, tracksCostBasis } from "@/lib/config/account-types";
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";
import { profileSelectionFrom } from "@/lib/pure/household/profile-selection";
import { useBrokerageLumpSums } from "./use-brokerage-lump-sums";

/** The Brokerage page's queries, mutations and local state, in the order it calls them. */
export function useBrokeragePage() {
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
      const amount = parseFloat(ls.amount);
      if (isNaN(y) || isNaN(amount) || amount === 0) continue;
      let ov = byYear.get(y);
      if (!ov) {
        ov = { year: y, lumpSums: [] };
        byYear.set(y, ov);
      }
      ov.lumpSums!.push({
        id: ls.id,
        amount: Math.abs(amount),
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
  const contributionInput = {
    ...(activeProfileId != null
      ? { contributionProfileId: activeProfileId }
      : {}),
    ...salaryProfileInput,
  };
  const engineInput = {
    ...(mergedAccumOverrides
      ? { accumulationOverrides: mergedAccumOverrides }
      : {}),
    selection: profileSelectionFrom(contributionInput),
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
  const { data: contributionData } =
    trpc.contribution.computeSummary.useQuery(contributionInput);
  const { data: brokerageData } = trpc.brokerage.computeSummary.useQuery();
  const { data: contributionProfiles } =
    trpc.contributionProfile.list.useQuery();
  const upsertSetting = trpc.settings.appSettings.upsert.useMutation({
    onSuccess: () => utils.invalidate(),
  });
  const [isGoalsOpen, setIsGoalsOpen] = useState(false);
  const [dollarMode, setDollarMode] = useState<DollarBasis>("nominal");

  return {
    canEdit,
    canEditCostBasis,
    portfolioBrokerageAccounts,
    updateCostBasis,
    activeProfileId,
    brokerageLumpSums,
    setBrokerageLumpSums,
    savedAccumQuery,
    projectionQuery,
    data,
    isLoading,
    contributionData,
    brokerageData,
    contributionProfiles,
    upsertSetting,
    isGoalsOpen,
    setIsGoalsOpen,
    dollarMode,
    setDollarMode,
  };
}
