"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HelpTip } from "@/components/ui/help-tip";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { SlidePanel } from "@/components/ui/slide-panel";
import { KpiCard } from "@/components/cards/projection/projection-hero-kpis";
import { formatCurrency } from "@/lib/utils/format";
import { computeTaxBucketProjection } from "@/lib/pure/tax-bucket-projection";
import { useEffectiveContribProfileId } from "@/lib/hooks/use-effective-contrib-profile-id";
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";
import type { AccountAnalysisEntry } from "@/lib/pure/tax-bucket-analysis";

// The pure type, not a tRPC-inferred one — inferRouterOutputs types
// `rothBasisMeta.updatedAt` as `Date` (the procedure's TS return type),
// but it actually arrives as an ISO string (no superjson transformer on
// this router). Using the pure AccountAnalysisEntry type (whose
// `updatedAt` is `Date | string` for exactly this reason) lets "now" data
// (from the wire) and "at retirement" data (computed client-side by
// computeTaxBucketProjection, same pure type) share one type everywhere
// on this page instead of fighting a spurious Date-vs-string mismatch.
type AccountEntry = AccountAnalysisEntry;

type ViewMode = "now" | "atRetirement";

/** Household-first: group every account entry into one of the 5 buckets,
 *  summing balance + accessible-now/locked across BOTH people. Brokerage
 *  is unconditionally penalty-free regardless of owner (no age/employer
 *  gate at all), so a jointly-owned brokerage entry — which skips
 *  per-person early-access computation entirely — still counts its full
 *  balance as accessible; other jointly-owned entries (rare in practice)
 *  are excluded from the accessible/locked split and called out.
 *
 *  Shared between the "Now" and "At Retirement" views — same grouping
 *  logic, fed a different `entries` array. */
function buildBuckets(entries: AccountEntry[]) {
  const buckets = new Map<
    BucketKey,
    {
      balance: number;
      accessibleNow: number;
      locked: number;
      excludedJoint: number;
      entries: AccountEntry[];
    }
  >();
  for (const entry of entries) {
    const key = bucketKeyFor(entry);
    if (!buckets.has(key)) {
      buckets.set(key, {
        balance: 0,
        accessibleNow: 0,
        locked: 0,
        excludedJoint: 0,
        entries: [],
      });
    }
    const b = buckets.get(key)!;
    b.balance += entry.balance;
    b.entries.push(entry);
    if (entry.slices.length > 0) {
      for (const slice of entry.slices) {
        if (slice.penaltyFree) b.accessibleNow += slice.amount;
        else b.locked += slice.amount;
      }
    } else if (key === "brokerage") {
      b.accessibleNow += entry.balance;
    } else if (entry.ownerPersonId == null) {
      b.excludedJoint += entry.balance;
    }
  }

  let householdTotal = 0;
  let householdAccessible = 0;
  let householdLocked = 0;
  for (const b of buckets.values()) {
    householdTotal += b.balance;
    householdAccessible += b.accessibleNow;
    householdLocked += b.locked;
  }

  return { buckets, householdTotal, householdAccessible, householdLocked };
}

type BucketKey =
  "traditional" | "rothIra" | "rothEmployer" | "brokerage" | "hsa";

const BUCKET_META: Record<BucketKey, { label: string; helpText?: string }> = {
  traditional: { label: "Traditional" },
  rothIra: {
    label: "Roth IRA",
    helpText:
      "Real Roth IRA ordering rules: contributions and seasoned conversions come out first, always, before growth.",
  },
  rothEmployer: {
    label: "Roth 401k / 403b",
    helpText:
      "IRS pro-rata rule: a distribution from a designated Roth 401k/403b can't cleanly isolate basis — the tax-free fraction is only realized on a full distribution.",
  },
  brokerage: { label: "Brokerage" },
  hsa: { label: "HSA" },
};

function bucketKeyFor(entry: AccountEntry): BucketKey {
  if (entry.category === "brokerage") return "brokerage";
  if (entry.category === "hsa") return "hsa";
  if (entry.taxType !== "taxFree") return "traditional";
  return entry.category === "ira" ? "rothIra" : "rothEmployer";
}

function taxTypeLabel(category: string, taxType: string): string {
  const categoryLabel =
    category === "401k" ? "401k" : category === "403b" ? "403b" : category;
  if (taxType === "taxFree") {
    return category === "ira" ? "Roth IRA" : `Roth ${categoryLabel}`;
  }
  if (taxType === "preTax") {
    return category === "ira"
      ? "Traditional IRA"
      : `Traditional ${categoryLabel}`;
  }
  if (taxType === "afterTax") return "Brokerage";
  if (taxType === "hsa") return "HSA";
  return taxType;
}

function isoDateOnly(d: string | Date | null): string {
  if (!d) return "";
  const s = typeof d === "string" ? d : d.toISOString();
  return s.slice(0, 10);
}

export function TaxBucketsContent() {
  const user = useUser();
  const canEdit = hasPermission(user, "performance");
  const utils = trpc.useUtils();

  const [showBulkBasis, setShowBulkBasis] = useState(false);
  const [view, setView] = useState<ViewMode>("now");

  const { data, isLoading, error } = trpc.taxBuckets.getBreakdown.useQuery();
  // Same Plan-pin → globally-active resolution every other engine-backed
  // page uses (Retirement page, Monte Carlo, Coast FIRE). Omitting these
  // does NOT fall back to "whatever's active" — the server has no default
  // profile to resolve to, so every contribution account silently gets $0
  // configured value and the whole target contribution overflows to
  // brokerage. That's a real bug this page shipped with, caught by a wildly
  // implausible "At Retirement" brokerage total.
  const { queryInput: contribProfileQueryInput } =
    useEffectiveContribProfileId();
  const { queryInput: salaryProfileQueryInput } = useEffectiveSalaryProfileId();
  // Only fetched when the user actually switches to "At Retirement" — the
  // "now" view stays free of any projected bleed-through, and the page
  // doesn't pay for the heavier call on every visit.
  const projectionQuery = trpc.projection.computeProjection.useQuery(
    { ...contribProfileQueryInput, ...salaryProfileQueryInput },
    { enabled: view === "atRetirement" },
  );

  const updateRothBasis = trpc.taxBuckets.updateRothBasis.useMutation({
    onSuccess: () => utils.taxBuckets.getBreakdown.invalidate(),
  });
  const updateSeparationDate = trpc.taxBuckets.updateSeparationDate.useMutation(
    {
      onSuccess: () => utils.taxBuckets.getBreakdown.invalidate(),
    },
  );
  const batchUpdateRothBasis = trpc.taxBuckets.batchUpdateRothBasis.useMutation(
    {
      onSuccess: () => {
        utils.taxBuckets.getBreakdown.invalidate();
        setShowBulkBasis(false);
      },
    },
  );

  const projection = useMemo(() => {
    if (!data || !projectionQuery.data?.result) return null;
    return computeTaxBucketProjection({
      nowEntries: data.accounts,
      projectionByYear: projectionQuery.data.result.projectionByYear,
      people: data.people,
    });
  }, [data, projectionQuery.data]);

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="Tax Buckets" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="Tax Buckets" />
        <EmptyState message="Failed to load" hint="Try refreshing the page." />
      </div>
    );
  }

  const bucketOrder: BucketKey[] = [
    "traditional",
    "rothIra",
    "rothEmployer",
    "brokerage",
    "hsa",
  ];

  // Never merge the two views' entries — "At Retirement" only renders once
  // its own projection has actually resolved, so a stale "now" number can
  // never masquerade as a projected one.
  const activeEntries =
    view === "now" ? data.accounts : (projection?.entries ?? null);
  const { buckets, householdTotal, householdAccessible, householdLocked } =
    buildBuckets(activeEntries ?? []);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <PageHeader
        title="Tax Buckets"
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
            className="px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded"
          >
            Update all basis
          </button>
        )}
      </PageHeader>

      {/* "Now" / "At Retirement" toggle — two clearly-labeled tabs, never a
          silent switch. Default "now"; "at retirement" only fetches the
          (heavier, cache-backed) projection once selected. */}
      <div className="flex gap-1 border-b border-subtle">
        {[
          { key: "now" as const, label: "Now" },
          { key: "atRetirement" as const, label: "At Retirement" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setView(tab.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              view === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted hover:text-primary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

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
          <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-caption text-amber-800 dark:text-amber-300 space-y-1">
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

      {/* Hero KPIs — same card language as the Retirement page's hero row.
          Rendered only once there are real entries to show — for "at
          retirement" that means the projection actually resolved, so a
          zeroed placeholder KPI never appears while it's loading. */}
      {activeEntries !== null && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <KpiCard label="Total across these buckets">
            <div className="text-xl font-bold tabular-nums text-primary">
              {formatCurrency(householdTotal)}
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
            <div className="text-xl font-bold tabular-nums text-green-600">
              {formatCurrency(householdAccessible)}
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
            <div className="text-xl font-bold tabular-nums text-amber-600">
              {formatCurrency(householdLocked)}
            </div>
          </KpiCard>
        </div>
      )}

      {/* Household-first bucket summary + expandable per-account detail */}
      {activeEntries !== null &&
        bucketOrder.map((key) => {
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
                  {formatCurrency(b.balance)}
                </span>
              }
            >
              {hasSplit && (
                <div className="flex flex-wrap gap-4 text-caption">
                  <span className="flex items-center gap-1">
                    <Badge color="green">
                      {view === "now"
                        ? "accessible now"
                        : "accessible at retirement"}
                    </Badge>
                    <span className="tabular-nums">
                      {formatCurrency(b.accessibleNow)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Badge color="amber">locked</Badge>
                    <span className="tabular-nums">
                      {formatCurrency(b.locked)}
                    </span>
                  </span>
                  {b.excludedJoint > 0 && (
                    <span className="text-faint">
                      +{formatCurrency(b.excludedJoint)} in joint accounts not
                      included in this split
                    </span>
                  )}
                </div>
              )}

              <details className="mt-3 group">
                <summary className="cursor-pointer text-caption text-muted select-none">
                  Per-account detail ({b.entries.length})
                </summary>
                <div className="mt-3 space-y-4">
                  {b.entries.map((entry) => (
                    <AccountDetailRow
                      key={`${entry.performanceAccountId}-${entry.taxType}-${entry.ownerPersonId}`}
                      entry={entry}
                      view={view}
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

function AccountDetailRow({
  entry,
  view,
  canEdit,
  onSaveRothBasis,
  onSaveSeparationDate,
}: {
  entry: AccountEntry;
  view: ViewMode;
  canEdit: boolean;
  onSaveRothBasis: (v: {
    contributionBasis: string;
    conversionBasis: string;
    latestConversionYear: number | null;
  }) => void;
  onSaveSeparationDate: (date: string | null) => void;
}) {
  const isRothEditable =
    entry.taxType === "taxFree" &&
    ["ira", "401k", "403b"].includes(entry.category) &&
    entry.performanceAccountId != null &&
    entry.ownerPersonId != null;
  // Hidden while still employed there (source "active") — there's no real
  // separation date to enter yet, and showing a blank editable field
  // invites entering a planned/future date, which is exactly what Rule of
  // 55 must never be evaluated against.
  const isSeparationEditable =
    entry.ruleOf55 !== null &&
    entry.ruleOf55.source !== "active" &&
    entry.performanceAccountId != null;

  return (
    <div className="border-b border-subtle pb-4 last:border-0 last:pb-0">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium">{entry.displayName}</span>
          {entry.ownerName && (
            <span className="ml-2 text-caption text-faint">
              {entry.ownerName}
            </span>
          )}
          <span className="ml-2 text-caption text-faint">
            {taxTypeLabel(entry.category, entry.taxType)}
          </span>
        </div>
        <span className="font-semibold tabular-nums">
          {formatCurrency(entry.balance)}
        </span>
      </div>

      {entry.ruleOf55 && (
        <div className="mt-1 flex items-center gap-2 text-caption">
          <Badge
            color={
              entry.ruleOf55.eligible
                ? "green"
                : entry.ruleOf55.eligible === false
                  ? "amber"
                  : "gray"
            }
          >
            Rule of 55:{" "}
            {entry.ruleOf55.eligible == null
              ? "unknown"
              : entry.ruleOf55.eligible
                ? "eligible"
                : "not yet"}
          </Badge>
          {entry.ruleOf55.separationYear != null && (
            <span className="text-faint">
              separation year {entry.ruleOf55.separationYear} (
              {entry.ruleOf55.source})
            </span>
          )}
          <HelpTip text="Rule of 55: separating from that plan's employer in or after the year you turn 55 grants permanent penalty-free access to that specific plan — even if it later sits dormant. Rolling it into an IRA forfeits this for that money. Many plans only permit a lump-sum withdrawal, not partial, once separated." />
        </div>
      )}

      {entry.slices.length > 0 && (
        <div className="mt-2 space-y-1">
          {entry.slices.map((slice) => (
            <div
              key={slice.label}
              className="flex items-center justify-between text-caption"
            >
              <span className="text-muted">{slice.label}</span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">
                  {formatCurrency(slice.amount)}
                </span>
                <Badge color={slice.penaltyFree ? "green" : "amber"}>
                  {slice.penaltyFree ? "penalty-free" : "10% penalty"}
                </Badge>
                <Badge color={slice.taxFree ? "green" : "blue"}>
                  {slice.taxFree ? "tax-free" : "taxable"}
                </Badge>
              </span>
            </div>
          ))}
        </div>
      )}

      {isRothEditable && canEdit && (
        <details className="mt-2 group">
          <summary className="cursor-pointer text-caption text-muted select-none">
            Edit basis
          </summary>
          <RothBasisForm
            rothBasisMeta={entry.rothBasisMeta}
            onSave={onSaveRothBasis}
          />
        </details>
      )}

      {isSeparationEditable && canEdit && (
        <SeparationDateForm
          current={entry.ruleOf55?.separationYear ?? null}
          source={entry.ruleOf55?.source ?? "no_data"}
          onSave={onSaveSeparationDate}
        />
      )}
      {entry.ruleOf55?.source === "active" && (
        <p className="mt-1 text-caption text-faint">
          {view === "now"
            ? "Still employed there — a separation date becomes available once you actually leave."
            : "Assumes you separate from this employer at your household's retirement transition — not yet a real date, since you're still employed there today."}
        </p>
      )}
    </div>
  );
}

function RothBasisForm({
  rothBasisMeta,
  onSave,
}: {
  rothBasisMeta: AccountEntry["rothBasisMeta"];
  onSave: (v: {
    contributionBasis: string;
    conversionBasis: string;
    latestConversionYear: number | null;
  }) => void;
}) {
  const [contributionBasis, setContributionBasis] = useState(
    rothBasisMeta ? String(rothBasisMeta.contributionBasis) : "",
  );
  const [conversionBasis, setConversionBasis] = useState(
    rothBasisMeta ? String(rothBasisMeta.conversionBasis) : "",
  );
  const [latestConversionYear, setLatestConversionYear] = useState(
    rothBasisMeta?.latestConversionYear != null
      ? String(rothBasisMeta.latestConversionYear)
      : "",
  );

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 text-caption">
      <label className="flex flex-col">
        <span className="text-faint">
          Basis (contributions — what you can pull out anytime, tax and
          penalty-free)
        </span>
        <input
          type="number"
          className="w-28 rounded border border-subtle bg-surface px-2 py-1"
          value={contributionBasis}
          onChange={(e) => setContributionBasis(e.target.value)}
        />
      </label>
      <label className="flex flex-col">
        <span className="text-faint">
          Conversion basis — locked until 5 years after the year of your most
          recent conversion
        </span>
        <input
          type="number"
          className="w-28 rounded border border-subtle bg-surface px-2 py-1"
          value={conversionBasis}
          onChange={(e) => setConversionBasis(e.target.value)}
        />
      </label>
      <label className="flex flex-col">
        <span className="text-faint">Most recent conversion year</span>
        <input
          type="number"
          className="w-24 rounded border border-subtle bg-surface px-2 py-1"
          value={latestConversionYear}
          onChange={(e) => setLatestConversionYear(e.target.value)}
        />
      </label>
      <button
        className="rounded bg-primary px-3 py-1 text-white"
        onClick={() =>
          onSave({
            contributionBasis: contributionBasis || "0",
            conversionBasis: conversionBasis || "0",
            latestConversionYear: latestConversionYear
              ? Number(latestConversionYear)
              : null,
          })
        }
      >
        Save
      </button>
      {rothBasisMeta && (
        <span className="text-faint">
          {rothBasisMeta.isSeeded
            ? `carried forward from ${rothBasisMeta.year - 1}, not yet reviewed for ${rothBasisMeta.year}`
            : `updated ${isoDateOnly(rothBasisMeta.updatedAt)} for ${rothBasisMeta.year}`}
        </span>
      )}
    </div>
  );
}

function SeparationDateForm({
  current,
  source,
  onSave,
}: {
  current: number | null;
  source: string;
  onSave: (date: string | null) => void;
}) {
  const [date, setDate] = useState(current ? `${current}-01-01` : "");

  return (
    <div className="mt-2 flex items-end gap-2 text-caption">
      <label className="flex flex-col">
        <span className="text-faint">
          Separation date{" "}
          {source === "derived" &&
            "(derived from job history — override if wrong)"}
        </span>
        <input
          type="date"
          className="rounded border border-subtle bg-surface px-2 py-1"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <button
        className="rounded bg-primary px-3 py-1 text-white"
        onClick={() => onSave(date || null)}
      >
        Save
      </button>
    </div>
  );
}

type BulkRow = {
  performanceAccountId: number;
  ownerPersonId: number;
  year: number;
  displayName: string;
  ownerName: string | null;
  taxTypeLabel: string;
  contributionBasis: string;
  conversionBasis: string;
  latestConversionYear: string;
};

/** All Roth-basis-editable accounts in one screen — mirrors
 *  UpdatePerformanceForm's shape (grouped rows, one Save for everything). */
function BulkRothBasisForm({
  accounts,
  onSave,
  isSaving,
  error,
}: {
  accounts: AccountEntry[];
  onSave: (
    entries: {
      performanceAccountId: number;
      ownerPersonId: number;
      year: number;
      contributionBasis: string;
      conversionBasis: string;
      latestConversionYear: number | null;
    }[],
  ) => void;
  isSaving: boolean;
  error: string | null;
}) {
  const currentCalendarYear = new Date().getFullYear();

  const [rows, setRows] = useState<BulkRow[]>(() =>
    accounts
      .filter(
        (
          a,
        ): a is AccountEntry & {
          performanceAccountId: number;
          ownerPersonId: number;
        } =>
          a.taxType === "taxFree" &&
          ["ira", "401k", "403b"].includes(a.category) &&
          a.performanceAccountId != null &&
          a.ownerPersonId != null,
      )
      .map((a) => ({
        performanceAccountId: a.performanceAccountId,
        ownerPersonId: a.ownerPersonId,
        year: a.rothBasisMeta?.year ?? currentCalendarYear,
        displayName: a.displayName,
        ownerName: a.ownerName,
        taxTypeLabel: taxTypeLabel(a.category, a.taxType),
        contributionBasis: String(a.rothBasisMeta?.contributionBasis ?? 0),
        conversionBasis: String(a.rothBasisMeta?.conversionBasis ?? 0),
        latestConversionYear:
          a.rothBasisMeta?.latestConversionYear != null
            ? String(a.rothBasisMeta.latestConversionYear)
            : "",
      })),
  );

  const updateRow = (
    key: string,
    field: "contributionBasis" | "conversionBasis" | "latestConversionYear",
    value: string,
  ) => {
    setRows((prev) =>
      prev.map((r) =>
        `${r.performanceAccountId}-${r.ownerPersonId}` === key
          ? { ...r, [field]: value }
          : r,
      ),
    );
  };

  const groups = new Map<string, BulkRow[]>();
  for (const row of rows) {
    const key = row.ownerName ?? "Joint";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const handleSave = () => {
    onSave(
      rows.map((r) => ({
        performanceAccountId: r.performanceAccountId,
        ownerPersonId: r.ownerPersonId,
        year: r.year,
        contributionBasis: r.contributionBasis || "0",
        conversionBasis: r.conversionBasis || "0",
        latestConversionYear: r.latestConversionYear
          ? Number(r.latestConversionYear)
          : null,
      })),
    );
  };

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted">
        No Roth accounts to update yet — link a Roth IRA or 401k/403b Roth
        sub-account first.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {Array.from(groups.entries()).map(([owner, groupRows]) => (
        <div key={owner}>
          <div className="border-b-2 border-strong pb-1.5 mb-3 text-sm font-semibold text-primary">
            {owner}
          </div>
          <div className="space-y-3">
            {groupRows.map((row) => {
              const key = `${row.performanceAccountId}-${row.ownerPersonId}`;
              return (
                <div
                  key={key}
                  className="pb-3 border-b border-subtle last:border-0 last:pb-0"
                >
                  <div className="text-sm font-medium mb-1.5">
                    {row.displayName}{" "}
                    <span className="text-caption text-faint">
                      {row.taxTypeLabel} · {row.year}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <label className="block w-40">
                      <span className="block text-caption text-muted mb-0.5">
                        Basis (contributions)
                      </span>
                      <input
                        type="number"
                        className="w-full rounded border border-default px-1.5 py-1 text-sm"
                        value={row.contributionBasis}
                        onChange={(e) =>
                          updateRow(key, "contributionBasis", e.target.value)
                        }
                      />
                    </label>
                    <label className="block w-40">
                      <span className="block text-caption text-muted mb-0.5">
                        Conversion basis
                      </span>
                      <input
                        type="number"
                        className="w-full rounded border border-default px-1.5 py-1 text-sm"
                        value={row.conversionBasis}
                        onChange={(e) =>
                          updateRow(key, "conversionBasis", e.target.value)
                        }
                      />
                    </label>
                    <label className="block w-32">
                      <span className="block text-caption text-muted mb-0.5">
                        Latest conversion yr
                      </span>
                      <input
                        type="number"
                        className="w-full rounded border border-default px-1.5 py-1 text-sm"
                        value={row.latestConversionYear}
                        onChange={(e) =>
                          updateRow(key, "latestConversionYear", e.target.value)
                        }
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3 pt-2">
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="px-4 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Save all"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">Error: {error}</p>}
    </div>
  );
}
