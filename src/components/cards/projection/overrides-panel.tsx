"use client";

/** Unified overrides panel — thin shell that delegates to section components. */
import { HelpTip } from "@/components/ui/help-tip";
import type { useProjectionState } from "./use-projection-state";
import { SavingOverridesSection } from "./overrides-saving-section";
import { WithdrawalOverridesSection } from "./overrides-withdrawal-section";
import { LifeChangesSection } from "./overrides-life-section";

function SectionHeader({
  title,
  help,
  children,
}: {
  title: string;
  help?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h4 className="text-xs font-medium text-muted uppercase tracking-wide">
        {title}
        {help && <HelpTip text={help} />}
      </h4>
      {children}
    </div>
  );
}

type ProjectionState = ReturnType<typeof useProjectionState>;

export type OverridesSectionProps = {
  state: ProjectionState;
  accumulationExpenseOverride?: number;
};

export type OverridesPanelProps = OverridesSectionProps;

/**
 * Unified overrides panel — saving, withdrawal, salary, and budget overrides.
 * Extracted from ProjectionCard to reduce file size.
 */
export function OverridesPanel({
  state: s,
  accumulationExpenseOverride,
}: OverridesPanelProps) {
  return (
    <div className="border rounded-lg p-4 space-y-3">
      <SectionHeader
        title="Overrides"
        help="Change contribution, withdrawal, salary, or budget settings at specific future years. Each override carries forward (sticky) until the next override for that field. Use 'Reset to defaults' to revert all fields at once."
      />

      {/* Summary counts */}
      <div className="flex flex-wrap gap-3 text-xs text-muted">
        <span>
          <span className="font-medium text-emerald-700">
            {s.accumOverrides.length}
          </span>{" "}
          pre-retirement
        </span>
        <span>
          <span className="font-medium text-amber-700">
            {s.decumOverrides.length}
          </span>{" "}
          post-retirement
        </span>
        <span>
          <span className="font-medium text-secondary">
            {(s.dbSalaryOverrides?.length ?? 0) +
              (s.dbBudgetOverrides?.length ?? 0)}
          </span>{" "}
          life change
        </span>
      </div>

      <SavingOverridesSection state={s} />
      <WithdrawalOverridesSection state={s} />
      <LifeChangesSection
        state={s}
        accumulationExpenseOverride={accumulationExpenseOverride}
      />
    </div>
  );
}
