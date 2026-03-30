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
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type { useProjectionState } from "./use-projection-state";
import type { AccumOverride, DecumOverride } from "./types";
import { catDisplayLabel } from "./utils";
import { LumpSumForm } from "./lump-sum-form";
import {
  WITHDRAWAL_STRATEGY_CONFIG,
  type WithdrawalStrategyType,
} from "@/lib/config/withdrawal-strategies";

type ProjectionState = ReturnType<typeof useProjectionState>;

export type OverridesPanelV2Props = {
  state: ProjectionState;
  accumulationExpenseOverride?: number;
};

type OverrideType =
  | "contribution_rate"
  | "withdrawal_rate"
  | "lump_sum"
  | "salary_change"
  | "budget_change"
  | "roth_conversion"
  | "routing"
  | "reset";

const OVERRIDE_OPTIONS: {
  key: OverrideType;
  label: string;
  description: string;
  icon: string;
  phase: "any" | "pre" | "post";
}[] = [
  {
    key: "contribution_rate",
    label: "Contribution Rate",
    description: "Change how much you save",
    icon: "📈",
    phase: "pre",
  },
  {
    key: "withdrawal_rate",
    label: "Withdrawal Rate",
    description: "Change how much you withdraw",
    icon: "📉",
    phase: "post",
  },
  {
    key: "lump_sum",
    label: "Lump Sum",
    description: "One-time injection or withdrawal",
    icon: "💰",
    phase: "any",
  },
  {
    key: "salary_change",
    label: "Contribution / Salary",
    description: "Switch contribution profile or change salary",
    icon: "💼",
    phase: "pre",
  },
  {
    key: "budget_change",
    label: "Budget Change",
    description: "Change retirement spending",
    icon: "🏠",
    phase: "post",
  },
  {
    key: "roth_conversion",
    label: "Roth Conversion",
    description: "Set conversion target bracket",
    icon: "🔄",
    phase: "post",
  },
  {
    key: "routing",
    label: "Account Routing",
    description: "Change withdrawal order or splits",
    icon: "🔀",
    phase: "any",
  },
  {
    key: "reset",
    label: "Reset to Defaults",
    description: "Revert all overrides for a year",
    icon: "↩️",
    phase: "any",
  },
];

export function OverridesPanelV2({
  state: s,
  accumulationExpenseOverride: _accumulationExpenseOverride,
}: OverridesPanelV2Props) {
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
  const retAge = s.engineSettings?.retirementAge;
  const currentAge = s.result?.projectionByYear?.[0]?.age ?? 0;
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
    for (let i = 0; i < s.accumOverrides.length; i++) {
      const o = s.accumOverrides[i]!;
      const parts: string[] = [];
      if (o.contributionRate != null)
        parts.push(`Rate: ${formatPercent(o.contributionRate, 1)}`);
      if (o.routingMode) parts.push(`Mode: ${o.routingMode}`);
      if (o.lumpSums?.length)
        parts.push(
          o.lumpSums
            .map(
              (ls) =>
                `+${formatCurrency(ls.amount)} ${ls.label ?? ""} → ${ls.targetAccountName ?? catDisplayLabel[ls.targetAccount] ?? ls.targetAccount}`,
            )
            .join(", "),
        );
      if (o.reset) parts.push("Reset to defaults");
      if (o.notes) parts.push(`(${o.notes})`);
      const idx = i;
      items.push({
        id: `accum-${o.year}-${i}`,
        year: o.year,
        phase: "pre",
        type: o.reset
          ? "Reset"
          : o.lumpSums?.length
            ? "Lump Sum"
            : o.contributionRate != null
              ? "Contribution"
              : "Override",
        summary: parts.join(" · ") || "Override",
        color: "emerald",
        onDelete: () =>
          s.setAccumOverrides((prev) => prev.filter((_, j) => j !== idx)),
        onEdit: () => {
          setSelectedYear(String(o.year));
          setSelectedType(
            o.reset
              ? "reset"
              : o.lumpSums?.length
                ? "lump_sum"
                : o.contributionRate != null
                  ? "contribution_rate"
                  : o.routingMode
                    ? "routing"
                    : "contribution_rate",
          );
          setEditingOverride({
            phase: "pre",
            index: idx,
            deleteFirst: () =>
              s.setAccumOverrides((prev) => prev.filter((_, j) => j !== idx)),
            initialValue:
              o.contributionRate != null
                ? String(o.contributionRate * 100)
                : undefined,
          });
          setWizardStep("fields");
          setShowWizard(true);
        },
      });
    }

    // Decumulation overrides
    for (let i = 0; i < s.decumOverrides.length; i++) {
      const o = s.decumOverrides[i]!;
      const parts: string[] = [];
      if (o.withdrawalRate != null)
        parts.push(`Rate: ${formatPercent(o.withdrawalRate, 1)}`);
      if (o.rothConversionTarget != null)
        parts.push(
          `Roth Conv: ${o.rothConversionTarget === 0 ? "Off" : formatPercent(o.rothConversionTarget, 0)}`,
        );
      if (o.lumpSums?.length)
        parts.push(
          o.lumpSums
            .map(
              (ls) =>
                `+${formatCurrency(ls.amount)} ${ls.label ?? ""} → ${ls.targetAccountName ?? catDisplayLabel[ls.targetAccount] ?? ls.targetAccount}`,
            )
            .join(", "),
        );
      if (o.reset) parts.push("Reset to defaults");
      if (o.notes) parts.push(`(${o.notes})`);
      const idx = i;
      items.push({
        id: `decum-${o.year}-${i}`,
        year: o.year,
        phase: "post",
        type: o.reset
          ? "Reset"
          : o.lumpSums?.length
            ? "Lump Sum"
            : o.withdrawalRate != null
              ? "Withdrawal"
              : "Override",
        summary: parts.join(" · ") || "Override",
        color: "amber",
        onDelete: () =>
          s.setDecumOverrides((prev) => prev.filter((_, j) => j !== idx)),
        onEdit: () => {
          setSelectedYear(String(o.year));
          setSelectedType(
            o.reset
              ? "reset"
              : o.lumpSums?.length
                ? "lump_sum"
                : o.withdrawalRate != null
                  ? "withdrawal_rate"
                  : o.rothConversionTarget != null
                    ? "roth_conversion"
                    : o.withdrawalRoutingMode
                      ? "routing"
                      : "withdrawal_rate",
          );
          setEditingOverride({
            phase: "post",
            index: idx,
            deleteFirst: () =>
              s.setDecumOverrides((prev) => prev.filter((_, j) => j !== idx)),
            initialValue:
              o.withdrawalRate != null
                ? String(o.withdrawalRate * 100)
                : o.rothConversionTarget != null
                  ? String(o.rothConversionTarget * 100)
                  : undefined,
          });
          setWizardStep("fields");
          setShowWizard(true);
        },
      });
    }

    // Salary overrides
    for (const o of s.dbSalaryOverrides ?? []) {
      items.push({
        id: `salary-${o.id}`,
        year: o.projectionYear,
        phase: "life",
        type: o.contributionProfileId ? "Contribution" : "Salary",
        summary: `${formatCurrency(o.overrideSalary)}/yr${o.notes ? ` (${o.notes})` : ""}`,
        color: "blue",
        onDelete: () => s.deleteSalaryOverride.mutate({ id: o.id }),
      });
    }

    // Budget overrides
    for (const o of s.dbBudgetOverrides ?? []) {
      items.push({
        id: `budget-${o.id}`,
        year: o.projectionYear,
        phase: "life",
        type: "Budget",
        summary: `${formatCurrency(o.overrideMonthlyBudget * 12)}/yr${o.notes ? ` (${o.notes})` : ""}`,
        color: "indigo",
        onDelete: () => s.deleteBudgetOverride.mutate({ id: o.id }),
      });
    }

    return items.sort((a, b) => a.year - b.year);
  }, [s]);

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
            label="New Contribution Rate (%)"
            placeholder="15"
            initialValue={editingOverride?.initialValue}
            onSubmit={(val, notes) => {
              const o: AccumOverride = {
                year,
                contributionRate: val / 100,
                ...(notes ? { notes } : {}),
              };
              s.setAccumOverrides((prev) =>
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

      case "withdrawal_rate": {
        const strategy = (s.engineSettings?.withdrawalStrategy ??
          "fixed") as WithdrawalStrategyType;
        const strategyCfg = WITHDRAWAL_STRATEGY_CONFIG[strategy];
        const isDynamic = strategy !== "fixed";
        return (
          <div className="space-y-2">
            {isDynamic && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1.5">
                Your {strategyCfg?.label ?? strategy} strategy adjusts this rate
                yearly based on portfolio performance. This override changes the
                base rate the strategy starts from.
              </p>
            )}
            <SimpleNumberForm
              label={
                isDynamic
                  ? "New Initial Withdrawal Rate (%)"
                  : "New Withdrawal Rate (%)"
              }
              placeholder="3.5"
              step={0.1}
              initialValue={editingOverride?.initialValue}
              onSubmit={(val, notes) => {
                const o: DecumOverride = {
                  year,
                  withdrawalRate: val / 100,
                  ...(notes ? { notes } : {}),
                };
                s.setDecumOverrides((prev) =>
                  [
                    ...prev.filter(
                      (x) => x.year !== year || x.withdrawalRate == null,
                    ),
                    o,
                  ].sort((a, b) => a.year - b.year),
                );
                resetWizard();
              }}
            />
          </div>
        );
      }

      case "lump_sum":
        return (
          <div className="space-y-2">
            <LumpSumForm
              accounts={s.individualAccountNames ?? []}
              onAdd={(ls) => {
                const lumpEntry = {
                  id: ls.id,
                  amount: Math.abs(parseFloat(ls.amount)),
                  targetAccount: ls.targetAccount,
                  ...(ls.targetAccountName
                    ? { targetAccountName: ls.targetAccountName }
                    : {}),
                  ...(ls.label ? { label: ls.label } : {}),
                };
                if (isPostRetirement) {
                  const o: DecumOverride = {
                    year,
                    lumpSums: [lumpEntry],
                  };
                  s.setDecumOverrides((prev) =>
                    [...prev, o].sort((a, b) => a.year - b.year),
                  );
                } else {
                  const o: AccumOverride = {
                    year,
                    lumpSums: [lumpEntry],
                  };
                  s.setAccumOverrides((prev) =>
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
            contribProfiles={s.contribProfileSummaries ?? []}
            personId={s.salaryOverridePersonId ?? 1}
            initialValue={editingOverride?.initialValue}
            onSubmit={(salary, profileId, notes) => {
              s.createSalaryOverride.mutate({
                personId: s.salaryOverridePersonId ?? 1,
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
            budgetProfiles={s.budgetProfileSummaries ?? []}
            personId={s.salaryOverridePersonId ?? 1}
            initialValue={editingOverride?.initialValue}
            onSubmit={(annualBudget, notes) => {
              s.createBudgetOverride.mutate({
                personId: s.salaryOverridePersonId ?? 1,
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
              s.setDecumOverrides((prev) =>
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
                s.setDecumOverrides((prev) =>
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
                s.setAccumOverrides((prev) =>
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
            <p className="text-xs text-muted">
              This will revert all{" "}
              {isPostRetirement ? "withdrawal" : "contribution"} settings to
              page defaults starting in {selectedYear}.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (isPostRetirement) {
                    s.setDecumOverrides((prev) =>
                      [...prev, { year, reset: true }].sort(
                        (a, b) => a.year - b.year,
                      ),
                    );
                  } else {
                    s.setAccumOverrides((prev) =>
                      [...prev, { year, reset: true }].sort(
                        (a, b) => a.year - b.year,
                      ),
                    );
                  }
                  resetWizard();
                }}
                className="px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700"
              >
                Reset from {selectedYear}
              </button>
              <button
                type="button"
                onClick={resetWizard}
                className="px-3 py-1.5 text-xs text-muted hover:text-primary"
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
    <div className="border rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wider">
            Overrides
          </h4>
          <HelpTip text="Change contributions, withdrawals, salary, budget, or add lump sums at specific future years. Changes carry forward until the next override." />
          {totalCount > 0 && (
            <span className="text-[10px] text-faint">{totalCount} active</span>
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
          className={`text-xs font-medium px-3 py-1 rounded transition-colors ${
            showWizard
              ? "bg-surface-strong text-muted hover:text-primary"
              : "bg-indigo-600 text-white hover:bg-indigo-700"
          }`}
        >
          {showWizard ? "Cancel" : "+ Add Override"}
        </button>
      </div>

      {/* Wizard */}
      {showWizard && (
        <div className="bg-surface-sunken rounded-lg p-3 space-y-3">
          {/* Step indicator */}
          {editingOverride && (
            <div className="text-[10px] text-indigo-600 font-medium">
              Editing override for {selectedYear}
            </div>
          )}
          <div className="flex items-center gap-2 text-[10px] text-muted">
            <span
              className={
                wizardStep === "year" ? "text-indigo-600 font-semibold" : ""
              }
            >
              1. Year
            </span>
            <span>→</span>
            <span
              className={
                wizardStep === "type" ? "text-indigo-600 font-semibold" : ""
              }
            >
              2. What to change
            </span>
            <span>→</span>
            <span
              className={
                wizardStep === "fields" ? "text-indigo-600 font-semibold" : ""
              }
            >
              3. New value
            </span>
          </div>

          {/* Step 1: Year */}
          {wizardStep === "year" && (
            <div className="flex items-end gap-3">
              <label className="block">
                <span className="text-xs text-muted">Starting Year</span>
                <input
                  type="number"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="mt-0.5 block w-24 rounded border border-strong px-2 py-1.5 text-sm"
                />
              </label>
              {retYear && (
                <span className="text-[10px] text-faint pb-2">
                  {isPostRetirement
                    ? "Post-retirement (withdrawal phase)"
                    : `Pre-retirement (saving phase, retires ${retYear})`}
                </span>
              )}
              <button
                type="button"
                onClick={() => setWizardStep("type")}
                className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
              >
                Next
              </button>
            </div>
          )}

          {/* Step 2: Pick type */}
          {wizardStep === "type" && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setWizardStep("year")}
                  className="text-[10px] text-indigo-600 hover:underline"
                >
                  ← Back
                </button>
                <span className="text-xs text-muted">
                  Year {selectedYear} —{" "}
                  {isPostRetirement ? "post-retirement" : "pre-retirement"}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {availableOptions.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => {
                      setSelectedType(opt.key);
                      setWizardStep("fields");
                    }}
                    className="text-left p-2.5 rounded-lg border border-subtle hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
                  >
                    <div className="text-sm">
                      {opt.icon} {opt.label}
                    </div>
                    <div className="text-[10px] text-faint mt-0.5">
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
              <div className="flex items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setWizardStep("type")}
                  className="text-[10px] text-indigo-600 hover:underline"
                >
                  ← Back
                </button>
                <span className="text-xs text-muted">
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
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold shrink-0">{item.year}</span>
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
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
              <span className="flex items-center gap-1 ml-2 shrink-0">
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
        <p className="text-xs text-faint text-center py-2">
          No overrides — projection uses page settings for all years
        </p>
      )}
    </div>
  );
}

/** Simple single-value form used by most override types. */
function SimpleNumberForm({
  label,
  placeholder,
  step,
  isDollar: _isDollar,
  initialValue,
  onSubmit,
}: {
  label: string;
  placeholder: string;
  step?: number;
  isDollar?: boolean;
  initialValue?: string;
  onSubmit: (value: number, notes: string) => void;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [notes, setNotes] = useState("");

  return (
    <div className="flex items-end gap-3 flex-wrap">
      <label className="block">
        <span className="text-xs text-muted">{label}</span>
        <input
          type="number"
          min={0}
          step={step ?? 1}
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-0.5 block w-40 rounded border border-strong px-2 py-1.5 text-sm"
        />
      </label>
      <label className="block flex-1 min-w-[120px]">
        <span className="text-xs text-muted">Notes (optional)</span>
        <input
          type="text"
          placeholder="Reason for change"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-0.5 block w-full rounded border border-strong px-2 py-1.5 text-sm"
        />
      </label>
      <button
        type="button"
        onClick={() => {
          const num = parseFloat(value);
          if (isNaN(num) || num <= 0) return;
          onSubmit(num, notes);
        }}
        className="px-4 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
      >
        Save
      </button>
    </div>
  );
}

/** Routing mode selector form. */
function RoutingForm({
  isPostRetirement,
  onSubmit,
}: {
  isPostRetirement: boolean;
  onSubmit: (mode: string, notes: string) => void;
}) {
  const [mode, setMode] = useState<
    "bracket_filling" | "waterfall" | "percentage"
  >(isPostRetirement ? "bracket_filling" : "waterfall");
  const [notes, setNotes] = useState("");

  return (
    <div className="flex items-end gap-3 flex-wrap">
      <label className="block">
        <span className="text-xs text-muted">Routing Mode</span>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
          className="mt-0.5 block w-48 rounded border border-strong px-2 py-1.5 text-sm"
        >
          {isPostRetirement && (
            <option value="bracket_filling">
              Bracket Filling (tax-optimized)
            </option>
          )}
          <option value="waterfall">Waterfall (priority order)</option>
          <option value="percentage">Percentage (split by %)</option>
        </select>
      </label>
      <label className="block flex-1 min-w-[120px]">
        <span className="text-xs text-muted">Notes (optional)</span>
        <input
          type="text"
          placeholder="Reason for change"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-0.5 block w-full rounded border border-strong px-2 py-1.5 text-sm"
        />
      </label>
      <button
        type="button"
        onClick={() => onSubmit(mode, notes)}
        className="px-4 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
      >
        Save
      </button>
    </div>
  );
}

/** Salary override form — "From contribution profile" or custom salary amount. */
function SalaryOverrideForm({
  contribProfiles,
  initialValue,
  onSubmit,
}: {
  year: number;
  contribProfiles: {
    id: number;
    name: string;
    isDefault?: boolean;
    summary?: { combinedSalary: number };
  }[];
  personId: number;
  initialValue?: string;
  onSubmit: (salary: number, profileId: number | null, notes: string) => void;
}) {
  const [source, setSource] = useState<"custom" | "profile">(
    contribProfiles.length > 0 ? "profile" : "custom",
  );
  const [profileId, setProfileId] = useState(
    contribProfiles.find((p) => p.isDefault)?.id ?? contribProfiles[0]?.id ?? 0,
  );
  const [customValue, setCustomValue] = useState(initialValue ?? "");
  const [notes, setNotes] = useState("");

  const selectedProfile = contribProfiles.find((p) => p.id === profileId);
  const resolvedSalary =
    source === "profile" && selectedProfile?.summary
      ? selectedProfile.summary.combinedSalary
      : parseFloat(customValue) || 0;

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-3 flex-wrap">
        {contribProfiles.length > 0 && (
          <label className="block">
            <span className="text-xs text-muted">Source</span>
            <select
              value={source}
              onChange={(e) =>
                setSource(e.target.value as "custom" | "profile")
              }
              className="mt-0.5 block w-48 rounded border border-strong px-2 py-1.5 text-sm"
            >
              <option value="profile">From contribution profile</option>
              <option value="custom">Custom salary amount</option>
            </select>
          </label>
        )}
        {source === "profile" ? (
          <label className="block flex-1 min-w-[200px]">
            <span className="text-xs text-muted">Contribution Profile</span>
            <select
              value={String(profileId)}
              onChange={(e) => setProfileId(Number(e.target.value))}
              className="mt-0.5 block w-full rounded border border-strong px-2 py-1.5 text-sm"
            >
              {contribProfiles.map((cp) => (
                <option key={cp.id} value={String(cp.id)}>
                  {cp.isDefault ? "\u2713 " : ""}
                  {cp.name}
                  {cp.summary
                    ? ` (${formatCurrency(cp.summary.combinedSalary)}/yr)`
                    : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block">
            <span className="text-xs text-muted">Annual Salary ($)</span>
            <input
              type="number"
              min={0}
              placeholder="150000"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              className="mt-0.5 block w-40 rounded border border-strong px-2 py-1.5 text-sm"
            />
          </label>
        )}
        <label className="block flex-1 min-w-[120px]">
          <span className="text-xs text-muted">Notes (optional)</span>
          <input
            type="text"
            placeholder="New job, promotion, etc."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-0.5 block w-full rounded border border-strong px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            if (resolvedSalary <= 0) return;
            const profileNote =
              source === "profile" && selectedProfile
                ? `Profile: ${selectedProfile.name}${notes ? ` — ${notes}` : ""}`
                : notes;
            onSubmit(
              resolvedSalary,
              source === "profile" ? profileId : null,
              profileNote,
            );
          }}
          className="px-4 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
        >
          Save
        </button>
      </div>
      {source === "profile" && selectedProfile?.summary && (
        <p className="text-[10px] text-faint">
          Switches to {selectedProfile.name} contribution structure with{" "}
          {formatCurrency(selectedProfile.summary.combinedSalary)}/yr salary. To
          edit salary independently, use &quot;Custom salary amount&quot;
          instead.
        </p>
      )}
    </div>
  );
}

/** Budget override form — "From budget profile" or custom amount. */
function BudgetOverrideForm({
  budgetProfiles,
  initialValue,
  onSubmit,
}: {
  year: number;
  budgetProfiles: {
    id: number;
    name: string;
    isActive?: boolean;
    columnTotals: number[];
    columnLabels: string[];
  }[];
  personId: number;
  initialValue?: string;
  onSubmit: (annualBudget: number, notes: string) => void;
}) {
  const [source, setSource] = useState<"custom" | "profile">(
    budgetProfiles.length > 0 ? "profile" : "custom",
  );
  const [profileId, setProfileId] = useState(
    budgetProfiles.find((p) => p.isActive)?.id ?? budgetProfiles[0]?.id ?? 0,
  );
  const [columnIdx, setColumnIdx] = useState(0);
  const [customValue, setCustomValue] = useState(initialValue ?? "");
  const [notes, setNotes] = useState("");

  const selectedProfile = budgetProfiles.find((p) => p.id === profileId);
  const monthlyBudget =
    source === "profile" && selectedProfile
      ? (selectedProfile.columnTotals[columnIdx] ?? 0)
      : (parseFloat(customValue) || 0) / 12;
  const annualBudget = monthlyBudget * 12;

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-3 flex-wrap">
        {budgetProfiles.length > 0 && (
          <label className="block">
            <span className="text-xs text-muted">Source</span>
            <select
              value={source}
              onChange={(e) =>
                setSource(e.target.value as "custom" | "profile")
              }
              className="mt-0.5 block w-40 rounded border border-strong px-2 py-1.5 text-sm"
            >
              <option value="profile">From budget profile</option>
              <option value="custom">Custom amount</option>
            </select>
          </label>
        )}
        {source === "profile" ? (
          <>
            <label className="block flex-1 min-w-[180px]">
              <span className="text-xs text-muted">Budget Profile</span>
              <select
                value={String(profileId)}
                onChange={(e) => {
                  setProfileId(Number(e.target.value));
                  setColumnIdx(0);
                }}
                className="mt-0.5 block w-full rounded border border-strong px-2 py-1.5 text-sm"
              >
                {budgetProfiles.map((bp) => (
                  <option key={bp.id} value={String(bp.id)}>
                    {bp.isActive ? "\u2713 " : ""}
                    {bp.name} ({formatCurrency(bp.columnTotals[0] ?? 0)}/mo)
                  </option>
                ))}
              </select>
            </label>
            {selectedProfile && selectedProfile.columnLabels.length > 1 && (
              <label className="block">
                <span className="text-xs text-muted">Column</span>
                <select
                  value={String(columnIdx)}
                  onChange={(e) => setColumnIdx(Number(e.target.value))}
                  className="mt-0.5 block w-32 rounded border border-strong px-2 py-1.5 text-sm"
                >
                  {selectedProfile.columnLabels.map((label, colIndex) => (
                    // eslint-disable-next-line react/no-array-index-key -- column labels can repeat; index is the only stable key
                    <option key={colIndex} value={String(colIndex)}>
                      {label} (
                      {formatCurrency(
                        selectedProfile.columnTotals[colIndex] ?? 0,
                      )}
                      /mo)
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        ) : (
          <label className="block">
            <span className="text-xs text-muted">Annual Budget ($)</span>
            <input
              type="number"
              min={0}
              placeholder="90000"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              className="mt-0.5 block w-40 rounded border border-strong px-2 py-1.5 text-sm"
            />
          </label>
        )}
        <label className="block flex-1 min-w-[120px]">
          <span className="text-xs text-muted">Notes (optional)</span>
          <input
            type="text"
            placeholder="Reason for change"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-0.5 block w-full rounded border border-strong px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            if (annualBudget <= 0) return;
            const profileNote =
              source === "profile" && selectedProfile
                ? `Budget: ${selectedProfile.name} (${selectedProfile.columnLabels[columnIdx] ?? "Standard"}) — ${formatCurrency(monthlyBudget)}/mo${notes ? ` — ${notes}` : ""}`
                : notes;
            onSubmit(annualBudget, profileNote);
          }}
          className="px-4 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
        >
          Save
        </button>
      </div>
      {source === "profile" && selectedProfile && (
        <p className="text-[10px] text-faint">
          {selectedProfile.name} (
          {selectedProfile.columnLabels[columnIdx] ?? "Standard"}):{" "}
          {formatCurrency(monthlyBudget)}/mo · {formatCurrency(annualBudget)}/yr
        </p>
      )}
    </div>
  );
}
