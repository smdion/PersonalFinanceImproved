import type { useBudgetProfilesList } from "@/lib/hooks/use-budget-profiles-list";
import type { RouterOutputs } from "@/lib/trpc";
import type { useSandboxState } from "./use-what-if-sandbox";
import { HelpTip } from "@/components/ui/help-tip";
import { ProfilePicker } from "./what-if-profile-picker";
import type { Dispatch, SetStateAction } from "react";

export type WhatIfPickersProps = {
  availableYears: number[];
  budgetId: number | null;
  budgetProfiles: ReturnType<typeof useBudgetProfilesList>["data"];
  contribId: number | null;
  contributionProfiles:
    RouterOutputs["contributionProfile"]["list"] | undefined;
  salaryId: number | null;
  salaryProfiles: RouterOutputs["salaryProfile"]["list"] | undefined;
  sandbox: ReturnType<typeof useSandboxState>;
  setPickedBudgetId: Dispatch<SetStateAction<number | null>>;
  setPickedContributionId: Dispatch<SetStateAction<number | null>>;
  setPickedSalaryId: Dispatch<SetStateAction<number | null>>;
  setTaxYear: Dispatch<SetStateAction<number>>;
  taxYear: number;
};

export function WhatIfPickers({
  availableYears,
  budgetId,
  budgetProfiles,
  contribId,
  contributionProfiles,
  salaryId,
  salaryProfiles,
  sandbox,
  setPickedBudgetId,
  setPickedContributionId,
  setPickedSalaryId,
  setTaxYear,
  taxYear,
}: WhatIfPickersProps) {
  return (
    <div className="border-default bg-surface-sunken/40 rounded-lg border px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="text-muted text-xs font-semibold tracking-wide uppercase">
          Starting point
          <HelpTip text="Nothing on this tab changes what's active for your household. Pick any combination of profiles, edit salary/bonus and budget amounts to preview them, then use Duplicate Profile or Save as Plan below if you want to keep it." />
        </span>
        <ProfilePicker
          label="Salary"
          value={salaryId}
          options={salaryProfiles ?? []}
          onChange={setPickedSalaryId}
        />
        <ProfilePicker
          label="Contribution"
          value={contribId}
          options={contributionProfiles ?? []}
          onChange={setPickedContributionId}
        />
        <ProfilePicker
          label="Budget"
          value={budgetId}
          options={budgetProfiles ?? []}
          onChange={setPickedBudgetId}
        />
        {availableYears.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-muted text-xs">Tax Year:</span>
            <div className="flex gap-1">
              {availableYears.map((year) => (
                <button
                  key={year}
                  type="button"
                  onClick={() => setTaxYear(year)}
                  className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                    taxYear === year
                      ? "bg-blue-600 text-white"
                      : "bg-surface-elevated text-muted hover:bg-surface-strong"
                  }`}
                >
                  {year}
                </button>
              ))}
            </div>
          </div>
        )}
        {sandbox.hasEdits && (
          <button
            type="button"
            onClick={sandbox.resetSandbox}
            className="text-caption text-faint ml-auto hover:text-red-600"
          >
            Reset sandbox
          </button>
        )}
      </div>
    </div>
  );
}
