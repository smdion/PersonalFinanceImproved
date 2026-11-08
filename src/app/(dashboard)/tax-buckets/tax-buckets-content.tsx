"use client";

import { useMemo, useState } from "react";
import { FocusTarget } from "@/components/ui/focus-target";
import { useFocusedState } from "@/lib/hooks/use-focus";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HelpTip } from "@/components/ui/help-tip";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryBoundary, queryPending } from "@/components/ui/query-boundary";
import { SlidePanel } from "@/components/ui/slide-panel";
import { KpiCard } from "@/components/retirement-projection/projection-hero-kpis";
import { formatCurrency } from "@/lib/utils/format";
import { Tabs } from "@/components/ui/tabs";
import { DEFAULT_INFLATION_RATE } from "@/lib/constants";
import { computeTaxBucketProjection } from "@/lib/pure/accounts/tax-bucket-projection";
import { useEffectiveContribProfileId } from "@/lib/hooks/use-effective-contrib-profile-id";
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";
import {
  isTaxFreeBucket,
  isHsaCategory,
  isIraCategory,
  tracksCostBasis,
} from "@/lib/config/account-types";
import { penaltyFreePrefixAmount } from "@/lib/pure/accounts/early-access";
import { flatDeflator, toTodaysDollars } from "@/lib/pure/simulation/dollars";
import type { DollarBasis } from "@/lib/config/enum-values";
import { profileSelectionFrom } from "@/lib/pure/household/profile-selection";
import { AccountEntry, AccountDetailRow } from "./tax-buckets-account-row";
import { BulkRothBasisForm } from "./tax-buckets-bulk-basis";

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
      // Penalty-free capacity is the LEADING, CONTIGUOUS prefix of
      // penalty-free slices (penaltyFreePrefixAmount, @/lib/pure/accounts/early-access)
      // — the SAME single computation path the withdrawal-routing engine
      // uses — NOT a sum of every penalty-free slice regardless of
      // position. An unseasoned Roth conversion slice blocks access to any
      // penalty-free slice behind it even though that slice's own
      // `penaltyFree` flag is true; summing them independently here would
      // silently disagree with what the engine actually routes.
      const accessibleNow = penaltyFreePrefixAmount(entry.slices);
      b.accessibleNow += accessibleNow;
      b.locked += entry.balance - accessibleNow;
      // lint-violation-ok: `key` is this page's own BucketKey union, not an
      // AccountCategory — no account-types.ts predicate applies here.
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

/** The page's buckets, in display order. */
const BUCKET_KEYS = [
  "traditional",
  "rothIra",
  "rothEmployer",
  "brokerage",
  "hsa",
] as const;
type BucketKey = (typeof BUCKET_KEYS)[number];

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
  if (tracksCostBasis(entry.category)) return "brokerage";
  if (isHsaCategory(entry.category)) return "hsa";
  if (!isTaxFreeBucket(entry.taxType)) return "traditional";
  return isIraCategory(entry.category) ? "rothIra" : "rothEmployer";
}

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

      {/* Hero KPIs — same card language as the Retirement page's hero row.
          Rendered only once there are real entries to show — for "at
          retirement" that means the projection actually resolved, so a
          zeroed placeholder KPI never appears while it's loading. */}
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
