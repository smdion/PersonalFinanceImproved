/**
 * Income section — extracted from retirement-content.tsx in PR 8/2 of the
 * v0.5.2 file-split refactor. Pure relocation — no behavior changes. Sits in
 * the left column of the Projection Assumptions card alongside Timeline,
 * covering Household Salary (read-only), Pre-Retirement Raise, Salary Cap,
 * and the Contribution Profile picker.
 *
 * The `decToWhole` helper lives in `./helpers` and is shared across the
 * retirement sections that need it (not duplicated locally).
 */
"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Tooltip } from "@/components/ui/tooltip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type {
  Settings,
  UpsertSettingsMutation,
  ContribProfileListEntry as ContribProfile,
  IsEditable,
} from "./types";
import { buildSettingsPatch } from "./settings-patch";
import { decToWhole } from "./helpers";

type Props = {
  settings: Settings;
  combinedSalary: number | null | undefined;
  /** id/name for every household member — joined against salaryByPerson to
   *  build the hover breakdown. Omit (or leave salaryByPerson empty) for a
   *  single-person household; the breakdown only adds value once there's
   *  more than one number to break down. */
  people?: { id: number; name: string }[];
  /** personId -> that person's share of combinedSalary. Same aggregate
   *  (totalComp, includes bonus) as combinedSalary itself — the per-person
   *  lines always sum to the displayed total. */
  salaryByPerson?: Record<number, number>;
  upsertSettings: UpsertSettingsMutation;
  handleSettingPercentUpdate: (field: string, wholePercent: string) => void;
  contribProfiles: ContribProfile[];
  contribProfileId: number | null;
  setContribProfileId: (id: number | null) => void;
  /** Whether an active Plan pin — not this page's own selection — is what's
   *  actually driving the projection. When true the select below is
   *  disabled: changing it wouldn't change anything until the Plan pin is
   *  cleared, so editing it here would be misleading. */
  isContribPinned?: boolean;
  salaryProfiles: { id: number; name: string }[];
  salaryProfileId: number | null;
  setSalaryProfileId: (id: number | null) => void;
  isSalaryPinned?: boolean;
  /** Name of the Plan doing the pinning, shown in the note next to either select. */
  pinnedPlanName?: string;
  isEditable: IsEditable;
};

export function IncomeSection({
  settings,
  combinedSalary,
  people,
  salaryByPerson,
  upsertSettings,
  handleSettingPercentUpdate,
  contribProfiles,
  contribProfileId,
  setContribProfileId,
  isContribPinned,
  salaryProfiles,
  salaryProfileId,
  setSalaryProfileId,
  isSalaryPinned,
  pinnedPlanName,
  isEditable,
}: Props) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-label font-semibold text-muted uppercase tracking-wider">
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
            {(() => {
              const breakdown = (people ?? [])
                .filter((p) => salaryByPerson?.[p.id])
                .map((p) => ({ name: p.name, salary: salaryByPerson![p.id]! }));
              const value =
                combinedSalary != null ? formatCurrency(combinedSalary) : "—";
              if (breakdown.length < 2) return value;
              return (
                <Tooltip
                  lines={breakdown.map((b) => (
                    <span key={b.name}>
                      {b.name}: {formatCurrency(b.salary)}
                    </span>
                  ))}
                >
                  <span className="cursor-help underline decoration-dotted decoration-faint underline-offset-2">
                    {value}
                  </span>
                </Tooltip>
              );
            })()}
            <span className="text-caption text-faint font-normal ml-1">
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
              isEditable={isEditable}
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
                upsertSettings.mutate(
                  buildSettingsPatch(settings, {
                    salaryCap: val === "" ? null : val,
                  }),
                );
              }}
              formatDisplay={(v) => (v ? formatCurrency(Number(v)) : "None")}
              parseInput={(v) => v.replace(/[^0-9]/g, "")}
              type="number"
              className="text-sm"
              isEditable={isEditable}
            />
          </div>
        </div>
        <div>
          <span className="text-muted">
            Salary Profile
            <HelpTip text="Which Salary Profile the salaries in this projection come from. Each profile sets every person to either follow their job record or a fixed amount. Independent of the Contribution Profile beside it — the two are separate selections. This selection is saved as your active Salary Profile and applies on every page until you change it back; it is not a one-off preview. A Plan pin, if one is set, overrides it." />
          </span>
          <div className="font-medium">
            <select
              className="text-sm border rounded px-2 py-1 bg-surface-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              value={salaryProfileId ?? ""}
              disabled={isSalaryPinned}
              onChange={(e) =>
                setSalaryProfileId(
                  e.target.value ? Number(e.target.value) : null,
                )
              }
            >
              {salaryProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {isSalaryPinned && (
              <div className="text-caption text-amber-600 mt-0.5">
                Pinned by Plan{pinnedPlanName ? ` "${pinnedPlanName}"` : ""} —
                clear the pin to change this here.
              </div>
            )}
          </div>
        </div>
        <div>
          <span className="text-muted">
            Contribution Profile
            <HelpTip text="Which Contribution Profile the contribution assumptions in this projection come from. Salary is a separate selection — see Salary Profile. This selection is saved as your active Contribution Profile and applies on every page until you change it back; it is not a one-off preview. A Plan pin, if one is set, overrides it." />
          </span>
          <div className="font-medium">
            <select
              className="text-sm border rounded px-2 py-1 bg-surface-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              value={contribProfileId ?? ""}
              disabled={isContribPinned}
              onChange={(e) =>
                setContribProfileId(
                  e.target.value ? Number(e.target.value) : null,
                )
              }
            >
              {contribProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {isContribPinned && (
              <div className="text-caption text-amber-600 mt-0.5">
                Pinned by Plan{pinnedPlanName ? ` "${pinnedPlanName}"` : ""} —
                clear the pin to change this here.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
