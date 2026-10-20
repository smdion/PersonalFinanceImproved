"use client";

import React, { useState, useRef, useEffect } from "react";
import { useScenario } from "@/lib/context/scenario-context";
import { useUser, hasPermission, isAdmin } from "@/lib/context/user-context";
import { trpc } from "@/lib/trpc";
import { confirm, confirmWithDiff } from "@/components/ui/confirm-dialog";
import { diffContribProfileSwap } from "@/lib/pure/contrib-profile-diff";
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";
import { useActiveSalaryProfile } from "@/lib/hooks/use-active-salary-profile";
import { useActiveRetirementProfile } from "@/lib/hooks/use-active-retirement-profile";
import { useBudgetProfilesList } from "@/lib/hooks/use-budget-profiles-list";
import { useConfirmApplyPlan, usePlans } from "@/lib/hooks/use-plans";
import {
  PLAN_PROFILE_KINDS,
  PLAN_PROFILE_KIND_TITLES,
} from "@/lib/config/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { useClickOutside } from "@/lib/hooks/use-click-outside";
import { profilesHref } from "@/lib/config/profile-tabs";
import type { PlanProfileKind } from "@/lib/config/plans";

const VIEW_MODES = [
  {
    mode: "projected",
    label: "Projected",
    title: "Projected — current rate applied to all pay periods",
  },
  {
    mode: "blended",
    label: "Year-end",
    title:
      "Year-end estimate — using actual salary changes throughout the year",
  },
  {
    mode: "ytd",
    label: "YTD",
    title: "Year to date — amounts earned so far, by elapsed pay periods",
  },
] as const;

/**
 * The header: one "Profiles" button (plus the Plan in use, when the active
 * profiles match one; the active profile of each kind in its tooltip) that
 * opens a panel to change them (each picker changes the active profile for the whole household;
 * applying a Plan changes all four), plus the view mode, which changes
 * every page's numbers and so stays one click away.
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
  // Escape closes the panel.
  useEffect(() => {
    if (!dropdownOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDropdownOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dropdownOpen]);

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

  const confirmApplyPlan = useConfirmApplyPlan();
  const handleApply = async (planId: number) => {
    const plan = plans.find((p) => p.id === planId);
    setDropdownOpen(false);
    if (plan && (await confirmApplyPlan(plan))) apply.mutate({ id: planId });
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

  const kinds: {
    kind: PlanProfileKind;
    profiles: readonly { id: number; name: string }[] | undefined;
    onChange: (id: number) => void;
    canChange: boolean;
    isPending?: boolean;
  }[] = [
    {
      kind: "salary",
      profiles: salaryProfiles,
      onChange: (id) => setActiveSalaryId(id),
      canChange: canChangeContribOrSalary,
    },
    {
      kind: "contribution",
      profiles: contribProfiles,
      onChange: (id) => void handleActivateContrib(id),
      canChange: canChangeContribOrSalary,
    },
    {
      kind: "budget",
      profiles: budgetProfiles,
      onChange: (id) => activateBudget.mutate({ id }),
      canChange: canChangeBudget,
      isPending: activateBudget.isPending,
    },
    {
      kind: "retirement",
      profiles: retirementProfiles,
      onChange: (id) => setActiveRetirementId(id),
      canChange: canChangeRetirement,
    },
  ];
  const activeName = (k: (typeof kinds)[number]) =>
    k.profiles?.find((p) => p.id === activeIds[k.kind])?.name ?? "None";
  const fullNames = kinds.map(activeName);
  const summaryTitle = kinds
    .map((k, i) => `${PLAN_PROFILE_KIND_TITLES[k.kind]}: ${fullNames[i]}`)
    .join("\n");

  return (
    <div
      data-scenario-bar
      className="bg-surface-primary border-default flex items-center justify-end gap-3 border-b px-3 py-1.5 text-xs sm:px-4"
    >
      {/* Profiles — the panel to change the active profiles and Plans */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-faint hidden sm:inline" id="profiles-label">
          Profiles
        </span>
        <div className="relative min-w-0" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            aria-haspopup="dialog"
            aria-expanded={dropdownOpen}
            aria-label={`Profiles and Plans — ${summaryTitle.replace(/\n/g, ", ")}`}
            title={summaryTitle}
            disabled={apply.isPending}
            className="text-label bg-surface-primary text-primary flex max-w-[min(20rem,60vw)] items-center gap-1.5 rounded px-3 py-1.5 shadow-sm transition-colors disabled:opacity-50"
          >
            <SlidersHorizontal
              className="text-faint h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <span className="truncate font-medium">
              {planInUse ? planInUse.name : "Manage"}
            </span>
            <svg
              className="text-faint h-3 w-3 shrink-0"
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
              className="bg-surface-primary z-50 rounded-lg border shadow-lg max-sm:fixed max-sm:inset-x-2 max-sm:top-12 sm:absolute sm:top-full sm:right-0 sm:mt-1 sm:w-80"
              role="dialog"
              aria-label="Profiles and Plans"
            >
              {/* The active profile of each kind */}
              <div className="space-y-1.5 p-3">
                <p className="text-caption text-faint">
                  Active profiles — every page uses these, for everyone in the
                  household.
                </p>
                {kinds.map((k) => (
                  <label
                    key={k.kind}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-muted">
                      {PLAN_PROFILE_KIND_TITLES[k.kind]}
                    </span>
                    <select
                      value={activeIds[k.kind] ?? ""}
                      onChange={(e) => k.onChange(Number(e.target.value))}
                      disabled={!k.canChange || k.isPending}
                      title={
                        k.canChange
                          ? undefined
                          : "You don't have permission to change this"
                      }
                      className="border-default bg-surface-primary text-primary max-w-[11rem] min-w-0 flex-1 rounded border px-2 py-1 text-xs disabled:opacity-60"
                    >
                      {activeIds[k.kind] == null && (
                        <option value="">None</option>
                      )}
                      {(k.profiles ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>

              {/* Plans — a saved set of profiles */}
              <div className="border-subtle border-t">
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
                        onClick={() => handleApply(p.id)}
                        aria-current={inUse || undefined}
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
                  <div className="space-y-1.5 p-2">
                    {!planInUse && lastAppliedPlan && activeSet && (
                      <button
                        onClick={handleUpdate}
                        className="w-full rounded px-1 py-1.5 text-left text-blue-600 hover:bg-blue-50"
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
                        className="w-full rounded px-1 py-1.5 text-left text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                      >
                        + Save these profiles as a new Plan
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="border-subtle border-t px-3 py-2">
                <Link
                  href={profilesHref("salary")}
                  onClick={() => setDropdownOpen(false)}
                  className="text-blue-600 hover:underline"
                >
                  Edit profiles →
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* View mode — changes every page's numbers, so it stays one click away */}
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-faint hidden sm:inline" id="view-mode-label">
          View
        </span>
        <div
          className="bg-surface-elevated flex rounded-md p-0.5"
          role="tablist"
          aria-labelledby="view-mode-label"
        >
          {VIEW_MODES.map((v) => (
            <button
              key={v.mode}
              role="tab"
              aria-selected={viewMode === v.mode}
              onClick={() => setViewMode(v.mode)}
              title={v.title}
              className={`text-label rounded px-2.5 py-1.5 transition-colors ${
                viewMode === v.mode
                  ? "bg-surface-primary text-primary shadow-sm"
                  : "text-muted hover:text-secondary"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
