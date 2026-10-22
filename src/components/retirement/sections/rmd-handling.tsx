/**
 * RMD Handling panel — what happens to Required Minimum Distribution
 * money beyond stated spending need. Two independent settings:
 * - rmdExcessHandling: reinvest into brokerage (default) or spend it, and
 *   rmdExcessTargetPerformanceAccountId: which Retirement brokerage the
 *   reinvested money goes to (default: spread across them; never a
 *   Portfolio account).
 * - qcdMaximize: automatically apply Qualified Charitable Distributions
 *   against the RMD each year (a proactive election on the RMD itself,
 *   not a rule for leftover money).
 *
 * A third, independent setting, rmdSmoothingEnabled, proactively
 * sizes Roth conversions BEFORE RMD age to shrink the future RMD toward
 * projected spending need, instead of reacting to an already-forced
 * excess. Requires individual-account tracking. Its own bracket-ceiling
 * dropdown (rmdSmoothingMaxBracketTarget) only renders once enabled, and
 * is seeded from the household's current rothBracketTarget the first time
 * they turn smoothing on — never a hardcoded default — so opting in can
 * never look like it silently lowered a Roth-conversion rate they already
 * configured.
 */
"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { trpc } from "@/lib/trpc";
import { accountDisplayName } from "@/lib/utils/format";
import {
  isRetirementParent,
  tracksCostBasis,
} from "@/lib/config/account-types";
import { PROJECTED_RETIREMENT_BROKERAGE_LABEL } from "@/lib/config/display-labels";
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
  const rmdExcessTarget = settings?.rmdExcessTargetPerformanceAccountId ?? null;
  // Unspent RMD money is retirement money: only active Retirement
  // brokerages can receive it.
  const { data: perfAccounts } =
    trpc.performance.performanceAccounts.list.useQuery();
  const retirementBrokerages = (perfAccounts ?? []).filter(
    (p) =>
      p.isActive &&
      tracksCostBasis(p.accountType) &&
      isRetirementParent(p.parentCategory),
  );
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
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-label text-muted font-semibold tracking-wider uppercase">
          RMD Handling
        </h4>
        <Badge color="indigo">Baseline + Simulation</Badge>
        <div className="flex-1 border-t" />
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
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
              className="rounded border px-1.5 py-0.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="reinvest">Reinvest into brokerage</option>
              <option value="spend">Spend it</option>
            </select>
          </div>
        </div>
        <div>
          <span className="text-muted">
            Reinvested into
            <HelpTip
              text={
                "Which retirement brokerage receives reinvested RMD money. It " +
                "stays retirement money, so it never goes to a Portfolio " +
                "account. By default it's spread across your Retirement " +
                "brokerages by balance."
              }
            />
          </span>
          <div className="font-medium">
            {retirementBrokerages.length === 0 ? (
              <span className="text-faint text-xs">
                No Retirement brokerage — the projection adds &ldquo;
                {PROJECTED_RETIREMENT_BROKERAGE_LABEL}&rdquo; for it.
              </span>
            ) : (
              <select
                value={rmdExcessTarget ?? ""}
                aria-label="Reinvested RMD money goes to"
                onChange={(e) => {
                  if (!settings) return;
                  upsertSettings.mutate(
                    buildSettingsPatch(settings, {
                      rmdExcessTargetPerformanceAccountId: e.target.value
                        ? Number(e.target.value)
                        : null,
                    }),
                  );
                }}
                disabled={!isEditable || rmdExcessHandling === "spend"}
                className="rounded border px-1.5 py-0.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Spread across Retirement brokerages</option>
                {retirementBrokerages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {accountDisplayName(p)}
                  </option>
                ))}
              </select>
            )}
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
              className={`rounded px-2 py-0.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
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
              className={`rounded px-2 py-0.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
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
                className="rounded border px-1.5 py-0.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
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
