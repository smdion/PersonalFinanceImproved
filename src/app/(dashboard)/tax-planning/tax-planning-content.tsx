"use client";

/**
 * Tax Planning — client content.
 *
 * Year-by-year tax projection (always visible) plus Roth-conversion and
 * withdrawal-strategy tabs. Assumptions are NOT edited here with bespoke
 * controls — the same `AssumptionsBand` the Retirement page uses is
 * embedded, bound to the active Retirement Profile, so a change saves to
 * the profile and every surface (including this page's table, via the
 * `projection` invalidation the band already fires) recomputes.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { useActiveRetirementProfile } from "@/lib/hooks/use-active-retirement-profile";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { AssumptionsBand } from "@/components/retirement/assumptions-band";
import { YearProjectionTable } from "@/components/tax-planning/year-projection-table";
import { RothExplorer } from "@/components/tax-planning/roth-explorer";
import { WithdrawalComparison } from "@/components/tax-planning/withdrawal-comparison";
import { IrmaaCliffAlert } from "@/components/tax-planning/irmaa-cliff-alert";

type Tab = "roth" | "strategies";

export function TaxPlanningContent() {
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

  if (metaQuery.isLoading || taxQuery.isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Tax Planning" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (
    !meta ||
    !("settings" in meta) ||
    (taxQuery.data?.rows.length ?? 0) === 0
  ) {
    return (
      <div className="space-y-4">
        <PageHeader title="Tax Planning" />
        <EmptyState
          message="No retirement projection yet"
          hint="Set retirement age, return rates, and a retirement budget on the Retirement page to see a year-by-year tax projection here."
        />
      </div>
    );
  }

  const rows = taxQuery.data!.rows;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tax Planning"
        subtitle="Year-by-year tax projection, Roth conversions, and withdrawal-strategy comparison — from your active Retirement Profile."
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

      <YearProjectionTable rows={rows} />

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
