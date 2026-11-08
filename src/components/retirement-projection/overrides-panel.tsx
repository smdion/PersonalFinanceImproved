"use client";

/**
 * Redesigned overrides panel — unified wizard pattern.
 *
 * Instead of three dense sections with 20+ fields each, this uses a
 * step-by-step flow: pick year → pick what to change → fill in 1-3 fields.
 * Saved overrides display as clean, scannable cards.
 */
import { useState, useMemo } from "react";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency } from "@/lib/utils/format";
import type { ProjectionState } from "./projection-table-types";
import type { AccumOverride, DecumOverride } from "./types";
import { LumpSumForm } from "./lump-sum-form";
import { investedAtStartOf } from "@/lib/pure/advice/goldilocks";
import {
  SimpleNumberForm,
  RoutingForm,
  SalaryOverrideForm,
  BudgetOverrideForm,
} from "./override-forms";
import { type OverrideType, OVERRIDE_OPTIONS } from "./override-options";
import {
  pushAccumOverrideItems,
  pushDecumOverrideItems,
} from "./override-items";

type OverridesPanelProps = {
  state: ProjectionState;
  accumulationExpenseOverride?: number;
};

export function OverridesPanel({
  state,
  accumulationExpenseOverride: _accumulationExpenseOverride,
}: OverridesPanelProps) {
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState<"year" | "type" | "fields">(
    "year",
  );
  const [selectedYear, setSelectedYear] = useState(
    String(new Date().getFullYear() + 1),
  );
  const [selectedType, setSelectedType] = useState<OverrideType | null>(null);
  // Edit mode: tracks which override is being edited so we can delete-then-add on save
  const [editingOverride, setEditingOverride] = useState<{
    phase: "pre" | "post" | "life";
    index: number;
    deleteFirst: () => void;
    initialValue?: string;
  } | null>(null);

  // Determine if selected year is pre or post retirement
  const retAge = state.engineSettings?.retirementAge;
  const currentAge = state.result?.projectionByYear[0]?.age ?? 0;
  const baseYear = new Date().getFullYear();
  const retYear =
    retAge != null && currentAge > 0 ? baseYear + (retAge - currentAge) : null;
  const isPostRetirement = retYear != null && parseInt(selectedYear) >= retYear;

  // Collect ALL overrides into a unified sorted list
  const allOverrides = useMemo(() => {
    const items: {
      id: string;
      year: number;
      phase: "pre" | "post" | "life";
      type: string;
      summary: string;
      color: string;
      onDelete: () => void;
      onEdit?: () => void;
    }[] = [];

    // Accumulation overrides
    pushAccumOverrideItems(
      state,
      items,
      setSelectedYear,
      setSelectedType,
      setEditingOverride,
      setWizardStep,
      setShowWizard,
    );

    // Decumulation overrides
    pushDecumOverrideItems(
      state,
      items,
      setSelectedYear,
      setSelectedType,
      setEditingOverride,
      setWizardStep,
      setShowWizard,
    );

    // Salary overrides
    for (const o of state.dbSalaryOverrides ?? []) {
      items.push({
        id: `salary-${o.id}`,
        year: o.projectionYear,
        phase: "life",
        type:
          o.contributionProfileId && !o.salaryProfileId
            ? "Contribution"
            : "Salary",
        summary: `${formatCurrency(o.overrideSalary)}/yr${o.notes ? ` (${o.notes})` : ""}`,
        color: "blue",
        onDelete: () => state.deleteSalaryOverride.mutate({ id: o.id }),
      });
    }

    // Budget overrides
    for (const o of state.dbBudgetOverrides ?? []) {
      items.push({
        id: `budget-${o.id}`,
        year: o.projectionYear,
        phase: "life",
        type: "Budget",
        summary: `${formatCurrency(o.overrideMonthlyBudget * 12)}/yr${o.notes ? ` (${o.notes})` : ""}`,
        color: "indigo",
        onDelete: () => state.deleteBudgetOverride.mutate({ id: o.id }),
      });
    }

    return items.sort((a, b) => a.year - b.year);
  }, [state]);

  const totalCount = allOverrides.length;

  const resetWizard = () => {
    setShowWizard(false);
    setWizardStep("year");
    setSelectedType(null);
    setEditingOverride(null);
  };

  // Simple field forms for each override type
  const renderFields = () => {
    if (!selectedType) return null;
    const year = parseInt(selectedYear);
    if (isNaN(year)) return null;

    switch (selectedType) {
      case "contribution_rate":
        return (
          <SimpleNumberForm
            label="New Retirement Contribution Rate (%)"
            placeholder="15"
            initialValue={editingOverride?.initialValue}
            onSubmit={(val, notes) => {
              const o: AccumOverride = {
                year,
                contributionRate: val / 100,
                ...(notes ? { notes } : {}),
              };
              state.setAccumOverrides((prev) =>
                [
                  ...prev.filter(
                    (x) => x.year !== year || x.contributionRate == null,
                  ),
                  o,
                ].sort((a, b) => a.year - b.year),
              );
              resetWizard();
            }}
          />
        );

      case "lump_sum":
        return (
          <div className="space-y-2">
            <LumpSumForm
              accounts={state.individualAccountNames}
              investedAtStartOf={(year) =>
                investedAtStartOf(state.result?.projectionByYear ?? [], year)
              }
              onAdd={(ls) => {
                const lumpEntry = {
                  id: ls.id,
                  amount: Math.abs(parseFloat(ls.amount)),
                  targetAccount: ls.targetAccount,
                  ...(ls.targetAccountName
                    ? { targetAccountName: ls.targetAccountName }
                    : {}),
                  ...(ls.targetOwnerName
                    ? { targetOwnerName: ls.targetOwnerName }
                    : {}),
                  ...(ls.label ? { label: ls.label } : {}),
                };
                if (isPostRetirement) {
                  const o: DecumOverride = {
                    year,
                    lumpSums: [lumpEntry],
                  };
                  state.setDecumOverrides((prev) =>
                    [...prev, o].sort((a, b) => a.year - b.year),
                  );
                } else {
                  const o: AccumOverride = {
                    year,
                    lumpSums: [lumpEntry],
                  };
                  state.setAccumOverrides((prev) =>
                    [...prev, o].sort((a, b) => a.year - b.year),
                  );
                }
                resetWizard();
              }}
              defaultYear={selectedYear}
            />
          </div>
        );

      case "salary_change":
        return (
          <SalaryOverrideForm
            year={year}
            contribProfiles={state.contribProfileSummaries ?? []}
            personId={state.salaryOverridePersonId ?? 1}
            initialValue={editingOverride?.initialValue}
            onSubmit={(salary, profileId, notes) => {
              if (!state.salaryOverridePersonId) return;
              state.createSalaryOverride.mutate({
                personId: state.salaryOverridePersonId,
                projectionYear: year,
                overrideSalary: String(salary),
                contributionProfileId: profileId,
                notes: notes || null,
              });
              resetWizard();
            }}
          />
        );

      case "budget_change":
        return (
          <BudgetOverrideForm
            year={year}
            budgetProfiles={state.budgetProfileSummaries ?? []}
            personId={state.salaryOverridePersonId ?? 1}
            initialValue={editingOverride?.initialValue}
            onSubmit={(annualBudget, notes) => {
              if (!state.salaryOverridePersonId) return;
              state.createBudgetOverride.mutate({
                personId: state.salaryOverridePersonId,
                projectionYear: year,
                overrideMonthlyBudget: String(
                  Math.round((annualBudget / 12) * 100) / 100,
                ),
                notes: notes || null,
              });
              resetWizard();
            }}
          />
        );

      case "roth_conversion":
        return (
          <SimpleNumberForm
            label="Roth Conversion Target Bracket (%)"
            placeholder="22"
            initialValue={editingOverride?.initialValue}
            onSubmit={(val, notes) => {
              const o: DecumOverride = {
                year,
                rothConversionTarget: val / 100,
                ...(notes ? { notes } : {}),
              };
              state.setDecumOverrides((prev) =>
                [
                  ...prev.filter(
                    (x) => x.year !== year || x.rothConversionTarget == null,
                  ),
                  o,
                ].sort((a, b) => a.year - b.year),
              );
              resetWizard();
            }}
          />
        );

      case "routing":
        return (
          <RoutingForm
            isPostRetirement={isPostRetirement}
            onSubmit={(mode, notes) => {
              if (isPostRetirement) {
                const o: DecumOverride = {
                  year,
                  withdrawalRoutingMode: mode as "waterfall" | "percentage",
                  ...(notes ? { notes } : {}),
                };
                state.setDecumOverrides((prev) =>
                  [
                    ...prev.filter(
                      (x) => x.year !== year || x.withdrawalRoutingMode == null,
                    ),
                    o,
                  ].sort((a, b) => a.year - b.year),
                );
              } else {
                const o: AccumOverride = {
                  year,
                  routingMode: mode as "waterfall" | "percentage",
                  ...(notes ? { notes } : {}),
                };
                state.setAccumOverrides((prev) =>
                  [
                    ...prev.filter(
                      (x) => x.year !== year || x.routingMode == null,
                    ),
                    o,
                  ].sort((a, b) => a.year - b.year),
                );
              }
              resetWizard();
            }}
          />
        );

      case "reset":
        return (
          <div className="space-y-2">
            <p className="text-muted text-xs">
              This will revert all{" "}
              {isPostRetirement ? "withdrawal" : "contribution"} settings to
              page defaults starting in {selectedYear}.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (isPostRetirement) {
                    state.setDecumOverrides((prev) =>
                      [...prev, { year, reset: true }].sort(
                        (a, b) => a.year - b.year,
                      ),
                    );
                  } else {
                    state.setAccumOverrides((prev) =>
                      [...prev, { year, reset: true }].sort(
                        (a, b) => a.year - b.year,
                      ),
                    );
                  }
                  resetWizard();
                }}
                className="rounded bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700"
              >
                Reset from {selectedYear}
              </button>
              <button
                type="button"
                onClick={resetWizard}
                className="text-muted hover:text-primary px-3 py-1.5 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  // Filter override options by phase
  const availableOptions = OVERRIDE_OPTIONS.filter(
    (opt) =>
      opt.phase === "any" ||
      (isPostRetirement && opt.phase === "post") ||
      (!isPostRetirement && opt.phase === "pre"),
  );

  return (
    <div className="space-y-3 rounded-lg border p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-label text-muted font-semibold tracking-wider uppercase">
            Changes by year
          </h4>
          <HelpTip text="Change contributions, withdrawals, salary, budget, or add lump sums at specific future years. Changes carry forward until the next change." />
          {totalCount > 0 && (
            <span className="text-caption text-faint">{totalCount} active</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            if (showWizard) {
              resetWizard();
            } else {
              setShowWizard(true);
              setWizardStep("year");
            }
          }}
          className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
            showWizard
              ? "bg-surface-strong text-muted hover:text-primary"
              : "bg-indigo-600 text-white hover:bg-indigo-700"
          }`}
        >
          {showWizard ? "Cancel" : "+ Add a change"}
        </button>
      </div>

      {/* Wizard */}
      {showWizard && (
        <div className="bg-surface-sunken space-y-3 rounded-lg p-3">
          {/* Step indicator */}
          {editingOverride && (
            <div className="text-caption font-medium text-indigo-600">
              Editing the change for {selectedYear}
            </div>
          )}
          <div className="text-caption text-muted flex items-center gap-2">
            <span
              className={
                wizardStep === "year" ? "font-semibold text-indigo-600" : ""
              }
            >
              1. Year
            </span>
            <span>→</span>
            <span
              className={
                wizardStep === "type" ? "font-semibold text-indigo-600" : ""
              }
            >
              2. What to change
            </span>
            <span>→</span>
            <span
              className={
                wizardStep === "fields" ? "font-semibold text-indigo-600" : ""
              }
            >
              3. New value
            </span>
          </div>

          {/* Step 1: Year */}
          {wizardStep === "year" && (
            <div className="flex items-end gap-3">
              <label className="block">
                <span className="text-muted text-xs">Starting Year</span>
                <input
                  type="number"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="border-strong mt-0.5 block w-24 rounded border px-2 py-1.5 text-sm"
                />
              </label>
              {retYear && (
                <span className="text-caption text-faint pb-2">
                  {isPostRetirement
                    ? "Post-retirement (withdrawal phase)"
                    : `Pre-retirement (saving phase, retires ${retYear})`}
                </span>
              )}
              <button
                type="button"
                onClick={() => setWizardStep("type")}
                className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-700"
              >
                Next
              </button>
            </div>
          )}

          {/* Step 2: Pick type */}
          {wizardStep === "type" && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWizardStep("year")}
                  className="text-caption text-indigo-600 hover:underline"
                >
                  ← Back
                </button>
                <span className="text-muted text-xs">
                  Year {selectedYear} —{" "}
                  {isPostRetirement ? "post-retirement" : "pre-retirement"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {availableOptions.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => {
                      setSelectedType(opt.key);
                      setWizardStep("fields");
                    }}
                    className="border-subtle rounded-lg border p-2.5 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-50"
                  >
                    <div className="text-sm">
                      {opt.icon} {opt.label}
                    </div>
                    <div className="text-caption text-faint mt-0.5">
                      {opt.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Fields */}
          {wizardStep === "fields" && selectedType && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWizardStep("type")}
                  className="text-caption text-indigo-600 hover:underline"
                >
                  ← Back
                </button>
                <span className="text-muted text-xs">
                  Year {selectedYear} —{" "}
                  {OVERRIDE_OPTIONS.find((o) => o.key === selectedType)?.label}
                </span>
              </div>
              {renderFields()}
            </div>
          )}
        </div>
      )}

      {/* Saved overrides list */}
      {allOverrides.length > 0 && (
        <div className="space-y-1">
          {allOverrides.map((item) => (
            <div
              key={item.id}
              className={`flex items-center justify-between rounded px-3 py-1.5 text-xs ${
                item.color === "emerald"
                  ? "bg-emerald-50 text-emerald-800"
                  : item.color === "amber"
                    ? "bg-amber-50 text-amber-800"
                    : item.color === "blue"
                      ? "bg-blue-50 text-blue-800"
                      : "bg-indigo-50 text-indigo-800"
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-semibold">{item.year}</span>
                <span
                  className={`text-micro shrink-0 rounded px-1.5 py-0.5 font-medium ${
                    item.color === "emerald"
                      ? "bg-emerald-100 text-emerald-700"
                      : item.color === "amber"
                        ? "bg-amber-100 text-amber-700"
                        : item.color === "blue"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-indigo-100 text-indigo-700"
                  }`}
                >
                  {item.type}
                </span>
                <span className="truncate">{item.summary}</span>
              </div>
              <span className="ml-2 flex shrink-0 items-center gap-1">
                {item.onEdit && (
                  <button
                    type="button"
                    className="text-muted hover:text-primary"
                    onClick={item.onEdit}
                    aria-label="Edit"
                  >
                    &#9998;
                  </button>
                )}
                <button
                  type="button"
                  className="text-muted hover:text-red-500"
                  onClick={item.onDelete}
                  aria-label="Delete"
                >
                  ×
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {totalCount === 0 && !showWizard && (
        <p className="text-faint py-2 text-center text-xs">
          No changes — every year uses the page settings
        </p>
      )}
    </div>
  );
}
