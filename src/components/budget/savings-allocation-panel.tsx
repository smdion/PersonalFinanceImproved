"use client";

import { trpc } from "@/lib/trpc";
import { toast } from "@/lib/hooks/use-toast";
import { formatCurrency } from "@/lib/utils/format";
import { sumBy } from "@/lib/utils/math";
import { HelpTip } from "@/components/ui/help-tip";
import { FormError } from "@/components/ui/form-error";
import { ProfileViewingBadge } from "./profile-viewing-badge";
import { useState } from "react";

/**
 * Lets a savings goal's allocationPercent/monthlyContribution differ by
 * budget profile. The profile selection here is the SAME state the Budget
 * Profiles tab's sidebar uses (viewingProfileId, lifted to budget-content.tsx)
 * — picking a profile in either tab keeps it selected when you switch to
 * the other, since both are scoped to the same budget_profile_id. This
 * panel's own left rail is select-only (no create/rename/delete/set-active
 * — those stay exclusive to the Budget Profiles tab) and additionally
 * shows each profile's savings total/override count, which the Budget
 * tab's sidebar doesn't need.
 *
 * Absent an override, a goal falls back to its global default (shown
 * "inherited"); the fallback and the override are resolved server-side by
 * the same function computeSummary/pushContributionsToApi use, so this
 * panel can't show a number that ends up different from what's actually
 * live elsewhere.
 */
export function SavingsAllocationPanel({
  canEdit,
  viewingProfileId,
  onSelectProfile,
  isPinned,
  onActivateProfile,
  livePoolEstimate,
  livePoolColumnLabel,
}: {
  canEdit: boolean;
  viewingProfileId: number | null;
  onSelectProfile: (id: number) => void;
  /** Whether viewingProfileId came from the active Plan's pin rather than a
   *  manual selection — see budget-content.tsx's shared useEffectiveProfileId call. */
  isPinned?: boolean;
  /** Sets the given budget profile as globally active (shown as a visible
   *  "Activate" button when viewing a non-active profile). */
  onActivateProfile?: (id: number) => void;
  /** Take-home pay minus budgeted expenses for the active budget mode, right
   *  now — the live pool goals are allocated from. Distinct from the %/$
   *  snapshot below: that's what's stored per goal, this is what's actually
   *  available to allocate against this month. Null while budget data hasn't
   *  loaded yet. */
  livePoolEstimate?: number | null;
  /** Which budget mode/column livePoolEstimate was computed for, e.g. "Standard". */
  livePoolColumnLabel?: string;
}) {
  const { data: profiles, isLoading: profilesLoading } =
    trpc.budget.listProfiles.useQuery();
  const { data: summaries } =
    trpc.savings.goalProfileAllocations.listSummaries.useQuery();

  if (profilesLoading) {
    return (
      <div className="space-y-2">
        <div className="animate-pulse h-8 bg-surface-elevated rounded" />
        <div className="animate-pulse h-32 bg-surface-elevated rounded" />
      </div>
    );
  }

  if (!profiles || profiles.length === 0) return null;

  const summaryByProfile = new Map(summaries?.map((s) => [s.profileId, s]));
  const activeProfile = profiles.find((p) => p.isActive) ?? null;
  const effectiveProfileId = viewingProfileId ?? activeProfile?.id ?? null;
  const effectiveProfile =
    profiles.find((p) => p.id === effectiveProfileId) ?? null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
      {/* Left: profile list (select-only, shared selection with Budget Profiles tab) */}
      <div className="space-y-1">
        <h3 className="text-label font-semibold text-muted uppercase tracking-wide mb-2">
          Profiles
        </h3>
        <p className="text-caption text-faint mb-2">
          Savings allocations follow Budget Profiles — create, rename, or
          activate one in the Budget Profiles tab.
        </p>
        {profiles.map((p) => {
          const summary = summaryByProfile.get(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelectProfile(p.id)}
              className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                effectiveProfileId === p.id
                  ? "bg-blue-50 border border-blue-300 text-primary font-medium"
                  : "hover:bg-surface-sunken border border-transparent text-secondary"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="truncate">{p.name}</span>
                {p.isActive && (
                  <span className="text-micro px-1 py-0.5 rounded bg-green-100 text-green-700 font-semibold shrink-0">
                    ACTIVE
                  </span>
                )}
              </div>
              {summary && (
                <div className="flex gap-2 mt-0.5 text-caption text-muted">
                  <span>
                    {formatCurrency(summary.totalMonthlyAllocation)}/mo
                  </span>
                  {summary.overrideCount > 0 && (
                    <span className="text-amber-600">
                      {summary.overrideCount} override
                      {summary.overrideCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Right: allocation table for the selected profile */}
      <div className="md:border-l md:pl-4">
        {effectiveProfileId !== null ? (
          <SavingsAllocationTable
            profileId={effectiveProfileId}
            profileName={effectiveProfile?.name}
            isViewingNonActive={
              !isPinned && effectiveProfileId !== activeProfile?.id
            }
            isPinned={isPinned}
            activeProfileName={activeProfile?.name}
            canEdit={canEdit}
            onActivate={
              onActivateProfile
                ? () => onActivateProfile(effectiveProfileId)
                : undefined
            }
            livePoolEstimate={livePoolEstimate}
            livePoolColumnLabel={livePoolColumnLabel}
          />
        ) : (
          <div className="flex items-center justify-center h-40 text-xs text-faint">
            Select a profile
          </div>
        )}
      </div>
    </div>
  );
}

function SavingsAllocationTable({
  profileId,
  profileName,
  isViewingNonActive,
  isPinned,
  activeProfileName,
  canEdit,
  onActivate,
  livePoolEstimate,
  livePoolColumnLabel,
}: {
  profileId: number;
  profileName: string | undefined;
  isViewingNonActive: boolean;
  isPinned?: boolean;
  activeProfileName: string | undefined;
  canEdit: boolean;
  onActivate?: () => void;
  livePoolEstimate?: number | null;
  livePoolColumnLabel?: string;
}) {
  const utils = trpc.useUtils();
  const { data: rows, isLoading } =
    trpc.savings.goalProfileAllocations.list.useQuery({ profileId });

  const [drafts, setDrafts] = useState<
    Record<number, { allocationPercent: string; monthlyContribution: string }>
  >({});

  const invalidate = () => {
    utils.savings.goalProfileAllocations.list.invalidate();
    utils.savings.computeSummary.invalidate();
  };

  const upsert = trpc.savings.goalProfileAllocations.upsert.useMutation({
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message || "Failed to save allocation"),
  });
  const revert = trpc.savings.goalProfileAllocations.delete.useMutation({
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message || "Failed to revert allocation"),
  });

  if (isLoading) {
    return <div className="animate-pulse h-32 bg-surface-elevated rounded" />;
  }

  if (!rows || rows.length === 0) {
    return (
      <p className="text-caption text-faint italic px-2 py-3">
        No active savings goals to allocate.
      </p>
    );
  }

  const draftFor = (
    goalId: number,
    field: "allocationPercent" | "monthlyContribution",
    fallback: string,
  ) => drafts[goalId]?.[field] ?? fallback;

  const setDraft = (
    goalId: number,
    field: "allocationPercent" | "monthlyContribution",
    value: string,
  ) =>
    setDrafts((prev) => ({
      ...prev,
      [goalId]: {
        allocationPercent: prev[goalId]?.allocationPercent ?? "",
        monthlyContribution: prev[goalId]?.monthlyContribution ?? "",
        [field]: value,
      },
    }));

  const commit = (
    goalId: number,
    resolvedPercent: number | null,
    resolvedMonthly: number,
  ) => {
    const draft = drafts[goalId];
    if (!draft) return;
    const percentStr = draft.allocationPercent.trim();
    const monthlyStr = draft.monthlyContribution.trim();
    const allocationPercent =
      percentStr === "" ? resolvedPercent : parseFloat(percentStr);
    const monthlyContribution =
      monthlyStr === "" ? resolvedMonthly : parseFloat(monthlyStr);
    if (
      (allocationPercent !== null && isNaN(allocationPercent)) ||
      isNaN(monthlyContribution)
    ) {
      return;
    }
    upsert.mutate({
      goalId,
      profileId,
      allocationPercent,
      monthlyContribution,
    });
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[goalId];
      return next;
    });
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <ProfileViewingBadge
          profileName={profileName ?? "This profile"}
          activeProfileName={activeProfileName}
          isViewingNonActive={isViewingNonActive}
          isPinned={isPinned}
          onActivate={canEdit ? onActivate : undefined}
        />
        <HelpTip text="A goal's %/$ can differ by budget profile. Rows without a custom value here inherit the goal's global default (shown grayed out). Editing a row creates an override just for this profile. Use the Savings page to pull in new pay or update % from live income." />
      </div>

      {livePoolEstimate != null && (
        <div className="flex items-center gap-2 mb-3 text-caption text-muted">
          <span>
            Live pool{livePoolColumnLabel ? ` (${livePoolColumnLabel})` : ""}:{" "}
            <span className="font-semibold text-secondary">
              {formatCurrency(livePoolEstimate)}
              <span className="text-faint font-normal">/mo</span>
            </span>
          </span>
          {(() => {
            const storedTotal = sumBy(rows, (r) => r.monthlyContribution);
            const diff = livePoolEstimate - storedTotal;
            return (
              <span className="text-faint">
                · stored allocations total {formatCurrency(storedTotal)}/mo
                {Math.abs(diff) > 0.01 && (
                  <span
                    className={
                      diff > 0 ? "text-emerald-600 ml-1" : "text-red-600 ml-1"
                    }
                  >
                    ({diff > 0 ? "+" : ""}
                    {formatCurrency(diff)} {diff > 0 ? "unspent" : "over"})
                  </span>
                )}
              </span>
            );
          })()}
          <HelpTip text="Live pool is take-home pay minus budgeted expenses for the active mode, right now. The %/$ table below is what's stored per goal for this profile — 'Pull In New Pay' recomputes it from the live pool." />
        </div>
      )}

      <FormError
        error={upsert.error}
        prefix="Failed to save"
        className="mb-2"
      />

      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted border-b">
            <th className="text-left py-1.5 font-medium">Goal</th>
            <th className="text-right py-1.5 font-medium w-24">Allocation %</th>
            <th className="text-right py-1.5 font-medium w-28">Monthly $</th>
            <th className="text-right py-1.5 font-medium w-20"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.goalId} className="border-b border-subtle">
              <td className="py-1.5 text-secondary">
                {r.name}
                {r.isEmergencyFund && (
                  <span className="ml-1 text-micro text-faint">(e-fund)</span>
                )}
              </td>
              <td className="py-1.5 text-right">
                <input
                  type="number"
                  disabled={!canEdit}
                  value={draftFor(
                    r.goalId,
                    "allocationPercent",
                    r.allocationPercent != null
                      ? String(r.allocationPercent)
                      : "",
                  )}
                  onChange={(e) =>
                    setDraft(r.goalId, "allocationPercent", e.target.value)
                  }
                  onBlur={() =>
                    commit(r.goalId, r.allocationPercent, r.monthlyContribution)
                  }
                  placeholder="—"
                  className={`w-16 px-1.5 py-0.5 text-xs text-right border rounded bg-surface-primary ${
                    r.isOverride
                      ? "text-amber-600 font-medium"
                      : "text-secondary"
                  }`}
                />
              </td>
              <td className="py-1.5 text-right">
                <input
                  type="number"
                  disabled={!canEdit}
                  value={draftFor(
                    r.goalId,
                    "monthlyContribution",
                    String(r.monthlyContribution),
                  )}
                  onChange={(e) =>
                    setDraft(r.goalId, "monthlyContribution", e.target.value)
                  }
                  onBlur={() =>
                    commit(r.goalId, r.allocationPercent, r.monthlyContribution)
                  }
                  className={`w-20 px-1.5 py-0.5 text-xs text-right border rounded bg-surface-primary ${
                    r.isOverride
                      ? "text-amber-600 font-medium"
                      : "text-secondary"
                  }`}
                />
              </td>
              <td className="py-1.5 text-right">
                {r.isOverride ? (
                  canEdit && (
                    <button
                      type="button"
                      onClick={() =>
                        revert.mutate({ goalId: r.goalId, profileId })
                      }
                      className="text-caption text-faint hover:text-red-600"
                      title="Revert to this goal's global default"
                    >
                      reset
                    </button>
                  )
                ) : (
                  <span className="text-micro text-faint">inherited</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
