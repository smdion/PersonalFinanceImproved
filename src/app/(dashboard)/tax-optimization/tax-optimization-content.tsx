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
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useActiveRetirementProfile } from "@/lib/hooks/use-active-retirement-profile";
import { AssumptionsBand } from "@/components/retirement/assumptions-band";
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
  const [viewingRetirementId, setViewingRetirementId] = useState<number | null>(
    null,
  );
  const { profileId: effectiveRetirementProfileId, source: profileSource } =
    useEffectiveProfileId("retirement", {
      validIds: retirementProfiles.map((p) => p.id),
      localSelection: viewingRetirementId,
      globalDefaultId: activeRetirementId,
    });

  const selection = useMemo(
    () =>
      effectiveRetirementProfileId != null
        ? { retirementProfileId: effectiveRetirementProfileId }
        : {},
    [effectiveRetirementProfileId],
  );

  const utils = trpc.useUtils();

  // Settings / per-person settings for the assumptions band — metadataOnly
  // skips the heavy projection, same call the Retirement page uses.
  const metaQuery = trpc.projection.computeProjection.useQuery(
    { metadataOnly: true as const, ...selection },
    { placeholderData: (prev) => prev },
  );
  const meta = metaQuery.data;

  const taxQuery = trpc.projection.projectTaxYears.useQuery(selection, {
    placeholderData: (prev) => prev,
  });

  const bracketYear = taxQuery.data?.meta?.bracketsThroughYear ?? null;
  const rows = taxQuery.data?.rows ?? [];

  if (metaQuery.isLoading || taxQuery.isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Tax Optimization" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!meta || !("settings" in meta) || rows.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeader title="Tax Optimization" />
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
        title="Tax Optimization"
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
        viewingProfileId={effectiveRetirementProfileId}
        onViewingProfileChange={setViewingRetirementId}
        activeProfileId={activeRetirementId}
        onActivate={(id) => {
          setActiveRetirementId(id);
          utils.projection.invalidate();
        }}
        effectiveSource={profileSource}
        admin={admin}
      />

      <IrmaaCliffAlert rows={rows} />

      <div className="rounded-lg border">
        <div className="flex gap-1 border-b px-3 pt-2">
          <TabButton active={tab === "roth"} onClick={() => setTab("roth")}>
            Roth conversion explorer
          </TabButton>
          <TabButton
            active={tab === "strategies"}
            onClick={() => setTab("strategies")}
          >
            Withdrawal-strategy comparison
          </TabButton>
        </div>
        <div className="p-3">
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

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-surface-primary text-primary border border-b-0"
          : "text-muted hover:text-secondary"
      }`}
    >
      {children}
    </button>
  );
}
