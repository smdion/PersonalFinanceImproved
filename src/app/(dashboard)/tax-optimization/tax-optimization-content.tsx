"use client";

/**
 * Tax Optimization — client content.
 *
 * Two decision tools that run the projection engine N times and score the
 * results: the Roth-conversion explorer (search the household's real
 * marginal brackets for the conversion ceiling that minimises lifetime
 * tax) and the withdrawal-strategy comparison (rank sequencing strategies
 * by lifetime tax + terminal balance). Neither is a "view" of a single
 * run — that lives on the Retirement page.
 *
 * Assumptions are NOT edited here with bespoke controls — the same
 * `AssumptionsBand` the Retirement page uses is embedded, bound to the
 * active Retirement Profile, so a change saves to the profile and every
 * surface recomputes (via the `projection` invalidation the band fires).
 *
 * `projectTaxYears` is still queried — not to render a table, but for the
 * IRMAA-exposure callout and the "brackets current through {year}" note.
 */
import { NotConfiguredNotice } from "@/components/ui/not-configured-notice";
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryBoundary, queryPending } from "@/components/ui/query-boundary";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useActiveRetirementProfile } from "@/lib/hooks/use-active-retirement-profile";
import { AssumptionsBand } from "@/components/retirement/assumptions-band";
import { Tabs, tabPanelProps } from "@/components/ui/tabs";
import { RothExplorer } from "@/components/tax-optimization/roth-explorer";
import { WithdrawalComparison } from "@/components/tax-optimization/withdrawal-comparison";
import { IrmaaCliffAlert } from "@/components/tax-optimization/irmaa-cliff-alert";

type Tab = "roth" | "strategies";

export function TaxOptimizationContent() {
  const admin = isAdmin(useUser());
  const [tab, setTab] = useState<Tab>("roth");

  // --- Retirement Profile axis (same resolution as the Retirement page) ---
  const [activeRetirementId, setActiveRetirementId] =
    useActiveRetirementProfile();
  const retirementProfilesQuery =
    trpc.retirement.retirementProfiles.list.useQuery();
  const retirementProfiles = retirementProfilesQuery.data ?? [];
  const { profileId: effectiveRetirementProfileId } = useEffectiveProfileId(
    "retirement",
    {
      validIds: retirementProfiles.map((p) => p.id),
      localSelection: null,
      activeProfileId: activeRetirementId,
    },
  );

  const selection = useMemo(
    () =>
      effectiveRetirementProfileId != null
        ? { selection: { retirement: effectiveRetirementProfileId } }
        : {},
    [effectiveRetirementProfileId],
  );

  const utils = trpc.useUtils();

  // Settings / per-person settings for the assumptions band, without the
  // engine run: the same query the Retirement page uses.
  const metaQuery = trpc.projection.getProjectionMetadata.useQuery(selection, {
    placeholderData: (prev) => prev,
  });
  const meta = metaQuery.data;

  const taxQuery = trpc.projection.projectTaxYears.useQuery(selection, {
    placeholderData: (prev) => prev,
  });

  const bracketYear = taxQuery.data?.meta?.bracketsThroughYear ?? null;
  const rows = taxQuery.data?.rows ?? [];

  if (queryPending([metaQuery, taxQuery])) {
    return (
      <QueryBoundary
        query={[metaQuery, taxQuery]}
        frame={(body) => (
          <div className="space-y-4">
            <PageHeader title="Roth & conversions" />
            {body}
          </div>
        )}
        fallback={
          <>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-96 w-full" />
          </>
        }
      />
    );
  }

  if (taxQuery.data && "notConfigured" in taxQuery.data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Roth & conversions" />
        <NotConfiguredNotice reason={taxQuery.data.notConfigured} />
      </div>
    );
  }

  if (!meta || !("settings" in meta) || rows.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeader title="Roth & conversions" />
        <EmptyState
          message="No retirement projection yet"
          hint="Set retirement age, return rates, and a retirement budget on the Retirement page — the conversion and withdrawal-strategy tools need a plan to optimise against."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Roth & conversions"
        subtitle="Roth-conversion timing and withdrawal-sequencing strategies that minimise lifetime tax — modelled on your active Retirement Profile."
      >
        {bracketYear != null && (
          <span className="text-caption text-muted rounded border px-2 py-1">
            Tax brackets current through {bracketYear}
          </span>
        )}
      </PageHeader>

      <AssumptionsBand
        settings={meta.settings}
        perPersonSettings={meta.perPersonSettings}
        profiles={retirementProfiles}
        activeProfileId={effectiveRetirementProfileId}
        onActivate={(id) => {
          setActiveRetirementId(id);
          utils.projection.invalidate();
        }}
        admin={admin}
      />

      <IrmaaCliffAlert rows={rows} />

      <div className="rounded-lg border">
        <Tabs
          look="folder"
          id="tax-optimization"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "roth", label: "Roth conversion explorer" },
            { value: "strategies", label: "Withdrawal-strategy comparison" },
          ]}
        />
        <div className="p-3" {...tabPanelProps("tax-optimization", tab)}>
          {tab === "roth" ? (
            <RothExplorer selection={selection} />
          ) : (
            <WithdrawalComparison selection={selection} />
          )}
        </div>
      </div>
    </div>
  );
}
