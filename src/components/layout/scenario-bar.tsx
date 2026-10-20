"use client";

import React, { useState, useRef, useEffect } from "react";
import { useScenario } from "@/lib/context/scenario-context";
import { useUser, hasPermission, isAdmin } from "@/lib/context/user-context";
import { trpc } from "@/lib/trpc";
import { confirm, confirmWithDiff } from "@/components/ui/confirm-dialog";
import { diffContribProfileSwap } from "@/lib/pure/contrib-profile-diff";
import { ProfilePill } from "./profile-pill";
import type { ProfileOption } from "./profile-pill";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";
import { useActiveSalaryProfile } from "@/lib/hooks/use-active-salary-profile";
import { useActiveRetirementProfile } from "@/lib/hooks/use-active-retirement-profile";
import { useBudgetProfilesList } from "@/lib/hooks/use-budget-profiles-list";
import { usePlans } from "@/lib/hooks/use-plans";
import {
  PLAN_PROFILE_KINDS,
  PLAN_PROFILE_KIND_TITLES,
  planProfileIds,
  type PlanProfileKind,
} from "@/lib/config/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { useClickOutside } from "@/lib/hooks/use-click-outside";

function options(
  profiles: readonly { id: number; name: string }[] | undefined,
  activeId: number | null,
): ProfileOption[] {
  return (profiles ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    isActive: p.id === activeId,
    badge: p.id === activeId ? "Active" : undefined,
  }));
}

/**
 * The header: which profile of each kind is active, which Plan (a saved set
 * of profiles) that matches, and the view mode. Every picker changes the
 * active profile for the whole household; choosing a Plan changes all four.
 */
export function ScenarioBar() {
  const { viewMode, setViewMode } = useScenario();
  const user = useUser();
  const canManagePlans = hasPermission(user, "scenario");
  const canChangeBudget = hasPermission(user, "budget");
  const canChangeContribOrSalary = hasPermission(user, "contributionProfile");
  const canChangeRetirement = isAdmin(user);

  const { plans, activeIds, planInUse, lastAppliedPlan, sameAsActive, apply } =
    usePlans();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const dropdownRef = useClickOutside<HTMLDivElement>(() => {
    setDropdownOpen(false);
    setCreating(false);
  });
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const utils = trpc.useUtils();
  const refreshPlans = () => utils.settings.scenarios.list.invalidate();
  const createMut = trpc.settings.scenarios.create.useMutation({
    onSuccess: () => {
      refreshPlans();
      setNewName("");
      setCreating(false);
    },
  });
  const updateMut = trpc.settings.scenarios.update.useMutation({
    onSuccess: refreshPlans,
  });
  const deleteMut = trpc.settings.scenarios.delete.useMutation({
    onSuccess: refreshPlans,
  });

  // Profile lists
  const { data: budgetProfiles } = useBudgetProfilesList();
  const { data: contribProfiles } = trpc.contributionProfile.list.useQuery();
  const { data: contribCompareData } =
    trpc.contributionProfile.compareData.useQuery();
  const { data: salaryProfiles } = trpc.salaryProfile.list.useQuery();
  const { data: retirementProfiles } =
    trpc.retirement.retirementProfiles.list.useQuery();
  const [, setActiveContribId] = useActiveContribProfile();
  const [, setActiveSalaryId] = useActiveSalaryProfile();
  const [, setActiveRetirementId] = useActiveRetirementProfile();
  const profilesByKind: Record<
    PlanProfileKind,
    readonly { id: number; name: string }[] | undefined
  > = {
    salary: salaryProfiles,
    contribution: contribProfiles,
    budget: budgetProfiles,
    retirement: retirementProfiles,
  };
  const profileName = (kind: PlanProfileKind, id: number | null) =>
    profilesByKind[kind]?.find((p) => p.id === id)?.name ?? "—";

  // Every query that resolves "the active budget profile" server-side takes
  // no budget-profile id as an argument, so React Query can't know those
  // results are stale after a swap here — same invalidation set the
  // profile managers use.
  const activateBudget = trpc.budget.setActiveProfile.useMutation({
    onSuccess: () => {
      utils.budget.invalidate();
      utils.contribution.invalidate();
      utils.paycheck.invalidate();
      utils.projection.invalidate();
      utils.savings.invalidate();
    },
  });

  // Warn before a swap silently drops an account's active value — same
  // treatment as contribution-profile-manager.tsx's handleActivate.
  const handleActivateContrib = async (id: number) => {
    const outgoing = contribCompareData?.profiles.find(
      (p) => p.id === activeIds.contribution,
    );
    const incoming = contribCompareData?.profiles.find((p) => p.id === id);
    if (contribCompareData && outgoing) {
      const lines = diffContribProfileSwap(
        outgoing.accountActiveFields,
        incoming?.accountActiveFields ?? {},
        contribCompareData.accounts,
      );
      if (lines.length > 0) {
        const ok = await confirmWithDiff(
          `Switching to "${incoming?.name ?? "this profile"}" will change:`,
          lines,
        );
        if (!ok) return;
      }
    }
    setActiveContribId(id);
  };

  const handleApply = async (planId: number) => {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    const ids = planProfileIds(plan);
    const changes = PLAN_PROFILE_KINDS.filter(
      (k) => ids[k] != null && ids[k] !== activeIds[k],
    ).map((k) => `${PLAN_PROFILE_KIND_TITLES[k]}: ${profileName(k, ids[k])}`);
    setDropdownOpen(false);
    if (changes.length === 0) return;
    const ok = await confirmWithDiff(
      `Apply Plan "${plan.name}"? This makes these the active profiles for everyone in the household (and what syncs to your budget app):`,
      changes,
      "Apply",
    );
    if (ok) apply.mutate({ id: planId });
  };

  const allActiveKnown = PLAN_PROFILE_KINDS.every((k) => activeIds[k] != null);
  const activeSet = allActiveKnown
    ? {
        salaryProfileId: activeIds.salary!,
        contributionProfileId: activeIds.contribution!,
        budgetProfileId: activeIds.budget!,
        retirementProfileId: activeIds.retirement!,
      }
    : null;

  const handleCreate = () => {
    if (!newName.trim() || !activeSet) return;
    createMut.mutate({ name: newName.trim(), ...activeSet });
  };

  const handleUpdate = async () => {
    if (!lastAppliedPlan || !activeSet) return;
    setDropdownOpen(false);
    if (
      await confirm(
        `Update Plan "${lastAppliedPlan.name}" to the profiles you're using now?`,
      )
    )
      updateMut.mutate({ id: lastAppliedPlan.id, ...activeSet });
  };

  const handleDelete = async (id: number, name: string) => {
    if (await confirm(`Delete Plan "${name}"? Its profiles are not deleted.`))
      deleteMut.mutate({ id });
  };

  return (
    <div
      data-scenario-bar
      className="bg-surface-primary border-default flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5 border-b px-3 py-1.5 text-xs sm:px-4"
    >
      {/* Plan — a saved set of profiles */}
      <div className="flex items-center gap-2" ref={dropdownRef}>
        <span className="text-faint hidden sm:inline" id="plan-label">
          Plan:
        </span>
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            aria-haspopup="listbox"
            aria-expanded={dropdownOpen}
            aria-labelledby="plan-label"
            disabled={apply.isPending}
            className="text-label bg-surface-primary text-primary flex items-center gap-1.5 rounded px-3 py-1.5 shadow-sm transition-colors disabled:opacity-50"
          >
            <span className={planInUse ? "font-medium" : "text-muted"}>
              {planInUse ? planInUse.name : "None (unsaved mix)"}
            </span>
            <svg
              className="text-faint h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {dropdownOpen && (
            <div
              className="bg-surface-primary absolute top-full right-0 z-50 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border shadow-lg"
              role="listbox"
              aria-label="Plans"
            >
              <p className="text-caption text-faint px-3 pt-2 pb-1">
                A Plan is a saved set of profiles. Applying one makes them the
                active profiles.
              </p>
              {plans.length === 0 && (
                <p className="text-muted px-3 py-2">No Plans saved yet.</p>
              )}
              {plans.map((p) => {
                const inUse = p.id === planInUse?.id;
                return (
                  <div
                    key={p.id}
                    className={`hover:bg-surface-sunken group flex items-center gap-2 px-3 py-1.5 ${inUse ? "bg-blue-50 text-blue-700" : "text-secondary"}`}
                  >
                    <button
                      role="option"
                      aria-selected={inUse}
                      onClick={() => handleApply(p.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span className="truncate">{p.name}</span>
                      {inUse && (
                        <span className="ml-auto shrink-0">
                          <Badge color="blue">In use</Badge>
                        </span>
                      )}
                    </button>
                    {canManagePlans && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(p.id, p.name);
                        }}
                        className="text-faint transition-opacity hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
                        title="Delete Plan"
                        aria-label={`Delete Plan ${p.name}`}
                      >
                        <svg
                          className="h-3 w-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
              <FormError error={apply.error} prefix="Couldn't apply" />

              {canManagePlans && (
                <div className="border-subtle space-y-1.5 border-t p-2">
                  {!planInUse && lastAppliedPlan && activeSet && (
                    <button
                      onClick={handleUpdate}
                      className="w-full rounded py-1.5 text-left text-blue-600 hover:bg-blue-50"
                    >
                      Update “{lastAppliedPlan.name}” to these profiles
                    </button>
                  )}
                  {creating ? (
                    <div className="space-y-1.5">
                      <input
                        ref={inputRef}
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleCreate();
                          if (e.key === "Escape") setCreating(false);
                        }}
                        placeholder="Plan name"
                        aria-label="New Plan name"
                        className="border-strong bg-surface-primary text-primary w-full rounded border px-2 py-1 text-xs"
                      />
                      {sameAsActive && (
                        <p className="text-caption text-amber-700">
                          Same profiles as “{sameAsActive.name}”.
                        </p>
                      )}
                      <FormError error={createMut.error} prefix="Failed" />
                      <div className="flex gap-1">
                        <Button
                          onClick={handleCreate}
                          size="sm"
                          disabled={!newName.trim() || createMut.isPending}
                          className="!text-caption flex-1"
                        >
                          Save Plan
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setCreating(false)}
                          className="!text-caption"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setCreating(true)}
                      disabled={!activeSet}
                      className="w-full rounded py-1.5 text-left text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                    >
                      + Save these profiles as a new Plan
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="bg-surface-strong hidden h-4 w-px sm:block" />

      {/* Active profile of each kind */}
      <ProfilePill
        label={PLAN_PROFILE_KIND_TITLES.salary}
        options={options(salaryProfiles, activeIds.salary)}
        onActivate={(id) => setActiveSalaryId(Number(id))}
        disabled={!canChangeContribOrSalary}
      />
      <ProfilePill
        label={PLAN_PROFILE_KIND_TITLES.contribution}
        options={options(contribProfiles, activeIds.contribution)}
        onActivate={(id) => handleActivateContrib(Number(id))}
        disabled={!canChangeContribOrSalary}
      />
      <ProfilePill
        label={PLAN_PROFILE_KIND_TITLES.budget}
        options={options(budgetProfiles, activeIds.budget)}
        onActivate={(id) => activateBudget.mutate({ id: Number(id) })}
        isPending={activateBudget.isPending}
        disabled={!canChangeBudget}
      />
      <ProfilePill
        label={PLAN_PROFILE_KIND_TITLES.retirement}
        options={options(retirementProfiles, activeIds.retirement)}
        onActivate={(id) => setActiveRetirementId(Number(id))}
        disabled={!canChangeRetirement}
      />

      <div className="bg-surface-strong hidden h-4 w-px sm:block" />

      {/* View mode toggle */}
      <div className="flex items-center gap-2">
        <span className="text-faint hidden sm:inline" id="view-mode-label">
          View:
        </span>
        <div
          className="bg-surface-elevated flex rounded-md p-0.5"
          role="tablist"
          aria-labelledby="view-mode-label"
        >
          <button
            role="tab"
            aria-selected={viewMode === "projected"}
            onClick={() => setViewMode("projected")}
            title="Current rate applied to all pay periods"
            className={`text-label rounded px-3 py-1.5 transition-colors ${
              viewMode === "projected"
                ? "bg-surface-primary text-primary shadow-sm"
                : "text-muted hover:text-secondary"
            }`}
          >
            Projected
          </button>
          <button
            role="tab"
            aria-selected={viewMode === "blended"}
            onClick={() => setViewMode("blended")}
            title="Year-end estimate using actual salary changes throughout the year"
            className={`text-label rounded px-3 py-1.5 transition-colors ${
              viewMode === "blended"
                ? "bg-surface-primary text-primary shadow-sm"
                : "text-muted hover:text-secondary"
            }`}
          >
            <span className="sm:hidden">Year-end</span>
            <span className="hidden sm:inline">Year-end estimate</span>
          </button>
          <button
            role="tab"
            aria-selected={viewMode === "ytd"}
            onClick={() => setViewMode("ytd")}
            title="Amounts earned so far based on elapsed pay periods"
            className={`text-label rounded px-3 py-1.5 transition-colors ${
              viewMode === "ytd"
                ? "bg-surface-primary text-primary shadow-sm"
                : "text-muted hover:text-secondary"
            }`}
          >
            <span className="sm:hidden">YTD</span>
            <span className="hidden sm:inline">Year to date</span>
          </button>
        </div>
      </div>
    </div>
  );
}
