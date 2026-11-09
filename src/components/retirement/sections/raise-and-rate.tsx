/**
 * Post-Retirement Raise + Withdrawal Rate row. Each input is dimmed and read-only when the active
 * strategy ignores it (`usesPostRetirementRaise`/`usesWithdrawalRate`); the rate label reads
 * "Initial Withdrawal Rate" or "Withdrawal Rate" depending on the strategy's `incomeSource`.
 */
"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { InlineEdit } from "@/components/ui/inline-edit";
import { storedStrategyConfig } from "@/lib/config/stored-withdrawal-strategy";
import { formatPercent } from "@/lib/utils/format";
import type { Settings, IsEditable } from "./types";
import { decimalToWhole } from "./helpers";

type Props = {
  settings: Settings;
  handleSettingPercentUpdate: (field: string, wholePercent: string) => void;
  isEditable: IsEditable;
};

export function RaiseAndRateSection({
  settings,
  handleSettingPercentUpdate,
  isEditable,
}: Props) {
  const meta = storedStrategyConfig(settings.withdrawalStrategy);
  if (!meta) return null;
  return (
    <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
      <div className={!meta.usesPostRetirementRaise ? "opacity-40" : ""}>
        <span className="text-muted">
          Post-Retirement Raise
          <HelpTip
            text={
              meta.usesPostRetirementRaise
                ? "Your annual 'raise' in retirement. The base is your Retirement budget — this rate grows it each year, like a cost-of-living adjustment. Set apart from the Inflation rate; in the Simulation it moves with each trial's inflation, keeping your gap between the two."
                : `Not used by ${meta.label}: its spending ${meta.usesWithdrawalRate ? "grows with inflation less its decline rate" : "is sized from your balance"}.`
            }
          />
        </span>
        <div className="font-medium">
          <InlineEdit
            value={decimalToWhole(
              settings.postRetirementInflation ?? settings.annualInflation,
            )}
            onSave={(v) =>
              handleSettingPercentUpdate("postRetirementInflation", v)
            }
            formatDisplay={(v) => formatPercent(Number(v) / 100, 2)}
            parseInput={(v) => v.replace(/[^0-9.]/g, "")}
            type="number"
            className="text-sm"
            isEditable={isEditable && meta.usesPostRetirementRaise}
          />
        </div>
      </div>
      <div className={!meta.usesWithdrawalRate ? "opacity-40" : ""}>
        <span className="text-muted">
          {meta.incomeSource === "budget"
            ? "Withdrawal Rate"
            : "Initial Withdrawal Rate"}
          <HelpTip
            text={
              !meta.usesWithdrawalRate
                ? `Not used by ${meta.label} — this strategy computes spending from its own formula (${meta.incomeSource === "formula" ? "IRS factors" : "base percentage of portfolio"}).`
                : meta.incomeSource === "rate"
                  ? `Not used by ${meta.label}: it sets its own starting rate from your Retirement budget (less Social Security, over the balance) and defends it. Used only by the Initial Rate scenario and the FI target.`
                  : `Not used by ${meta.label}: your Retirement budget sets year 1. Used only by the Initial Rate scenario and the FI target.`
            }
          />
        </span>
        <div className="font-medium">
          <InlineEdit
            value={decimalToWhole(settings.withdrawalRate)}
            onSave={(v) => handleSettingPercentUpdate("withdrawalRate", v)}
            formatDisplay={(v) => formatPercent(Number(v) / 100, 2)}
            parseInput={(v) => v.replace(/[^0-9.]/g, "")}
            type="number"
            className="text-sm"
            isEditable={isEditable && meta.usesWithdrawalRate}
          />
        </div>
      </div>
    </div>
  );
}
