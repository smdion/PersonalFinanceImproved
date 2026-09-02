/**
 * RMD Handling panel (R46) — what happens to Required Minimum Distribution
 * money beyond stated spending need. Two independent settings:
 * - rmdExcessHandling: reinvest into brokerage (default) or spend it.
 * - qcdMaximize: automatically apply Qualified Charitable Distributions
 *   against the RMD each year (a proactive election on the RMD itself,
 *   not a rule for leftover money — see PLAN-rmd-excess-handling.md).
 *
 * R47 adds a third, independent setting: rmdSmoothingEnabled — proactively
 * size Roth conversions BEFORE RMD age to shrink the future RMD toward
 * projected spending need, instead of reacting to an already-forced
 * excess. Requires individual-account tracking. Its own bracket-ceiling
 * dropdown (rmdSmoothingMaxBracketTarget) only renders once enabled, and
 * is seeded from the household's current rothBracketTarget the first time
 * they turn smoothing on — never a hardcoded default — so opting in can
 * never look like it silently lowered a Roth-conversion rate they already
 * configured. See PLAN-r47-rmd-aware-roth-smoothing.md.
 */
"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { Badge } from "@/components/ui/badge";
import type { Settings, UpsertSettingsMutation, IsEditable } from "./types";
import { buildSettingsPatch } from "./settings-patch";

type Props = {
  settings: Settings;
  upsertSettings: UpsertSettingsMutation;
  isEditable: IsEditable;
};

export function RmdHandlingSection({
  settings,
  upsertSettings,
  isEditable,
}: Props) {
  const rmdExcessHandling = settings?.rmdExcessHandling ?? "reinvest";
  const qcdMaximize = settings?.qcdMaximize ?? false;
  const rmdSmoothingEnabled = settings?.rmdSmoothingEnabled ?? false;
  const rmdSmoothingMaxBracketTarget = String(
    Number(
      settings?.rmdSmoothingMaxBracketTarget ??
        settings?.rothBracketTarget ??
        "0.24",
    ),
  );
  return (
    <div className="bg-surface-sunken rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-label font-semibold text-muted uppercase tracking-wider">
          RMD Handling
        </h4>
        <Badge color="indigo">Baseline + Simulation</Badge>
        <div className="flex-1 border-t" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <span className="text-muted">
            Excess RMD money
            <HelpTip
              text={
                "Required Minimum Distributions are forced out of Traditional " +
                "accounts regardless of what your withdrawal strategy actually " +
                "needs. When the RMD exceeds your stated spending need (after " +
                "any QCD reduces it first), this controls what happens to the " +
                "leftover: reinvest it into a taxable brokerage account (the " +
                "realistic default — the money stays yours, just taxable now), " +
                "or model it as spent (net worth ends up lower, on purpose)."
              }
            />
          </span>
          <div className="font-medium">
            <select
              value={rmdExcessHandling}
              onChange={(e) => {
                if (!settings) return;
                upsertSettings.mutate(
                  buildSettingsPatch(settings, {
                    rmdExcessHandling: e.target.value,
                  }),
                );
              }}
              disabled={!isEditable}
              className="text-sm border rounded px-1.5 py-0.5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="reinvest">Reinvest into brokerage</option>
              <option value="spend">Spend it</option>
            </select>
          </div>
        </div>
        <div>
          <span className="text-muted">
            Maximize QCD
            <HelpTip
              text={
                "Qualified Charitable Distribution — a direct IRA-to-charity " +
                "transfer that satisfies part of your RMD without counting as " +
                "taxable income. When on, automatically applies the largest QCD " +
                "your situation allows each year (capped by the IRS annual " +
                "per-person limit and your IRA-only Traditional balance — an " +
                "approximation, not exact IRS per-account-type RMD math; see " +
                "the Decumulation Methodology page). Only takes effect once " +
                "RMDs are active."
              }
            />
          </span>
          <div className="font-medium">
            <button
              onClick={() => {
                if (!settings) return;
                upsertSettings.mutate(
                  buildSettingsPatch(settings, {
                    qcdMaximize: !qcdMaximize,
                  }),
                );
              }}
              disabled={!isEditable}
              className={`text-sm px-2 py-0.5 rounded disabled:cursor-not-allowed disabled:opacity-50 ${
                qcdMaximize
                  ? "bg-green-100 text-green-700"
                  : "bg-surface-elevated text-muted"
              }`}
            >
              {qcdMaximize ? "On" : "Off"}
            </button>
          </div>
        </div>
        <div>
          <span className="text-muted">
            RMD Smoothing
            <HelpTip
              text={
                "Proactively convert Traditional to Roth in the years BEFORE " +
                "RMD age to shrink the future RMD toward what you'll actually " +
                "need — instead of reacting to an already-forced excess. May " +
                "elevate your effective conversion rate above the Bracket " +
                "Ceiling above (never below it) up to a separate limit you " +
                "set here. Requires individual account tracking."
              }
            />
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (!settings) return;
                const enabling = !rmdSmoothingEnabled;
                upsertSettings.mutate(
                  buildSettingsPatch(settings, {
                    rmdSmoothingEnabled: enabling,
                    // Seed the new ceiling from the household's CURRENT
                    // rothBracketTarget the first time they turn this on
                    // (not a hardcoded default) -- see module docblock.
                    ...(enabling &&
                    settings.rmdSmoothingMaxBracketTarget == null
                      ? { rmdSmoothingMaxBracketTarget }
                      : {}),
                  }),
                );
              }}
              disabled={!isEditable}
              className={`text-sm px-2 py-0.5 rounded disabled:cursor-not-allowed disabled:opacity-50 ${
                rmdSmoothingEnabled
                  ? "bg-green-100 text-green-700"
                  : "bg-surface-elevated text-muted"
              }`}
            >
              {rmdSmoothingEnabled ? "On" : "Off"}
            </button>
            {rmdSmoothingEnabled && (
              <select
                value={rmdSmoothingMaxBracketTarget}
                onChange={(e) => {
                  if (!settings) return;
                  upsertSettings.mutate(
                    buildSettingsPatch(settings, {
                      rmdSmoothingMaxBracketTarget: e.target.value,
                    }),
                  );
                }}
                disabled={!isEditable}
                className="text-sm border rounded px-1.5 py-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="0.1">Up to 10%</option>
                <option value="0.12">Up to 12%</option>
                <option value="0.22">Up to 22%</option>
                <option value="0.24">Up to 24%</option>
                <option value="0.32">Up to 32%</option>
              </select>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
