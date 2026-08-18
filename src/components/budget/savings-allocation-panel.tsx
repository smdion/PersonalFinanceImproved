"use client";

import { trpc } from "@/lib/trpc";
import { toast } from "@/lib/hooks/use-toast";
import { formatCurrency } from "@/lib/utils/format";
import { sumBy } from "@/lib/utils/math";
import { HelpTip } from "@/components/ui/help-tip";
import { FormError } from "@/components/ui/form-error";
import { ProfileViewingBadge } from "./profile-viewing-badge";
import { useState } from "react";
import { useBudgetProfilesList } from "@/lib/hooks/use-budget-profiles-list";

/**
 * Every savings goal's allocationPercent/monthlyContribution is owned
 * entirely per budget profile — no shared default a profile falls back to,
 * each profile is its own funding scenario. The profile selection here is
 * the SAME state the Budget Profiles tab's sidebar uses (viewingProfileId,
 * lifted to budget-content.tsx) — picking a profile in either tab keeps it
 * selected when you switch to the other, since both are scoped to the same
 * budget_profile_id. This panel's own left rail is select-only (no
 * create/rename/delete/set-active — those stay exclusive to the Budget
 * Profiles tab) and additionally shows each profile's savings total/funded
 * goal count, which the Budget tab's sidebar doesn't need.
 *
 * Every row is directly editable — there's no "inherited" fallback state.
 * Values are resolved server-side by the same function
 * computeSummary/pushContributionsToApi use, so this panel can't show a
 * number that ends up different from what's actually live elsewhere.
 */
export function SavingsAllocationPanel({
  canEdit,
  locked,
  viewingProfileId,
  onSelectProfile,
  isPinned,
  onActivateProfile,
  livePoolEstimate,
  livePoolColumnLabel,
  sandbox,
  onLocalChange,
}: {
  canEdit: boolean;
  /** Owned by budget-content.tsx's single tab-bar padlock — see its
   *  useEditLock(EDIT_LOCK_KEYS.profileEditLocked) call. The What-If tab's
   *  sandbox instance of this panel has no such padlock (nothing here
   *  persists in sandbox mode), so it just passes `false`. */
  locked: boolean;
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
  /**
   * Rendered inside a hypothetical/preview surface (the What-If tab). The
   * rail's green "ACTIVE" badge gains a `?` tip there clarifying it marks
   * the household's real active profile, which is not necessarily the one
   * this preview is showing — swapping the badge's own label to a
   * different word ("REAL") was tried first and just traded one piece of
   * jargon for another with no visible affordance explaining it, so the
   * label stays "ACTIVE" and the tip carries the distinction instead.
   *
   * ALSO redirects the allocation table's writes: when `sandbox` is true
   * and `onLocalChange` is provided, editing a goal's %/$ calls
   * `onLocalChange` instead of `savings.goalProfileAllocations.upsert` —
   * see SavingsAllocationTable's `commit`. Previously this prop was purely
   * cosmetic (the badge only) while edits still wrote straight to the
   * database regardless — a sandbox that wasn't actually sandboxed.
   */
  sandbox?: boolean;
  /** See `sandbox` above. Called with the parsed allocationPercent/
   *  monthlyContribution instead of persisting to the database. Only takes
   *  effect when `sandbox` is also true. */
  onLocalChange?: (
    goalId: number,
    field: "allocationPercent" | "monthlyContribution",
    value: number | null,
  ) => void;
}) {
  const { data: profiles, isLoading: profilesLoading } =
    useBudgetProfilesList();
  const { data: summaries } =
    trpc.savings.goalProfileAllocations.listSummaries.useQuery();
  // "Unspent" arrives already computed, per profile, from budget.listProfiles
  // — take-home pay resolved under THAT profile's own per-column
  // Contribution/Salary Profile pins (honoring the active Plan's pins and any
  // Plan-level salary override), minus that profile's spending, minus its
  // savings allocations. This panel used to make its own
  // paycheck.computeSummary query with no input, which server-side means no
  // profile is applied at all — so the figure silently ignored every active
  // profile. Do NOT reintroduce a client-side pay query here.

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
          <HelpTip text="'Unspent' is take-home pay minus that profile's own budgeted spending minus its savings allocations. Take-home is resolved under each profile's own per-mode Contribution and Salary Profile pins (and the active Plan's pins, if any), and weighted profiles blend pay and spending across modes the same way. For the exact figure under the single mode you're viewing, check the Live pool line on the right." />
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
                  <span className="flex items-center gap-0.5 shrink-0">
                    <span className="text-micro px-1 py-0.5 rounded bg-green-100 text-green-700 font-semibold">
                      ACTIVE
                    </span>
                    {sandbox && (
                      <HelpTip text="This is your household's actual active budget profile — not necessarily the one this What-If preview is showing below." />
                    )}
                  </span>
                )}
                {sandbox && effectiveProfileId === p.id && (
                  <span
                    className="text-micro px-1 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold shrink-0"
                    title="The profile this What-If view is currently showing"
                  >
                    VIEWING
                  </span>
                )}
              </div>
              {summary &&
                (() => {
                  const isWeighted =
                    !!p.columnMonths && p.columnMonths.length > 0;
                  // Weighted profiles blend to a "typical month" across
                  // modes — both this profile's spending AND its take-home
                  // pay are blended the same way, server-side.
                  const unspent = p.unspentMonthly;
                  return (
                    <div className="mt-0.5 text-caption text-muted space-y-0.5">
                      <div className="flex gap-2">
                        <span>
                          Allocated:{" "}
                          {formatCurrency(summary.totalMonthlyAllocation)}/mo
                        </span>
                        {summary.fundedGoalCount > 0 && (
                          <span>
                            {summary.fundedGoalCount} goal
                            {summary.fundedGoalCount !== 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      {unspent != null && (
                        <div>
                          Unspent{isWeighted ? " (blended)" : ""}:{" "}
                          <span
                            className={
                              unspent >= 0 ? "text-emerald-600" : "text-red-600"
                            }
                          >
                            {formatCurrency(unspent)}/mo
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })()}
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
            locked={locked}
            onActivate={
              onActivateProfile
                ? () => onActivateProfile(effectiveProfileId)
                : undefined
            }
            livePoolEstimate={livePoolEstimate}
            livePoolColumnLabel={livePoolColumnLabel}
            sandbox={sandbox}
            onLocalChange={onLocalChange}
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
  locked,
  onActivate,
  livePoolEstimate,
  livePoolColumnLabel,
  sandbox,
  onLocalChange,
}: {
  profileId: number;
  profileName: string | undefined;
  isViewingNonActive: boolean;
  isPinned?: boolean;
  activeProfileName: string | undefined;
  canEdit: boolean;
  locked: boolean;
  onActivate?: () => void;
  livePoolEstimate?: number | null;
  livePoolColumnLabel?: string;
  sandbox?: boolean;
  onLocalChange?: (
    goalId: number,
    field: "allocationPercent" | "monthlyContribution",
    value: number | null,
  ) => void;
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
  const resetAllToZero =
    trpc.savings.goalProfileAllocations.resetAllToZero.useMutation({
      onSuccess: invalidate,
      onError: (err) =>
        toast.error(err.message || "Failed to reset allocations"),
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
    if (sandbox && onLocalChange) {
      // Sandbox mode: redirect the write to the caller's own local state
      // instead of persisting — only the field the user actually touched,
      // so an untouched field doesn't get re-sent as a no-op "change".
      if (percentStr !== "")
        onLocalChange(goalId, "allocationPercent", allocationPercent);
      if (monthlyStr !== "")
        onLocalChange(goalId, "monthlyContribution", monthlyContribution);
    } else {
      upsert.mutate({
        goalId,
        profileId,
        allocationPercent,
        monthlyContribution,
      });
    }
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
        <HelpTip text="A goal's %/$ is entirely per budget profile — each profile is its own funding scenario. Use the Savings page to pull in new pay or update % from live income." />
        {!sandbox && canEdit && !locked && rows.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (
                confirm(
                  `Reset every goal's allocation to $0 for "${profileName ?? "this profile"}"?`,
                )
              ) {
                resetAllToZero.mutate({ profileId });
              }
            }}
            className="ml-auto text-caption text-faint hover:text-red-600"
          >
            Reset all to zero
          </button>
        )}
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

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b-2 border-strong">
            <th className="text-left py-2 pl-4 pr-3 text-muted font-medium">
              Goal
            </th>
            <th className="text-right py-2 px-3 text-muted font-medium w-24">
              Allocation %
            </th>
            <th className="text-right py-2 px-3 text-muted font-medium w-28">
              Monthly $
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, rowIdx) => (
            <tr
              key={r.goalId}
              className={`border-b border-subtle hover:bg-blue-50/60 transition-colors ${
                rowIdx % 2 === 1 ? "bg-surface-sunken/60" : "bg-surface-primary"
              }`}
            >
              <td className="py-1.5 pl-4 pr-3 text-secondary">
                {r.name}
                {r.isEmergencyFund && (
                  <span className="ml-1 text-micro text-faint">(e-fund)</span>
                )}
              </td>
              <td className="py-1.5 px-3 text-right">
                {!canEdit || locked ? (
                  <span className="text-secondary font-mono">
                    {r.allocationPercent != null
                      ? `${Math.round(r.allocationPercent * 100) / 100}%`
                      : "—"}
                  </span>
                ) : (
                  <input
                    type="number"
                    value={draftFor(
                      r.goalId,
                      "allocationPercent",
                      r.allocationPercent != null
                        ? String(Math.round(r.allocationPercent * 100) / 100)
                        : "",
                    )}
                    onChange={(e) =>
                      setDraft(r.goalId, "allocationPercent", e.target.value)
                    }
                    onBlur={() =>
                      commit(
                        r.goalId,
                        r.allocationPercent,
                        r.monthlyContribution,
                      )
                    }
                    placeholder="—"
                    className="w-16 px-1.5 py-0.5 text-xs text-right border rounded bg-surface-primary text-secondary"
                  />
                )}
              </td>
              <td className="py-1.5 px-3 text-right">
                {!canEdit || locked ? (
                  <span className="text-secondary font-mono">
                    {formatCurrency(r.monthlyContribution)}
                  </span>
                ) : (
                  <input
                    type="number"
                    value={draftFor(
                      r.goalId,
                      "monthlyContribution",
                      String(r.monthlyContribution),
                    )}
                    onChange={(e) =>
                      setDraft(r.goalId, "monthlyContribution", e.target.value)
                    }
                    onBlur={() =>
                      commit(
                        r.goalId,
                        r.allocationPercent,
                        r.monthlyContribution,
                      )
                    }
                    className="w-20 px-1.5 py-0.5 text-xs text-right border rounded bg-surface-primary text-secondary"
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
