/**
 * Taxes in Retirement panel — extracted from retirement-content.tsx in PR 7/2
 * of the v0.5.2 file-split refactor. Pure relocation — no behavior changes.
 *
 * The `filingStatus` placeholder in the "Auto" option is derived locally from
 * `settings.filingStatus` (identical to the old `const filingStatus =
 * settings.filingStatus` in the parent). `selectedScenario` is plumbed through
 * so the brokerage LTCG rate still reads off the active scenario.
 *
 * `bracketOptimizerResult` (multi-year withdrawal-policy optimizer, Phase 4,
 * 2026-08-29): deliberately a plain prop, not a tRPC query owned by this
 * component. This file is documented (retirement-sections-smoke.test.tsx) as
 * a pure presentational leaf — "Settings + callback props in, JSX out" — and
 * the parent (retirement-profile-tab.tsx) already owns every other query
 * this tab depends on, same pattern as `CoastFireCard` receiving
 * `coastFireMcResult` as a prop rather than querying it itself.
 */
"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatPercent } from "@/lib/utils/format";
import { taxTypeTextColor } from "@/lib/utils/colors";
import type {
  Settings,
  SelectedScenario,
  UpsertSettingsMutation,
  IsEditable,
} from "./types";
import { buildSettingsPatch } from "./settings-patch";

/** Shape of `computeWithdrawalBracketOptimizer`'s result — mirrored here
 *  (not imported from @/server/*, same reasoning as types.ts's docblock)
 *  since sections may not import server code. */
export type BracketOptimizerResult = {
  recommendedTarget: number | null;
  currentTarget: number | null;
} | null;

type Props = {
  settings: Settings;
  selectedScenario: SelectedScenario;
  upsertSettings: UpsertSettingsMutation;
  isEditable: IsEditable;
  /** Multi-year withdrawal-policy optimizer result, or undefined while the
   *  parent's query hasn't resolved yet — either way, no recommendation is
   *  shown until a real, non-null `recommendedTarget` arrives. */
  bracketOptimizerResult?: BracketOptimizerResult;
};

export function TaxesSection({
  settings,
  selectedScenario,
  upsertSettings,
  isEditable,
  bracketOptimizerResult,
}: Props) {
  const filingStatus = settings.filingStatus;

  // Multi-year withdrawal-policy optimizer, Phase 4 — live recommendation
  // next to the Bracket Ceiling control below. Not gated on
  // withdrawalRoutingMode (this Settings type doesn't carry that field —
  // it's a Projection-card-local override, see decumulation-config.tsx)
  // and not gated on enableRothConversions either: rothBracketTarget also
  // governs RMD smoothing's ceiling and (when routing IS bracket_filling,
  // the site-wide default) distribution routing itself, so the
  // recommendation is relevant regardless of which toggles happen to be on.
  const recommendedTarget = bracketOptimizerResult?.recommendedTarget ?? null;
  const willChangeSmoothingCeiling =
    recommendedTarget != null && (settings.rmdSmoothingEnabled ?? false);

  const applyRecommendedTarget = () => {
    if (!settings || recommendedTarget == null) return;
    const target = String(recommendedTarget);
    upsertSettings.mutate(
      buildSettingsPatch(settings, {
        rothBracketTarget: target,
        // Joint movement, mirroring how the optimizer itself scores a
        // candidate (withdrawal-bracket-optimizer.ts's buildCandidateInput)
        // -- each gated on its OWN toggle, independently, per the design
        // doc's correction (rmdSmoothingMaxBracketTarget must key off
        // rmdSmoothingEnabled specifically, NOT enableRothConversions).
        ...(settings.enableRothConversions
          ? { rothConversionTarget: target }
          : {}),
        ...(settings.rmdSmoothingEnabled
          ? { rmdSmoothingMaxBracketTarget: target }
          : {}),
      }),
    );
  };

  return (
    <div className="bg-surface-sunken rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-label font-semibold text-muted uppercase tracking-wider">
          Taxes in Retirement
        </h4>
        <select
          className="text-caption text-faint bg-transparent border border-transparent hover:border-border rounded px-1 py-0.5 cursor-pointer focus:outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50"
          value={settings.filingStatusExplicit ?? ""}
          disabled={!isEditable}
          onChange={(e) => {
            const val = e.target.value || null;
            upsertSettings.mutate(
              buildSettingsPatch(settings, {
                filingStatus: val as "MFJ" | "Single" | "HOH" | null,
              }),
            );
          }}
        >
          <option value="">Auto ({filingStatus})</option>
          <option value="MFJ">MFJ</option>
          <option value="Single">Single</option>
          <option value="HOH">HOH</option>
        </select>
        <span className="text-caption text-faint">brackets</span>
        <HelpTip text="Tax filing status used for retirement tax estimates — affects federal brackets, LTCG rates, IRMAA thresholds, and Social Security taxation. 'Auto' inherits from your primary job's W-4. Override it here if your filing status will change in retirement." />
        <span className="text-micro text-purple-400 bg-purple-50 px-1.5 py-0.5 rounded">
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
          <span className={`font-medium ${taxTypeTextColor("taxFree")}`}>
            0%
          </span>
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
                upsertSettings.mutate(
                  buildSettingsPatch(settings, {
                    taxMultiplier: String(parsed),
                  }),
                );
              }}
              formatDisplay={(v) => `${Number(v).toFixed(1)}×`}
              parseInput={(v) => v.replace(/[^0-9.]/g, "")}
              type="number"
              className="text-sm"
              isEditable={isEditable}
            />
            <span className="text-caption text-faint">
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
                upsertSettings.mutate(
                  buildSettingsPatch(settings, {
                    grossUpForTaxes: !(settings.grossUpForTaxes ?? true),
                  }),
                );
              }}
              disabled={!isEditable}
              className={`text-sm px-2 py-0.5 rounded disabled:cursor-not-allowed disabled:opacity-50 ${
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
                upsertSettings.mutate(
                  buildSettingsPatch(settings, {
                    rothBracketTarget: e.target.value,
                  }),
                );
              }}
              disabled={!isEditable}
              className="text-sm border rounded px-1.5 py-0.5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="0.1">10% (~$30k MFJ)</option>
              <option value="0.12">12% (~$116k MFJ)</option>
              <option value="0.22">22% (~$226k MFJ)</option>
              <option value="0.24">24% (~$414k MFJ)</option>
              <option value="0.32">32% (~$526k MFJ)</option>
            </select>
            {recommendedTarget != null && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption">
                <span className="text-faint">
                  Currently recommended:{" "}
                  <span className="font-medium text-foreground">
                    {formatPercent(recommendedTarget)}
                  </span>
                </span>
                <HelpTip text="Searches your own real tax brackets for the target that minimizes lifetime tax cost (including Roth conversions and RMDs, plus a penalty for Traditional money left unconverted at end of plan) while still funding your stated spending need. Recomputed from your current settings — not a one-time suggestion." />
                {isEditable && (
                  <button
                    onClick={applyRecommendedTarget}
                    className="text-caption px-1.5 py-0.5 rounded bg-accent/10 text-accent hover:bg-accent/20"
                  >
                    Apply
                  </button>
                )}
                {willChangeSmoothingCeiling && (
                  <span className="w-full text-micro text-faint">
                    Will also update your RMD Smoothing ceiling (below) to{" "}
                    {formatPercent(recommendedTarget)}.
                  </span>
                )}
              </div>
            )}
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
                upsertSettings.mutate(
                  buildSettingsPatch(settings, {
                    enableRothConversions: !(
                      settings.enableRothConversions ?? false
                    ),
                  }),
                );
              }}
              disabled={!isEditable}
              className={`text-sm px-2 py-0.5 rounded disabled:cursor-not-allowed disabled:opacity-50 ${
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
                  upsertSettings.mutate(
                    buildSettingsPatch(settings, {
                      rothConversionTarget: e.target.value,
                    }),
                  );
                }}
                disabled={!isEditable}
                className="text-sm border rounded px-1.5 py-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="0.1">10%</option>
                <option value="0.12">12%</option>
                <option value="0.22">22%</option>
                <option value="0.24">24%</option>
              </select>
            )}
          </div>
        </div>
        <div>
          <span className="text-muted">
            Discretionary Withdrawal Order
            <HelpTip text="Beyond your Traditional bracket target, which free source drains first: Roth basis (default) or brokerage's 0%-capital-gains room. Brokerage-first uses up the 0% room sooner, but a brokerage gain still counts toward MAGI for ACA/IRMAA even when it's taxed at 0% federally — Roth withdrawals never touch MAGI. If you have ACA or IRMAA awareness on, brokerage-first trades subsidy/surcharge risk for using that room sooner." />
          </span>
          <div className="font-medium">
            <select
              value={settings?.discretionaryWithdrawalOrder ?? "roth_first"}
              onChange={(e) => {
                if (!settings) return;
                upsertSettings.mutate(
                  buildSettingsPatch(settings, {
                    discretionaryWithdrawalOrder: e.target.value,
                  }),
                );
              }}
              disabled={!isEditable}
              className="text-sm border rounded px-1.5 py-0.5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="roth_first">Roth basis first (default)</option>
              <option value="brokerage_first">Brokerage 0% room first</option>
            </select>
            {settings?.discretionaryWithdrawalOrder === "brokerage_first" &&
              ((settings?.enableAcaAwareness ?? false) ||
                (settings?.enableIrmaaAwareness ?? false)) && (
                <div className="mt-1.5 text-caption text-amber-700">
                  ACA/IRMAA awareness is on — brokerage-first will realize
                  MAGI-counted gains sooner each year, which can reduce ACA
                  subsidy or bring you closer to an IRMAA surcharge tier even
                  though those gains are taxed at 0% federally.
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
