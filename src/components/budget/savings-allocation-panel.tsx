"use client";

import { trpc } from "@/lib/trpc";
import { toast } from "@/lib/hooks/use-toast";
import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { Badge } from "@/components/ui/badge";
import { FormError } from "@/components/ui/form-error";
import { ProfileViewingBadge } from "./profile-viewing-badge";
import { useBudgetProfilesList } from "@/lib/hooks/use-budget-profiles-list";
import { useDraftCommit } from "@/lib/hooks/use-draft-commit";
import { renderStoredTotal } from "./savings-allocation-totals";
import { renderProfileTotals } from "./savings-allocation-totals";

/**
 * Savings allocations owned per budget profile (no shared default), using the
 * Budget tab's viewingProfileId; the rail is select-only plus savings totals.
 * Values resolve server-side like computeSummary/pushContributionsToApi.
 */
export function SavingsAllocationPanel({
  canEdit,
  locked,
  viewingProfileId,
  onSelectProfile,
  onActivateProfile,
  livePoolEstimate,
  livePoolColumnLabel,
  sandbox,
  onLocalChange,
}: {
  canEdit: boolean;
  /** From the page's tab-bar padlock (EDIT_LOCK_KEYS.profileEditLocked); the
   *  What-If sandbox passes `false`. */
  locked: boolean;
  viewingProfileId: number | null;
  onSelectProfile: (id: number) => void;
  /** Sets the given budget profile as globally active (shown as a visible
   *  "Activate" button when viewing a non-active profile). */
  onActivateProfile?: (id: number) => void;
  /** Take-home minus budgeted expenses for the active mode right now: the
   *  live pool goals draw from (vs. the stored per-goal snapshot). Null until
   *  budget data loads. */
  livePoolEstimate?: number | null;
  /** Which budget mode/column livePoolEstimate was computed for, e.g. "Standard". */
  livePoolColumnLabel?: string;
  /**
   * What-If preview: the "ACTIVE" badge gets a `?` tip (it marks the real active
   * profile), and with `onLocalChange` edits call it instead of the upsert.
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
  // "Unspent" comes per profile from budget.listProfiles (take-home under the
  // active profiles minus spending and savings). A client pay query here would
  // apply no profile at all.

  if (profilesLoading) {
    return (
      <div className="space-y-2">
        <div className="bg-surface-elevated h-8 animate-pulse rounded" />
        <div className="bg-surface-elevated h-32 animate-pulse rounded" />
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
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_1fr]">
      {/* Left: profile list (select-only, shared selection with Budget Profiles tab) */}
      <div className="space-y-1">
        <h3 className="text-label text-muted mb-2 font-semibold tracking-wide uppercase">
          Profiles
        </h3>
        <p className="text-caption text-faint mb-2">
          Savings allocations follow Budget Profiles — create, rename, or
          activate one in the Budget Profiles tab.
          <HelpTip text="'Unspent' is take-home pay minus that profile's own budgeted spending minus its savings allocations. Take-home is resolved under each profile's own per-mode Contribution and Salary Profile selections (and the active Plan's, if any), and weighted profiles blend pay and spending across modes the same way. For the exact figure under the single mode you're viewing, check the Live pool line on the right." />
        </p>
        {profiles.map((p) => {
          const summary = summaryByProfile.get(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelectProfile(p.id)}
              className={`w-full rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                effectiveProfileId === p.id
                  ? "text-primary border border-blue-300 bg-blue-50 font-medium"
                  : "hover:bg-surface-sunken text-secondary border border-transparent"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="truncate">{p.name}</span>
                {p.isActive && (
                  <span className="flex shrink-0 items-center gap-0.5">
                    <Badge color="green">ACTIVE</Badge>
                    {sandbox && (
                      <HelpTip text="This is your household's actual active budget profile — not necessarily the one this What-If preview is showing below." />
                    )}
                  </span>
                )}
                {sandbox && effectiveProfileId === p.id && (
                  <Badge
                    color="blue"
                    title="The profile this What-If view is currently showing"
                    className="shrink-0"
                  >
                    VIEWING
                  </Badge>
                )}
              </div>
              {summary && renderProfileTotals(p, summary)}
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
            isViewingNonActive={effectiveProfileId !== activeProfile?.id}
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
          <div className="text-faint flex h-40 items-center justify-center text-xs">
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

  const {
    drafts: rawDrafts,
    setDraft: setRawDraft,
    clearDraft: clearRawDraft,
  } = useDraftCommit();

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
    return <div className="bg-surface-elevated h-32 animate-pulse rounded" />;
  }

  if (!rows || rows.length === 0) {
    return (
      <p className="text-caption text-faint px-2 py-3 italic">
        No active savings goals to allocate.
      </p>
    );
  }

  // Drafts are a flat Record, so each row's two fields key as
  // "{goalId}:{field}"; commit() reads/clears both for the one upsert.
  const draftKey = (
    goalId: number,
    field: "allocationPercent" | "monthlyContribution",
  ) => `${goalId}:${field}`;

  const draftFor = (
    goalId: number,
    field: "allocationPercent" | "monthlyContribution",
    fallback: string,
  ) => rawDrafts[draftKey(goalId, field)] ?? fallback;

  const setDraft = (
    goalId: number,
    field: "allocationPercent" | "monthlyContribution",
    value: string,
  ) => setRawDraft(draftKey(goalId, field), value);

  const commit = (
    goalId: number,
    resolvedPercent: number | null,
    resolvedMonthly: number,
  ) => {
    const percentKey = draftKey(goalId, "allocationPercent");
    const monthlyKey = draftKey(goalId, "monthlyContribution");
    if (!(percentKey in rawDrafts) && !(monthlyKey in rawDrafts)) return;
    const percentStr = (rawDrafts[percentKey] ?? "").trim();
    const monthlyStr = (rawDrafts[monthlyKey] ?? "").trim();
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
    clearRawDraft(percentKey);
    clearRawDraft(monthlyKey);
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <ProfileViewingBadge
          profileName={profileName ?? "This profile"}
          activeProfileName={activeProfileName}
          isViewingNonActive={isViewingNonActive}
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
            className="text-caption text-faint ml-auto hover:text-red-600"
          >
            Reset all to zero
          </button>
        )}
      </div>

      {livePoolEstimate != null && (
        <div className="text-caption text-muted mb-3 flex items-center gap-2">
          <span>
            Live pool{livePoolColumnLabel ? ` (${livePoolColumnLabel})` : ""}:{" "}
            <span className="text-secondary font-semibold">
              {formatCurrency(livePoolEstimate)}
              <span className="text-faint font-normal">/mo</span>
            </span>
          </span>
          {renderStoredTotal(livePoolEstimate, rows)}
          <HelpTip text="Live pool is take-home pay minus budgeted expenses for the active mode, right now. The %/$ table below is what's stored per goal for this profile — 'Pull In New Pay' recomputes it from the live pool." />
        </div>
      )}

      <FormError
        error={upsert.error}
        prefix="Failed to save"
        className="mb-2"
      />

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-strong border-b-2">
            <th className="text-muted py-2 pr-3 pl-4 text-left font-medium">
              Goal
            </th>
            <th className="text-muted w-24 px-3 py-2 text-right font-medium">
              Allocation %
            </th>
            <th className="text-muted w-28 px-3 py-2 text-right font-medium">
              Monthly $
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, rowIndex) => (
            <tr
              key={r.goalId}
              className={`border-subtle border-b transition-colors hover:bg-blue-50/60 ${
                rowIndex % 2 === 1
                  ? "bg-surface-sunken/60"
                  : "bg-surface-primary"
              }`}
            >
              <td className="text-secondary py-1.5 pr-3 pl-4">
                {r.name}
                {r.isEmergencyFund && (
                  <span className="text-micro text-faint ml-1">(e-fund)</span>
                )}
              </td>
              <td className="px-3 py-1.5 text-right">
                {!canEdit || locked ? (
                  <span className="text-secondary font-mono">
                    {r.allocationPercent != null
                      ? `${Math.round(r.allocationPercent * 100) / 100}%`
                      : "—"}
                  </span>
                ) : (
                  <input
                    aria-label={`${r.name} allocation percent`}
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
                    className="bg-surface-primary text-secondary w-16 rounded border px-1.5 py-0.5 text-right text-xs"
                  />
                )}
              </td>
              <td className="px-3 py-1.5 text-right">
                {!canEdit || locked ? (
                  <span className="text-secondary font-mono">
                    {formatCurrency(r.monthlyContribution)}
                  </span>
                ) : (
                  <input
                    aria-label={`${r.name} monthly contribution`}
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
                    className="bg-surface-primary text-secondary w-20 rounded border px-1.5 py-0.5 text-right text-xs"
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
