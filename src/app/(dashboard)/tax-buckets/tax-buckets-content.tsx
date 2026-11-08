"use client";

import { useMemo, useState } from "react";
import { useFocusedState } from "@/lib/hooks/use-focus";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryBoundary, queryPending } from "@/components/ui/query-boundary";
import { SlidePanel } from "@/components/ui/slide-panel";
import { formatCurrency } from "@/lib/utils/format";
import { DEFAULT_INFLATION_RATE } from "@/lib/constants";
import { computeTaxBucketProjection } from "@/lib/pure/accounts/tax-bucket-projection";
import { useEffectiveContribProfileId } from "@/lib/hooks/use-effective-contrib-profile-id";
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";
import { flatDeflator, toTodaysDollars } from "@/lib/pure/simulation/dollars";
import type { DollarBasis } from "@/lib/config/enum-values";
import { profileSelectionFrom } from "@/lib/pure/household/profile-selection";
import { BulkRothBasisForm } from "./tax-buckets-bulk-basis";
import { TaxBucketSummary } from "./tax-buckets-sections";
import { TaxBucketKpis } from "./tax-buckets-sections";
import { TaxBucketsRetirementNotes } from "./tax-buckets-sections";
import { TaxBucketsHeader } from "./tax-buckets-sections";
import { buildBuckets } from "./tax-buckets-grouping";

export function TaxBucketsContent() {
  const user = useUser();
  const canEdit = hasPermission(user, "performance");
  const utils = trpc.useUtils();

  const [showBulkBasis, setShowBulkBasis] = useState(false);
  // A link to early access opens "At Retirement" (lib/config/focus-topics).
  const [view, setView] = useFocusedState("taxBucketsView", "now");
  // "At Retirement" only — "Now" figures are already today's dollars, so
  // deflating them would be a no-op at best and confusing at worst.
  // Mirrors the Retirement page's own "Today's $"/"Future $" toggle
  // (dollarMode "real"/"nominal") and default.
  const [dollarMode, setDollarMode] = useState<DollarBasis>("real");

  const breakdown = trpc.taxBuckets.computeBreakdown.useQuery();
  const { data } = breakdown;
  // Same Plan-pin → globally-active resolution every other engine-backed
  // page uses (Retirement page, Monte Carlo, Coast FIRE). Omitting these
  // does NOT fall back to "whatever's active" — the server has no default
  // profile to resolve to, so every contribution account silently gets $0
  // configured value and the whole target contribution overflows to
  // brokerage.
  const { queryInput: contribPick } = useEffectiveContribProfileId();
  const { queryInput: salaryPick } = useEffectiveSalaryProfileId();
  // Only fetched when the user actually switches to "At Retirement" — the
  // "now" view stays free of any projected bleed-through, and the page
  // doesn't pay for the heavier call on every visit.
  const projectionQuery = trpc.projection.computeProjection.useQuery(
    { selection: profileSelectionFrom({ ...contribPick, ...salaryPick }) },
    { enabled: view === "atRetirement" },
  );

  const updateRothBasis = trpc.taxBuckets.updateRothBasis.useMutation({
    onSuccess: () => utils.taxBuckets.computeBreakdown.invalidate(),
  });
  const updateSeparationDate = trpc.taxBuckets.updateSeparationDate.useMutation(
    {
      onSuccess: () => utils.taxBuckets.computeBreakdown.invalidate(),
    },
  );
  const batchUpdateRothBasis = trpc.taxBuckets.batchUpdateRothBasis.useMutation(
    {
      onSuccess: () => {
        utils.taxBuckets.computeBreakdown.invalidate();
        setShowBulkBasis(false);
      },
    },
  );

  const projection = useMemo(() => {
    if (!data || !projectionQuery.data?.result) return null;
    // Rule of 55 forecasting override -- must read the SAME
    // per-person setting the retirement engine reads, or this page and the
    // retirement projection would disagree about the same account's
    // eligibility. `perPersonSettings` rides on the same query result.
    const ruleOf55OverrideByPersonId =
      "perPersonSettings" in projectionQuery.data
        ? new Map(
            projectionQuery.data.perPersonSettings.map((ps) => [
              ps.personId,
              ps.ruleOf55Override,
            ]),
          )
        : undefined;
    // Each person's retirement year — the same figure the engine uses for
    // when a still-active job ends.
    const birthYears = new Map(data.people.map((p) => [p.id, p.birthYear]));
    const retirementYearByPersonId =
      "perPersonSettings" in projectionQuery.data
        ? new Map(
            projectionQuery.data.perPersonSettings.flatMap((ps) => {
              const by = birthYears.get(ps.personId);
              return by != null
                ? [[ps.personId, by + ps.retirementAge] as const]
                : [];
            }),
          )
        : undefined;
    return computeTaxBucketProjection({
      nowEntries: data.accounts,
      projectionByYear: projectionQuery.data.result.projectionByYear,
      people: data.people,
      ruleOf55OverrideByPersonId,
      retirementYearByPersonId,
    });
  }, [data, projectionQuery.data]);

  // Same deflation formula as the Retirement page's own dollarMode —
  // real (today's $) divides out inflation between now and the
  // transition year; nominal shows the figure exactly as projected.
  const projectionSettings =
    projectionQuery.data && "settings" in projectionQuery.data
      ? projectionQuery.data.settings
      : undefined;
  const inflationRate =
    projectionSettings?.annualInflation != null
      ? Number(projectionSettings.annualInflation)
      : DEFAULT_INFLATION_RATE;
  const deflator = flatDeflator(new Date().getFullYear(), inflationRate);
  const deflate = (amount: number) =>
    dollarMode === "nominal" || !projection?.transitionYear
      ? amount
      : toTodaysDollars(amount, projection.transitionYear, deflator);
  const fmt = (amount: number) =>
    formatCurrency(view === "atRetirement" ? deflate(amount) : amount);

  // No data and no error: the query is paused (offline), still waiting.
  if (queryPending(breakdown) || !data) {
    return (
      <QueryBoundary
        query={breakdown}
        frame={(body) => (
          <div className="p-4 sm:p-6">
            <PageHeader title="Tax buckets & basis" />
            {body}
          </div>
        )}
        fallback={<Skeleton className="h-64" />}
      />
    );
  }

  // Never merge the two views' entries — "At Retirement" only renders once
  // its own projection has actually resolved, so a stale "now" number can
  // never masquerade as a projected one.
  const activeEntries =
    view === "now" ? data.accounts : (projection?.entries ?? null);
  const { buckets, householdTotal, householdAccessible, householdLocked } =
    buildBuckets(activeEntries ?? []);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <TaxBucketsHeader
        canEdit={canEdit}
        dollarMode={dollarMode}
        projection={projection}
        setDollarMode={setDollarMode}
        setShowBulkBasis={setShowBulkBasis}
        setView={setView}
        view={view}
      />

      <TaxBucketsRetirementNotes
        projection={projection}
        projectionQuery={projectionQuery}
        view={view}
      />

      <TaxBucketKpis
        activeEntries={activeEntries}
        fmt={fmt}
        householdAccessible={householdAccessible}
        householdLocked={householdLocked}
        householdTotal={householdTotal}
        view={view}
      />

      <TaxBucketSummary
        activeEntries={activeEntries}
        buckets={buckets}
        canEdit={canEdit}
        fmt={fmt}
        updateRothBasis={updateRothBasis}
        updateSeparationDate={updateSeparationDate}
        view={view}
      />

      <SlidePanel
        isOpen={showBulkBasis}
        onClose={() => setShowBulkBasis(false)}
        title="Update all Roth basis"
      >
        <BulkRothBasisForm
          accounts={data.accounts}
          onSave={(entries) => batchUpdateRothBasis.mutate({ entries })}
          isSaving={batchUpdateRothBasis.isPending}
          error={batchUpdateRothBasis.error?.message ?? null}
        />
      </SlidePanel>
    </div>
  );
}
