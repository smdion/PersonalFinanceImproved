/**
 * Taxes in Retirement panel — extracted from retirement-content.tsx in PR 7/2
 * of the v0.5.2 file-split refactor. Pure relocation — no behavior changes.
 *
 * The `filingStatus` placeholder in the "Auto" option is derived locally from
 * `settings.filingStatus` (identical to the old `const filingStatus =
 * settings.filingStatus` in the parent). `selectedScenario` is plumbed through
 * so the brokerage LTCG rate still reads off the active scenario.
 */
"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatPercent } from "@/lib/utils/format";
import type {
  Settings,
  SelectedScenario,
  UpsertSettingsMutation,
} from "./types";

type Props = {
  settings: Settings;
  selectedScenario: SelectedScenario;
  upsertSettings: UpsertSettingsMutation;
};

export function TaxesSection({
  settings,
  selectedScenario,
  upsertSettings,
}: Props) {
  const filingStatus = settings.filingStatus;
  return (
    <div className="bg-surface-sunken rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wider">
          Taxes in Retirement
        </h4>
        <select
          className="text-[10px] text-faint bg-transparent border border-transparent hover:border-border rounded px-1 py-0.5 cursor-pointer focus:outline-none focus:border-accent"
          value={settings.filingStatusExplicit ?? ""}
          onChange={(e) => {
            const val = e.target.value || null;
            upsertSettings.mutate({
              personId: settings.personId,
              retirementAge: settings.retirementAge,
              endAge: settings.endAge,
              returnAfterRetirement: settings.returnAfterRetirement,
              annualInflation: settings.annualInflation,
              salaryAnnualIncrease: settings.salaryAnnualIncrease,
              filingStatus: val as "MFJ" | "Single" | "HOH" | null,
            });
          }}
        >
          <option value="">Auto ({filingStatus})</option>
          <option value="MFJ">MFJ</option>
          <option value="Single">Single</option>
          <option value="HOH">HOH</option>
        </select>
        <span className="text-[10px] text-faint">brackets</span>
        <HelpTip text="Tax filing status used for retirement tax estimates — affects federal brackets, LTCG rates, IRMAA thresholds, and Social Security taxation. 'Auto' inherits from your primary job's W-4. Override it here if your filing status will change in retirement." />
        <span className="text-[9px] text-purple-400 bg-purple-50 px-1.5 py-0.5 rounded">
          Baseline + Simulation
        </span>
        <div className="flex-1 border-t" />
      </div>
      {/* Tax rates by account type — compact row */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mb-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-muted">Pre-Tax</span>
          <span className="font-medium text-blue-600">Varies</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-muted">Roth</span>
          <span className="font-medium text-green-600">0%</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-muted">HSA</span>
          <span className="font-medium text-emerald-600">0%</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-muted">Brokerage</span>
          <span className="font-medium text-muted">
            {selectedScenario
              ? formatPercent(
                  parseFloat(selectedScenario.distributionTaxRateBrokerage),
                )
              : "15%"}
            {""}
            LTCG
          </span>
        </div>
      </div>
      {/* Tax controls */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-sm">
        <div>
          <span className="text-muted">
            Tax Multiplier
            <HelpTip text="Scales the estimated tax bill. <1 = expect lower rates, >1 = expect higher. 1.0 uses today's brackets as-is." />
          </span>
          <div className="font-medium flex items-baseline gap-1.5">
            <InlineEdit
              value={settings.taxMultiplier}
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
                  taxMultiplier: String(parsed),
                });
              }}
              formatDisplay={(v) => `${Number(v).toFixed(1)}×`}
              parseInput={(v) => v.replace(/[^0-9.]/g, "")}
              type="number"
              className="text-sm"
              editable={!!settings}
            />
            <span className="text-[10px] text-faint">
              {Number(settings.taxMultiplier) < 1
                ? "lower rates expected"
                : Number(settings.taxMultiplier) > 1
                  ? "higher rates expected"
                  : "current rates"}
            </span>
          </div>
        </div>
        <div>
          <span className="text-muted">
            Gross-Up
            <HelpTip text="ON: withdraw extra so after-tax covers expenses. OFF: taxes reduce spendable income." />
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
                  grossUpForTaxes: !(settings.grossUpForTaxes ?? true),
                });
              }}
              className={`text-sm px-2 py-0.5 rounded ${
                (settings?.grossUpForTaxes ?? true)
                  ? "bg-green-100 text-green-700"
                  : "bg-surface-elevated text-muted"
              }`}
            >
              {(settings?.grossUpForTaxes ?? true) ? "On" : "Off"}
            </button>
          </div>
        </div>
        <div>
          <span className="text-muted">
            Bracket Ceiling
            <HelpTip text="Fill traditional (pre-tax) withdrawals up to this bracket, then use Roth for the rest. Keeps taxable income in cheaper brackets." />
          </span>
          <div className="font-medium">
            <select
              value={String(Number(settings?.rothBracketTarget ?? "0.12"))}
              onChange={(e) => {
                if (!settings) return;
                upsertSettings.mutate({
                  personId: settings.personId,
                  retirementAge: settings.retirementAge,
                  endAge: settings.endAge,
                  returnAfterRetirement: settings.returnAfterRetirement,
                  annualInflation: settings.annualInflation,
                  salaryAnnualIncrease: settings.salaryAnnualIncrease,
                  rothBracketTarget: e.target.value,
                });
              }}
              className="text-sm border rounded px-1.5 py-0.5"
            >
              <option value="0.1">10% (~$30k MFJ)</option>
              <option value="0.12">12% (~$116k MFJ)</option>
              <option value="0.22">22% (~$226k MFJ)</option>
              <option value="0.24">24% (~$414k MFJ)</option>
              <option value="0.32">32% (~$526k MFJ)</option>
            </select>
          </div>
        </div>
        <div>
          <span className="text-muted">
            Roth Conversions
            <HelpTip text="Automatically convert Traditional balances to Roth each year to fill the target bracket. Most valuable during the 'golden window' between retirement and RMD age. Tax on conversions is paid from brokerage." />
          </span>
          <div className="flex items-center gap-2">
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
                  enableRothConversions: !(
                    settings.enableRothConversions ?? false
                  ),
                });
              }}
              className={`text-sm px-2 py-0.5 rounded ${
                (settings?.enableRothConversions ?? false)
                  ? "bg-green-100 text-green-700"
                  : "bg-surface-elevated text-muted"
              }`}
            >
              {(settings?.enableRothConversions ?? false) ? "On" : "Off"}
            </button>
            {(settings?.enableRothConversions ?? false) && (
              <select
                value={String(
                  Number(
                    settings?.rothConversionTarget ??
                      settings?.rothBracketTarget ??
                      "0.12",
                  ),
                )}
                onChange={(e) => {
                  if (!settings) return;
                  upsertSettings.mutate({
                    personId: settings.personId,
                    retirementAge: settings.retirementAge,
                    endAge: settings.endAge,
                    returnAfterRetirement: settings.returnAfterRetirement,
                    annualInflation: settings.annualInflation,
                    salaryAnnualIncrease: settings.salaryAnnualIncrease,
                    rothConversionTarget: e.target.value,
                  });
                }}
                className="text-sm border rounded px-1.5 py-0.5"
              >
                <option value="0.1">10%</option>
                <option value="0.12">12%</option>
                <option value="0.22">22%</option>
                <option value="0.24">24%</option>
              </select>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
