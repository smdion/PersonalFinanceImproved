import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { computeTaxBucketProjection } from "@/lib/pure/accounts/tax-buckets/tax-bucket-projection";
import type { FocusStateValue } from "@/lib/config/focus-topics";
import type { DollarBasis } from "@/lib/config/enum-values";
import type { buildBuckets } from "./tax-buckets-grouping";
import { BUCKET_KEYS, BUCKET_META } from "./tax-buckets-grouping";
import type { trpc, RouterOutputs, RouterError } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HelpTip } from "@/components/ui/help-tip";
import { AccountDetailRow } from "./tax-buckets-account-row";
import type { AccountAnalysisEntry } from "@/lib/pure/accounts/tax-buckets/tax-bucket-analysis";
import { FocusTarget } from "@/components/ui/focus-target";
import { KpiCard } from "@/components/retirement-projection/kpi-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import type { Dispatch, SetStateAction } from "react";

export type TaxBucketSummaryProps = {
  activeEntries: AccountAnalysisEntry[] | null;
  buckets: ReturnType<typeof buildBuckets>["buckets"];
  canEdit: boolean;
  fmt: (amount: number) => string;
  updateRothBasis: ReturnType<
    typeof trpc.taxBuckets.updateRothBasis.useMutation
  >;
  updateSeparationDate: ReturnType<
    typeof trpc.taxBuckets.updateSeparationDate.useMutation
  >;
  view: FocusStateValue<"taxBucketsView">;
};

/** The household bucket summary, with each bucket's expandable per-account detail. */
export function TaxBucketSummary({
  activeEntries,
  buckets,
  canEdit,
  fmt,
  updateRothBasis,
  updateSeparationDate,
  view,
}: TaxBucketSummaryProps) {
  return (
    <>
      {/* Household-first bucket summary + expandable per-account detail */}
      {activeEntries !== null &&
        BUCKET_KEYS.map((key) => {
          const b = buckets.get(key);
          if (!b || b.entries.length === 0) return null;
          const meta = BUCKET_META[key];
          const hasSplit = b.accessibleNow > 0 || b.locked > 0;

          return (
            <Card
              key={key}
              title={
                <span className="inline-flex items-center gap-1">
                  {meta.label}
                  {meta.helpText && <HelpTip text={meta.helpText} />}
                </span>
              }
              headerRight={
                <span className="text-lg font-semibold tabular-nums">
                  {fmt(b.balance)}
                </span>
              }
            >
              {hasSplit && (
                <div className="text-caption flex flex-wrap gap-4">
                  <span className="flex items-center gap-1">
                    <Badge color="green">
                      {view === "now"
                        ? "accessible now"
                        : "accessible at retirement"}
                    </Badge>
                    <span className="tabular-nums">{fmt(b.accessibleNow)}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Badge color="amber">locked</Badge>
                    <span className="tabular-nums">{fmt(b.locked)}</span>
                  </span>
                  {b.excludedJoint > 0 && (
                    <span className="text-faint">
                      +{fmt(b.excludedJoint)} in joint accounts not included in
                      this split
                    </span>
                  )}
                </div>
              )}

              <details className="group mt-3">
                <summary className="text-caption text-muted cursor-pointer select-none">
                  Per-account detail ({b.entries.length})
                </summary>
                <div className="mt-3 space-y-4">
                  {b.entries.map((entry) => (
                    <AccountDetailRow
                      key={`${entry.performanceAccountId}-${entry.taxType}-${entry.ownerPersonId}`}
                      entry={entry}
                      view={view}
                      fmt={fmt}
                      canEdit={canEdit && view === "now"}
                      onSaveRothBasis={(v) =>
                        updateRothBasis.mutate({
                          performanceAccountId: entry.performanceAccountId!,
                          ownerPersonId: entry.ownerPersonId!,
                          ...v,
                        })
                      }
                      onSaveSeparationDate={(date) =>
                        updateSeparationDate.mutate({
                          performanceAccountId: entry.performanceAccountId!,
                          separationDate: date,
                        })
                      }
                    />
                  ))}
                </div>
              </details>
            </Card>
          );
        })}
    </>
  );
}

export type TaxBucketKpisProps = {
  activeEntries: AccountAnalysisEntry[] | null;
  fmt: (amount: number) => string;
  householdAccessible: number;
  householdLocked: number;
  householdTotal: number;
  view: FocusStateValue<"taxBucketsView">;
};

/** The hero figures: the buckets' total, accessible and locked amounts. */
export function TaxBucketKpis({
  activeEntries,
  fmt,
  householdAccessible,
  householdLocked,
  householdTotal,
  view,
}: TaxBucketKpisProps) {
  return (
    <>
      {/* Hero KPIs (Retirement page card style), shown only once entries exist
          so "at retirement" never shows zeroed KPIs while loading. */}
      {activeEntries !== null && (
        <FocusTarget
          topic="earlyAccess"
          className="grid grid-cols-2 gap-3 md:grid-cols-3"
        >
          <KpiCard label="Total across these buckets">
            <div className="text-primary text-xl font-bold tabular-nums">
              {fmt(householdTotal)}
            </div>
          </KpiCard>
          <KpiCard
            label={
              view === "now" ? "Accessible now" : "Accessible at retirement"
            }
            tooltip={[
              view === "now"
                ? "Sum of every slice that's penalty-free today across the household — not necessarily tax-free, just not subject to the 10% early-withdrawal penalty."
                : "Sum of every slice that's projected to be penalty-free at your household's retirement transition — not necessarily tax-free, just not subject to the 10% early-withdrawal penalty.",
            ]}
          >
            <div className="text-xl font-bold text-green-600 tabular-nums">
              {fmt(householdAccessible)}
            </div>
          </KpiCard>
          <KpiCard
            label="Locked"
            tooltip={[
              view === "now"
                ? "Sum of every slice that would incur the 10% early-withdrawal penalty today."
                : "Sum of every slice that would still incur the 10% early-withdrawal penalty at your household's retirement transition.",
            ]}
          >
            <div className="text-xl font-bold text-amber-600 tabular-nums">
              {fmt(householdLocked)}
            </div>
          </KpiCard>
        </FocusTarget>
      )}
    </>
  );
}

export type TaxBucketsRetirementNotesProps = {
  projection: ReturnType<typeof computeTaxBucketProjection> | null;
  projectionQuery: UseTRPCQueryResult<
    RouterOutputs["projection"]["computeProjection"],
    RouterError
  >;
  view: FocusStateValue<"taxBucketsView">;
};

/** The At Retirement view's loading line, its failed state and its notes. */
export function TaxBucketsRetirementNotes({
  projection,
  projectionQuery,
  view,
}: TaxBucketsRetirementNotesProps) {
  return (
    <>
      {view === "atRetirement" && projectionQuery.isLoading && (
        <Skeleton className="h-24" />
      )}

      {view === "atRetirement" &&
        !projectionQuery.isLoading &&
        projection?.transitionYear == null && (
          <EmptyState
            message="Already at or past your modeled retirement transition"
            hint="There's no future accumulation phase left to project — the current projection either has retirement already behind it or isn't configured yet."
          />
        )}

      {view === "atRetirement" &&
        projection &&
        projection.transitionYear != null &&
        (projection.unmatchedAccountNames.length > 0 ||
          projection.staleBasisAccountNames.length > 0) && (
          <div className="text-caption space-y-1 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            {projection.unmatchedAccountNames.length > 0 && (
              <p>
                No projected data found for:{" "}
                {projection.unmatchedAccountNames.join(", ")} — showing
                today&apos;s balance unchanged rather than guessing.
              </p>
            )}
            {projection.staleBasisAccountNames.length > 0 && (
              <p>
                Roth basis for {projection.staleBasisAccountNames.join(", ")}{" "}
                hasn&apos;t been updated since before this year — the projected
                total may understate what&apos;s actually accessible.
              </p>
            )}
          </div>
        )}
    </>
  );
}

export type TaxBucketsHeaderProps = {
  canEdit: boolean;
  dollarMode: DollarBasis;
  projection: ReturnType<typeof computeTaxBucketProjection> | null;
  setDollarMode: Dispatch<SetStateAction<DollarBasis>>;
  setShowBulkBasis: Dispatch<SetStateAction<boolean>>;
  setView: (value: FocusStateValue<"taxBucketsView">) => void;
  view: FocusStateValue<"taxBucketsView">;
};

/** The page header, with the bulk basis button, and the Now / At Retirement tabs. */
export function TaxBucketsHeader({
  canEdit,
  dollarMode,
  projection,
  setDollarMode,
  setShowBulkBasis,
  setView,
  view,
}: TaxBucketsHeaderProps) {
  return (
    <>
      <PageHeader
        title="Tax buckets & basis"
        subtitle={
          view === "now"
            ? "What the household actually has, where, and how much is accessible penalty-free if you retire early — not a target ratio, a real liquidity check."
            : projection?.transitionYear != null
              ? `Projected at your household's retirement transition (${projection.transitionYear}) — assumes contributions continue as configured. Never mixed with today's real numbers.`
              : "Projected at your household's retirement transition — assumes contributions continue as configured. Never mixed with today's real numbers."
        }
      >
        {canEdit && view === "now" && (
          <button
            type="button"
            onClick={() => setShowBulkBasis(true)}
            className="bg-primary rounded px-3 py-1.5 text-sm text-white"
          >
            Update all basis
          </button>
        )}
      </PageHeader>

      {/* "Now" / "At Retirement" toggle — two clearly-labeled tabs, never a
          silent switch. Default "now"; "at retirement" only fetches the
          (heavier, cache-backed) projection once selected. */}
      <div className="border-subtle flex items-center justify-between border-b">
        <Tabs
          look="underline-neutral"
          value={view}
          onChange={setView}
          tabs={[
            { value: "now", label: "Now" },
            { value: "atRetirement", label: "At Retirement" },
          ]}
        />
        {/* Only meaningful for "At Retirement" — "Now" figures are already
            today's dollars, so deflating them is a no-op there. */}
        {view === "atRetirement" && (
          <div className="border-subtle bg-surface mb-1 inline-flex rounded-md border p-0.5">
            {[
              { key: "real" as const, label: "Today's $" },
              { key: "nominal" as const, label: "Future $" },
            ].map((mode) => (
              <button
                key={mode.key}
                type="button"
                onClick={() => setDollarMode(mode.key)}
                className={`rounded px-2.5 py-1 text-xs font-medium ${
                  dollarMode === mode.key
                    ? "bg-primary text-white"
                    : "text-muted hover:text-primary"
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
