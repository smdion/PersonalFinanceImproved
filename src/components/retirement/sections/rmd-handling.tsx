/**
 * RMD Handling panel (R46) — what happens to Required Minimum Distribution
 * money beyond stated spending need. Two independent settings:
 * - rmdExcessHandling: reinvest into brokerage (default) or spend it.
 * - qcdMaximize: automatically apply Qualified Charitable Distributions
 *   against the RMD each year (a proactive election on the RMD itself,
 *   not a rule for leftover money — see PLAN-rmd-excess-handling.md).
 */
"use client";

import { HelpTip } from "@/components/ui/help-tip";
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
  return (
    <div className="bg-surface-sunken rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-label font-semibold text-muted uppercase tracking-wider">
          RMD Handling
        </h4>
        <span className="text-micro text-purple-400 bg-purple-50 px-1.5 py-0.5 rounded">
          Baseline + Simulation
        </span>
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
      </div>
    </div>
  );
}
