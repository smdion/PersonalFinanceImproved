"use client";

/**
 * Redesigned overrides panel — unified wizard pattern.
 *
 * Instead of three dense sections with 20+ fields each, this uses a
 * step-by-step flow: pick year → pick what to change → fill in 1-3 fields.
 * Saved overrides display as clean, scannable cards.
 */
import { useState, useMemo } from "react";
import { formatCurrency } from "@/lib/utils/format";
import type { ProjectionState } from "./projection-table-types";
import type { AccumOverride, DecumOverride } from "./types";
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
import { LumpSumFields, ResetFields } from "./override-field-parts";
import { OverridesHeader, OverrideList } from "./overrides-list";
import {
  WizardProgress,
  WizardYearStep,
  WizardTypeStep,
  WizardFieldsStep,
} from "./override-wizard-steps";

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
  const retirementAge = state.engineSettings?.retirementAge;
  const currentAge = state.result?.projectionByYear[0]?.age ?? 0;
  const baseYear = new Date().getFullYear();
  const retYear =
    retirementAge != null && currentAge > 0
      ? baseYear + (retirementAge - currentAge)
      : null;
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
            <LumpSumFields
              isPostRetirement={isPostRetirement}
              resetWizard={resetWizard}
              selectedYear={selectedYear}
              state={state}
              year={year}
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
            <ResetFields
              isPostRetirement={isPostRetirement}
              resetWizard={resetWizard}
              selectedYear={selectedYear}
              state={state}
              year={year}
            />
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
      <OverridesHeader
        resetWizard={resetWizard}
        setShowWizard={setShowWizard}
        setWizardStep={setWizardStep}
        showWizard={showWizard}
        totalCount={totalCount}
      />

      {/* Wizard */}
      {showWizard && (
        <div className="bg-surface-sunken space-y-3 rounded-lg p-3">
          {/* Step indicator */}
          <WizardProgress
            editingOverride={editingOverride}
            selectedYear={selectedYear}
            wizardStep={wizardStep}
          />

          {/* Step 1: Year */}
          <WizardYearStep
            isPostRetirement={isPostRetirement}
            retYear={retYear}
            selectedYear={selectedYear}
            setSelectedYear={setSelectedYear}
            setWizardStep={setWizardStep}
            wizardStep={wizardStep}
          />

          {/* Step 2: Pick type */}
          <WizardTypeStep
            availableOptions={availableOptions}
            isPostRetirement={isPostRetirement}
            selectedYear={selectedYear}
            setSelectedType={setSelectedType}
            setWizardStep={setWizardStep}
            wizardStep={wizardStep}
          />

          {/* Step 3: Fields */}
          <WizardFieldsStep
            renderFields={renderFields}
            selectedType={selectedType}
            selectedYear={selectedYear}
            setWizardStep={setWizardStep}
            wizardStep={wizardStep}
          />
        </div>
      )}

      {/* Saved overrides list */}
      <OverrideList allOverrides={allOverrides} />

      {totalCount === 0 && !showWizard && (
        <p className="text-faint py-2 text-center text-xs">
          No changes — every year uses the page settings
        </p>
      )}
    </div>
  );
}
