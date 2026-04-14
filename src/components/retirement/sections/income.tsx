/**
 * Income section — extracted from retirement-content.tsx in PR 8/2 of the
 * v0.5.2 file-split refactor. Pure relocation — no behavior changes. Sits in
 * the left column of the Projection Assumptions card alongside Timeline,
 * covering Household Salary (read-only), Pre-Retirement Raise, Salary Cap,
 * and the Contribution Profile picker.
 *
 * The `decToWhole` helper is duplicated locally from retirement-content.tsx
 * so this component is self-contained. It's a 4-line pure function — cheaper
 * than wiring up a shared helper module for a single consumer (and the other
 * consumers still live in retirement-content.tsx, so we haven't created
 * drift). The helper can be factored out in a later cleanup pass if more
 * sections end up needing it.
 */
"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type {
  Settings,
  UpsertSettingsMutation,
  ContribProfileListEntry as ContribProfile,
} from "./types";

/** Convert a decimal string (e.g. '0.04') to a whole-number string for display ('4'). */
function decToWhole(v: string): string {
  const n = parseFloat(v);
  if (isNaN(n)) return "0";
  return String(Math.round(n * 10000) / 100); // 0.04 → 4
}

type Props = {
  settings: Settings;
  combinedSalary: number | null | undefined;
  upsertSettings: UpsertSettingsMutation;
  handleSettingPercentUpdate: (field: string, wholePercent: string) => void;
  contribProfiles: ContribProfile[];
  contribProfileId: number | null;
  setContribProfileId: (id: number | null) => void;
};

export function IncomeSection({
  settings,
  combinedSalary,
  upsertSettings,
  handleSettingPercentUpdate,
  contribProfiles,
  contribProfileId,
  setContribProfileId,
}: Props) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wider">
          Income
        </h4>
        <div className="flex-1 border-t" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <span className="text-muted">
            Household Salary
            <HelpTip text="Combined annual salary from your jobs. This is your starting income — grows each year by the Pre-Retirement Raise rate until retirement." />
          </span>
          <div className="font-medium">
            {combinedSalary != null ? formatCurrency(combinedSalary) : "—"}
            <span className="text-[10px] text-faint font-normal ml-1">
              from jobs
            </span>
          </div>
        </div>
        <div>
          <span className="text-muted">
            Pre-Retirement Raise
            <HelpTip text="Annual salary raise % during working years. Affects future contributions and employer match." />
          </span>
          <div className="font-medium">
            <InlineEdit
              value={decToWhole(settings.salaryAnnualIncrease)}
              onSave={(v) =>
                handleSettingPercentUpdate("salaryAnnualIncrease", v)
              }
              formatDisplay={(v) => formatPercent(Number(v) / 100, 2)}
              parseInput={(v) => v.replace(/[^0-9.]/g, "")}
              type="number"
              className="text-sm"
              editable={!!settings}
            />
          </div>
        </div>
        <div>
          <span className="text-muted">
            Salary Cap
            <HelpTip text="Growth stops at this amount. Leave blank for no cap." />
          </span>
          <div className="font-medium">
            <InlineEdit
              value={
                settings.salaryCap
                  ? String(Math.round(parseFloat(settings.salaryCap)))
                  : ""
              }
              onSave={(v) => {
                if (!settings) return;
                const val = v.replace(/[^0-9]/g, "");
                upsertSettings.mutate({
                  personId: settings.personId,
                  retirementAge: settings.retirementAge,
                  endAge: settings.endAge,
                  returnAfterRetirement: settings.returnAfterRetirement,
                  annualInflation: settings.annualInflation,
                  salaryAnnualIncrease: settings.salaryAnnualIncrease,
                  salaryCap: val === "" ? null : val,
                });
              }}
              formatDisplay={(v) => (v ? formatCurrency(Number(v)) : "None")}
              parseInput={(v) => v.replace(/[^0-9]/g, "")}
              type="number"
              className="text-sm"
              editable={!!settings}
            />
          </div>
        </div>
        <div>
          <span className="text-muted">
            Contribution Profile
            <HelpTip text="Select a contribution profile to override salary and contribution assumptions in the projection. 'Live' uses your current paycheck/contribution settings." />
          </span>
          <div className="font-medium">
            <select
              className="text-sm border rounded px-2 py-1 bg-surface-primary w-full"
              value={contribProfileId ?? ""}
              onChange={(e) =>
                setContribProfileId(
                  e.target.value ? Number(e.target.value) : null,
                )
              }
            >
              {contribProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {!p.name.includes("(Live)") && p.isDefault ? " (Live)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
