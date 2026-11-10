/**
 * Taxes in Retirement panel, a presentational leaf (props in, JSX out): the parent owns every
 * query, including `bracketOptimizerResult`. `selectedScenario` supplies the brokerage LTCG rate.
 */
"use client";

import { storedStrategyConfig } from "@/lib/config/stored-withdrawal-strategy";
import {
  parseReturnFilingStatus,
  RETURN_FILING_STATUS_VALUES,
} from "@/lib/config/filing-status";
import {
  FILING_STATUS_LABELS,
  filingStatusLabel,
} from "@/lib/config/display-labels";
import { useId, useState } from "react";
import { HelpTip } from "@/components/ui/help-tip";
import { HSA_DRAW_TREATMENT } from "@/lib/pure/accounts/early-access";
import { Badge } from "@/components/ui/badge";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatPercent } from "@/lib/utils/format";
import { accountTextColor, taxTypeTextColor } from "@/lib/utils/colors";
import {
  getAllCategories,
  getAccountTypeConfig,
  getDefaultDecumulationOrder,
  DEFAULT_WITHDRAWAL_SPLITS,
} from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";
import { WithdrawalOrderEditor } from "@/components/retirement/withdrawal-order-editor";
import type { BracketOptimizerResult } from "@/lib/pure/retirement/withdrawal-bracket-optimizer";
import type {
  Settings,
  SelectedScenario,
  UpsertSettingsMutation,
  IsEditable,
} from "./types";
import { buildSettingsPatch } from "./settings-patch";
import { rothTargetOf } from "./helpers";
import {
  WITHDRAWAL_ROUTING_MODES,
  WITHDRAWAL_ROUTING_MODE_LABELS,
  WITHDRAWAL_ROUTING_MODE_DESCRIPTIONS,
  DEFAULT_WITHDRAWAL_ROUTING_MODE,
} from "@/lib/config/withdrawal-routing";

type Props = {
  settings: Settings;
  selectedScenario: SelectedScenario;
  upsertSettings: UpsertSettingsMutation;
  isEditable: IsEditable;
  /** Multi-year withdrawal-policy optimizer result, or undefined while the
   *  parent's query hasn't resolved yet — either way, no recommendation is
   *  shown until a real, non-null `recommendedTarget` arrives. */
  bracketOptimizerResult?: BracketOptimizerResult | null;
};

export function TaxesSection({
  settings,
  selectedScenario,
  upsertSettings,
  isEditable,
  bracketOptimizerResult,
}: Props) {
  const id = useId();
  const filingStatus = settings.filingStatus;

  // Saved withdrawal order/splits; NULL falls back to config defaults (as
  // `buildDecumulationDefaults` does). Order swaps save at once; splits on Save.
  const persistedOrder =
    (settings.withdrawalOrder as AccountCategory[] | null) ??
    getDefaultDecumulationOrder();
  const persistedSplits =
    (settings.withdrawalSplits as Record<string, number> | null) ??
    DEFAULT_WITHDRAWAL_SPLITS;
  const routingMode = settings.withdrawalRoutingMode;
  const [splitsDraft, setSplitsDraft] = useState<Record<string, number> | null>(
    null,
  );
  const effectiveSplits = splitsDraft ?? persistedSplits;
  const splitsTotal = getAllCategories().reduce(
    // A stored splits record can be partial (older versions saved one).
    (sum, c) => sum + (effectiveSplits[c] ?? 0),
    0,
  );

  // The withdrawal-policy optimizer's recommendation beside the Bracket
  // Ceiling, whatever the toggles: rothBracketTarget also sets RMD
  // smoothing's ceiling and, under bracket filling, distribution routing.
  const recommendedTarget = bracketOptimizerResult?.recommendedTarget ?? null;
  const willChangeSmoothingCeiling =
    recommendedTarget != null && settings.rmdSmoothingEnabled;

  const applyRecommendedTarget = () => {
    if (recommendedTarget == null) return;
    const target = String(recommendedTarget);
    upsertSettings.mutate(
      buildSettingsPatch(settings, {
        rothBracketTarget: target,
        // Moved together as the optimizer scores a candidate
        // (buildCandidateInput), each on its own toggle.
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
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-label text-muted font-semibold tracking-wider uppercase">
          Taxes in Retirement
        </h4>
        <select
          aria-label="Filing status"
          className="text-caption text-faint hover:border-border focus:border-accent cursor-pointer rounded border border-transparent bg-transparent px-1 py-0.5 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          value={settings.filingStatusExplicit ?? ""}
          disabled={!isEditable}
          onChange={(e) => {
            const val = e.target.value || null;
            upsertSettings.mutate(
              buildSettingsPatch(settings, {
                filingStatus: parseReturnFilingStatus(val),
              }),
            );
          }}
        >
          <option value="">
            {/* null after an "Auto" save, in the optimistic update until the refetch */}
            Auto ({filingStatusLabel(filingStatus ?? "")})
          </option>
          {RETURN_FILING_STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {FILING_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <span className="text-caption text-faint">brackets</span>
        <HelpTip text="Tax filing status used for retirement tax estimates — affects federal brackets, LTCG rates, IRMAA thresholds, and Social Security taxation. Change it here if your filing status will change in retirement. This year's return has its own filing status on the Taxes page. Ledgr doesn't model married filing separately." />
        <Badge color="indigo">Baseline + Simulation</Badge>
        <div className="flex-1 border-t" />
      </div>
      {/* Tax rates by account type — compact row */}
      <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
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
          <span className="font-medium text-blue-600">Varies</span>
          <HelpTip text={HSA_DRAW_TREATMENT} />
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-muted">Brokerage</span>
          <span className="text-muted font-medium">
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
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
        <div>
          <span className="text-muted">
            Tax Multiplier
            <HelpTip text="Scales the estimated tax bill. <1 = expect lower rates, >1 = expect higher. 1.0 uses today's brackets as-is." />
          </span>
          <div className="flex items-baseline gap-1.5 font-medium">
            <InlineEdit
              value={settings.taxMultiplier}
              onSave={(v) => {
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
                upsertSettings.mutate(
                  buildSettingsPatch(settings, {
                    grossUpForTaxes: !settings.grossUpForTaxes,
                  }),
                );
              }}
              disabled={!isEditable}
              className={`rounded px-2 py-0.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                settings.grossUpForTaxes
                  ? "bg-green-100 text-green-700"
                  : "bg-surface-elevated text-muted"
              }`}
            >
              {settings.grossUpForTaxes ? "On" : "Off"}
            </button>
          </div>
          {withdrawalSized(settings) && (
            <span className="text-caption text-faint">
              {settings.withdrawalStrategy === "rmd_spending"
                ? "From the RMD age, no effect: "
                : "No effect with this strategy: "}
              it sets the withdrawal itself, tax comes out of it, and Social
              Security comes on top.
            </span>
          )}
        </div>
        <div>
          <label htmlFor={`${id}-ceiling`} className="text-muted">
            Bracket Ceiling
            <HelpTip text="Fill traditional (pre-tax) withdrawals up to this bracket, then use Roth for the rest. Keeps taxable income in cheaper brackets." />
          </label>
          <div className="font-medium">
            <select
              id={`${id}-ceiling`}
              value={String(rothTargetOf(settings.rothBracketTarget))}
              onChange={(e) => {
                upsertSettings.mutate(
                  buildSettingsPatch(settings, {
                    rothBracketTarget: e.target.value,
                  }),
                );
              }}
              disabled={!isEditable}
              className="rounded border px-1.5 py-0.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="0.1">10% (~$30k MFJ)</option>
              <option value="0.12">12% (~$116k MFJ)</option>
              <option value="0.22">22% (~$226k MFJ)</option>
              <option value="0.24">24% (~$414k MFJ)</option>
              <option value="0.32">32% (~$526k MFJ)</option>
            </select>
            {recommendedTarget != null && (
              <div className="text-caption mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className="text-faint">
                  Currently recommended:{" "}
                  <span className="text-foreground font-medium">
                    {formatPercent(recommendedTarget)}
                  </span>
                </span>
                <HelpTip text="Searches your own real tax brackets for the target that minimizes lifetime tax cost (including Roth conversions and RMDs, plus a penalty for Traditional money left unconverted at the end of the projection) while still funding your stated spending need. Recomputed from your current settings — not a one-time suggestion." />
                {isEditable && (
                  <button
                    onClick={applyRecommendedTarget}
                    className="text-caption bg-accent/10 text-accent hover:bg-accent/20 rounded px-1.5 py-0.5"
                  >
                    Apply
                  </button>
                )}
                {willChangeSmoothingCeiling && (
                  <span className="text-micro text-faint w-full">
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
                upsertSettings.mutate(
                  buildSettingsPatch(settings, {
                    enableRothConversions: !settings.enableRothConversions,
                  }),
                );
              }}
              disabled={!isEditable}
              className={`rounded px-2 py-0.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                settings.enableRothConversions
                  ? "bg-green-100 text-green-700"
                  : "bg-surface-elevated text-muted"
              }`}
            >
              {settings.enableRothConversions ? "On" : "Off"}
            </button>
            {settings.enableRothConversions && (
              <select
                aria-label="Roth conversion target bracket"
                value={String(
                  rothTargetOf(
                    settings.rothConversionTarget ?? settings.rothBracketTarget,
                  ),
                )}
                onChange={(e) => {
                  upsertSettings.mutate(
                    buildSettingsPatch(settings, {
                      rothConversionTarget: e.target.value,
                    }),
                  );
                }}
                disabled={!isEditable}
                className="rounded border px-1.5 py-0.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
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
          <label htmlFor={`${id}-order`} className="text-muted">
            Discretionary Withdrawal Order
            <HelpTip text="Beyond your Traditional bracket target, which free source drains first: Roth basis (default) or brokerage's 0%-capital-gains room. Brokerage-first uses up the 0% room sooner, but a brokerage gain still counts toward MAGI for ACA/IRMAA even when it's taxed at 0% federally — Roth withdrawals never touch MAGI. If you have ACA or IRMAA awareness on, brokerage-first trades subsidy/surcharge risk for using that room sooner." />
          </label>
          <div className="font-medium">
            <select
              id={`${id}-order`}
              value={settings.discretionaryWithdrawalOrder}
              onChange={(e) => {
                upsertSettings.mutate(
                  buildSettingsPatch(settings, {
                    discretionaryWithdrawalOrder: e.target.value,
                  }),
                );
              }}
              disabled={!isEditable}
              className="rounded border px-1.5 py-0.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="roth_first">Roth basis first (default)</option>
              <option value="brokerage_first">Brokerage 0% room first</option>
            </select>
            {settings.discretionaryWithdrawalOrder === "brokerage_first" &&
              (settings.enableAcaAwareness ||
                settings.enableIrmaaAwareness) && (
                <div className="text-caption mt-1.5 text-amber-700">
                  ACA/IRMAA awareness is on — brokerage-first will realize
                  MAGI-counted gains sooner each year, which can reduce ACA
                  subsidy or bring you closer to an IRMAA surcharge tier even
                  though those gains are taxed at 0% federally.
                </div>
              )}
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-routing`} className="text-muted">
            Withdrawal Routing
            <HelpTip
              text={`WHICH accounts fund a year's withdrawal (separate from your spending strategy above, which decides HOW MUCH). ${WITHDRAWAL_ROUTING_MODE_DESCRIPTIONS.bracket_filling} This is your saved default — the Retirement page's Configure toggle can change it for one session without changing what's saved here.`}
            />
          </label>
          <div className="font-medium">
            <select
              id={`${id}-routing`}
              value={settings.withdrawalRoutingMode}
              onChange={(e) => {
                upsertSettings.mutate(
                  buildSettingsPatch(settings, {
                    withdrawalRoutingMode: e.target.value,
                  }),
                );
              }}
              disabled={!isEditable}
              className="rounded border px-1.5 py-0.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {WITHDRAWAL_ROUTING_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {WITHDRAWAL_ROUTING_MODE_LABELS[mode]}
                  {mode === DEFAULT_WITHDRAWAL_ROUTING_MODE ? " (default)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Persisted withdrawal order / splits — the saved household default
          the Retirement page's Configure toggle overrides per-session. */}
      <div className="mt-3 border-t pt-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-muted text-xs font-medium tracking-wide uppercase">
            Withdrawal Order
          </span>
          <HelpTip text="Your saved default account draw order. Waterfall mode drains accounts in exactly this sequence; Bracket Filling uses the 401k/403b/IRA part of it to decide which Traditional account fills the bracket first. RMDs are enforced regardless of order. The Retirement page's Configure toggle can change this for one session without changing what's saved here." />
        </div>
        <WithdrawalOrderEditor
          order={persistedOrder}
          onChange={(next) => {
            upsertSettings.mutate(
              buildSettingsPatch(settings, { withdrawalOrder: next }),
            );
          }}
          disabled={!isEditable}
        />
        {settings.withdrawalOrder != null && isEditable && (
          <button
            type="button"
            onClick={() =>
              upsertSettings.mutate(
                buildSettingsPatch(settings, { withdrawalOrder: null }),
              )
            }
            className="text-caption text-faint hover:text-secondary mt-1.5 underline"
          >
            Reset to default order
          </button>
        )}

        {routingMode === "percentage" && (
          <div className="mt-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-muted text-xs font-medium tracking-wide uppercase">
                Withdrawal Splits
              </span>
              <HelpTip text="How a year's total withdrawal divides across accounts in Percentage mode. Values should sum to 100%. Only applies while Withdrawal Routing is set to Percentage." />
            </div>
            <div className="grid grid-cols-3 gap-3 md:grid-cols-5">
              {getAllCategories().map((cat) => (
                <label key={cat} className="block">
                  <span
                    className={`text-xs font-medium ${accountTextColor(cat)}`}
                  >
                    {getAccountTypeConfig(cat).displayLabel} %
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    disabled={!isEditable}
                    // A stored splits record can be partial (older versions saved one).
                    value={Math.round((effectiveSplits[cat] ?? 0) * 100)}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value) / 100;
                      setSplitsDraft((prev) => ({
                        ...(prev ?? persistedSplits),
                        [cat]: isNaN(v) ? 0 : v,
                      }));
                    }}
                    className="border-strong mt-1 block w-full rounded border px-2 py-1 text-right text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </label>
              ))}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              {Math.abs(splitsTotal - 1) > 0.001 && (
                <span className="text-caption text-amber-600">
                  Splits total {formatPercent(splitsTotal)} — should be 100%.
                </span>
              )}
              {splitsDraft != null && isEditable && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      upsertSettings.mutate(
                        buildSettingsPatch(settings, {
                          withdrawalSplits: splitsDraft,
                        }),
                      );
                      setSplitsDraft(null);
                    }}
                    className="text-caption bg-accent/10 text-accent hover:bg-accent/20 rounded px-1.5 py-0.5"
                  >
                    Save splits
                  </button>
                  <button
                    type="button"
                    onClick={() => setSplitsDraft(null)}
                    className="text-caption text-faint hover:text-secondary underline"
                  >
                    Cancel
                  </button>
                </>
              )}
              {splitsDraft == null && settings.withdrawalSplits != null && (
                <button
                  type="button"
                  onClick={() =>
                    upsertSettings.mutate(
                      buildSettingsPatch(settings, { withdrawalSplits: null }),
                    )
                  }
                  className="text-caption text-faint hover:text-secondary underline"
                >
                  Reset to default splits
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** The active strategy sizes the portfolio withdrawal with Social Security
 *  on top (its "comes out of this amount" switch off) — nothing is grossed
 *  up then. */
function withdrawalSized(settings: Settings | undefined): boolean {
  if (!settings) return false;
  const meta = storedStrategyConfig(settings.withdrawalStrategy);
  const field = meta?.paramFields.find((f) => f.key === "ssInAmount");
  if (!field) return false;
  const stored = (settings as Record<string, unknown>)[field.column];
  return stored == null ? field.default !== true : stored !== true;
}
