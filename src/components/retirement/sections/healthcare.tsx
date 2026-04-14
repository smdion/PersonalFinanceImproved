/**
 * Healthcare Cost Awareness panel — extracted from retirement-content.tsx in
 * PR 7/3 of the v0.5.2 file-split refactor. Pure relocation — no behavior
 * changes. Holds the IRMAA awareness toggle, ACA subsidy awareness toggle,
 * and conditional household-size selector.
 */
"use client";

import { HelpTip } from "@/components/ui/help-tip";
import type { Settings, UpsertSettingsMutation } from "./types";

type Props = {
  settings: Settings;
  upsertSettings: UpsertSettingsMutation;
};

export function HealthcareSection({ settings, upsertSettings }: Props) {
  return (
    <div className="bg-surface-sunken rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wider">
          Healthcare
        </h4>
        <span className="text-[9px] text-purple-400 bg-purple-50 px-1.5 py-0.5 rounded">
          Baseline + Simulation
        </span>
        <div className="flex-1 border-t" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 text-sm">
        <div>
          <span className="text-muted">
            IRMAA (65+)
            <HelpTip text="Medicare Part B+D surcharges triggered by MAGI cliffs. Crossing a cliff by $1 costs $1,000-$6,900+/year per person. Engine warns when Roth conversions or withdrawals approach a cliff." />
          </span>
          <div className="font-medium">
            <button
              onClick={() => {
                if (!settings) return;
                upsertSettings.mutate({
                  personId: settings.personId,
                  retirementAge: settings.retirementAge,
                  endAge: settings.endAge,
                  returnAfterRetirement: settings.returnAfterRetirement,
                  annualInflation: settings.annualInflation,
                  salaryAnnualIncrease: settings.salaryAnnualIncrease,
                  enableIrmaaAwareness: !(
                    settings.enableIrmaaAwareness ?? false
                  ),
                });
              }}
              className={`text-sm px-2 py-0.5 rounded ${
                (settings?.enableIrmaaAwareness ?? false)
                  ? "bg-green-100 text-green-700"
                  : "bg-surface-elevated text-muted"
              }`}
            >
              {(settings?.enableIrmaaAwareness ?? false) ? "On" : "Off"}
            </button>
          </div>
        </div>
        <div>
          <span className="text-muted">
            ACA Subsidy (Pre-65)
            <HelpTip text="ACA health insurance subsidy cliff. Going $1 over 400% FPL costs $15,000-$25,000+ in lost subsidies. Engine warns when MAGI approaches the cliff and prefers Roth/HSA withdrawals." />
          </span>
          <div className="font-medium">
            <button
              onClick={() => {
                if (!settings) return;
                upsertSettings.mutate({
                  personId: settings.personId,
                  retirementAge: settings.retirementAge,
                  endAge: settings.endAge,
                  returnAfterRetirement: settings.returnAfterRetirement,
                  annualInflation: settings.annualInflation,
                  salaryAnnualIncrease: settings.salaryAnnualIncrease,
                  enableAcaAwareness: !(settings.enableAcaAwareness ?? false),
                });
              }}
              className={`text-sm px-2 py-0.5 rounded ${
                (settings?.enableAcaAwareness ?? false)
                  ? "bg-green-100 text-green-700"
                  : "bg-surface-elevated text-muted"
              }`}
            >
              {(settings?.enableAcaAwareness ?? false) ? "On" : "Off"}
            </button>
          </div>
        </div>
        {(settings?.enableAcaAwareness ?? false) && (
          <div>
            <span className="text-muted">Household Size</span>
            <div className="font-medium">
              <select
                value={String(settings?.householdSize ?? 2)}
                onChange={(e) => {
                  if (!settings) return;
                  upsertSettings.mutate({
                    personId: settings.personId,
                    retirementAge: settings.retirementAge,
                    endAge: settings.endAge,
                    returnAfterRetirement: settings.returnAfterRetirement,
                    annualInflation: settings.annualInflation,
                    salaryAnnualIncrease: settings.salaryAnnualIncrease,
                    householdSize: parseInt(e.target.value, 10),
                  });
                }}
                className="text-sm border rounded px-1.5 py-0.5"
              >
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
                <option value="6">6</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
