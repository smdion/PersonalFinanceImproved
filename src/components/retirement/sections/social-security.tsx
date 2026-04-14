/**
 * Social Security settings panel — extracted from retirement-content.tsx in
 * PR 7 of the v0.5.2 file-split refactor (leaves-first, advisor-mandated).
 *
 * Pure relocation — no behavior changes. The upsertSettings mutation passes
 * through as a prop so the parent keeps owning the optimistic-update glue.
 */
"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency } from "@/lib/utils/format";

// Prop types are hand-rolled rather than inferred from the server router
// because src/components/** is lint-forbidden from importing @/server/*
// (no-restricted-imports rule). The parent `retirement-content.tsx` already
// guards on `data.settings` presence before rendering this component.
type Settings = {
  personId: number;
  retirementAge: number;
  endAge: number;
  returnAfterRetirement: string;
  annualInflation: string;
  salaryAnnualIncrease: string;
  socialSecurityMonthly: string;
  ssStartAge: number;
};
type PerPersonSettings = ReadonlyArray<{
  personId: number;
  name: string;
  retirementAge: number;
  endAge: number | null;
  socialSecurityMonthly: string;
}> | null;
// The mutation pass-through type is intentionally loose — the section
// only needs to call `.mutate(...)` and the parent owns the full optimistic
// update pipeline. A tighter type would require importing from @/server,
// which is forbidden.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UpsertSettingsMutation = { mutate: (input: any) => void };

type Props = {
  settings: Settings;
  perPersonSettings: PerPersonSettings;
  upsertSettings: UpsertSettingsMutation;
};

export function SocialSecuritySection({
  settings,
  perPersonSettings,
  upsertSettings,
}: Props) {
  return (
    <div className="bg-surface-sunken rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wider">
          Social Security
        </h4>
        <span className="text-[9px] text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded font-medium">
          Baseline + Simulation
        </span>
        <div className="flex-1 border-t" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-sm">
        {perPersonSettings && perPersonSettings.length > 1 ? (
          perPersonSettings.map((ps) => (
            <div key={ps.personId}>
              <span className="text-muted">
                {ps.name}&apos;s Benefit
                <HelpTip text="Estimated benefit in today's dollars (find yours at ssa.gov). Grown by the Post-Retirement Raise rate each year." />
              </span>
              <div className="font-medium">
                <InlineEdit
                  value={ps.socialSecurityMonthly}
                  onSave={(v) => {
                    const parsed = parseFloat(v);
                    if (isNaN(parsed) || parsed < 0) return;
                    upsertSettings.mutate({
                      personId: ps.personId,
                      retirementAge: ps.retirementAge,
                      endAge: ps.endAge ?? settings.endAge,
                      returnAfterRetirement: settings.returnAfterRetirement,
                      annualInflation: settings.annualInflation,
                      salaryAnnualIncrease: settings.salaryAnnualIncrease,
                      socialSecurityMonthly: String(parsed),
                    });
                  }}
                  formatDisplay={(v) => `${formatCurrency(Number(v))}/mo`}
                  parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                  type="number"
                  className="text-sm"
                  editable={!!settings}
                />
                <span className="text-[10px] text-faint">
                  {formatCurrency(Number(ps.socialSecurityMonthly) * 12)}
                  /yr
                </span>
              </div>
            </div>
          ))
        ) : (
          <div>
            <span className="text-muted">
              Monthly Benefit
              <HelpTip text="Estimated benefit in today's dollars (find yours at ssa.gov). Grown by the Post-Retirement Raise rate each year." />
            </span>
            <div className="font-medium">
              <InlineEdit
                value={settings.socialSecurityMonthly}
                onSave={(v) => {
                  if (!settings) return;
                  const parsed = parseFloat(v);
                  if (isNaN(parsed) || parsed < 0) return;
                  upsertSettings.mutate({
                    personId: settings.personId,
                    retirementAge: settings.retirementAge,
                    endAge: settings.endAge,
                    returnAfterRetirement: settings.returnAfterRetirement,
                    annualInflation: settings.annualInflation,
                    salaryAnnualIncrease: settings.salaryAnnualIncrease,
                    socialSecurityMonthly: String(parsed),
                  });
                }}
                formatDisplay={(v) => `${formatCurrency(Number(v))}/mo`}
                parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                type="number"
                className="text-sm"
                editable={!!settings}
              />
              <span className="text-[10px] text-faint">
                {formatCurrency(Number(settings.socialSecurityMonthly) * 12)}
                /yr
              </span>
            </div>
          </div>
        )}
        <div>
          <span className="text-muted">
            Start Age
            <HelpTip text="62 = earliest (reduced), 67 = full, 70 = max (+8%/yr for delay)." />
          </span>
          <div className="font-medium">
            <InlineEdit
              value={String(settings.ssStartAge)}
              onSave={(v) => {
                if (!settings) return;
                const parsed = parseInt(v, 10);
                if (isNaN(parsed) || parsed < 62 || parsed > 75) return;
                upsertSettings.mutate({
                  personId: settings.personId,
                  retirementAge: settings.retirementAge,
                  endAge: settings.endAge,
                  returnAfterRetirement: settings.returnAfterRetirement,
                  annualInflation: settings.annualInflation,
                  salaryAnnualIncrease: settings.salaryAnnualIncrease,
                  ssStartAge: parsed,
                });
              }}
              type="number"
              className="text-sm"
              editable={!!settings}
            />
          </div>
        </div>
        <div>
          <span className="text-muted">
            Taxable Portion
            <HelpTip text="Percentage subject to federal tax. Most retirees with other income hit the 85% threshold." />
          </span>
          <div className="font-medium text-muted">~85%</div>
        </div>
      </div>
    </div>
  );
}
