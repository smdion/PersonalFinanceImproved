/**
 * Post-Retirement Raise + Withdrawal Rate side-by-side row — extracted from
 * the Decumulation Plan block in retirement-content.tsx in PR 8/3c of the
 * v0.5.2 file-split refactor. Pure relocation — no behavior changes.
 *
 * Each input is dimmed to 40% opacity when the active withdrawal strategy
 * doesn't use it (the strategy registry's `usesPostRetirementRaise` /
 * `usesWithdrawalRate` flags). The Withdrawal Rate label and help text also
 * flip between "Withdrawal Rate" / "Initial Withdrawal Rate" depending on
 * the strategy's `incomeSource`.
 *
 * The `decToWhole` helper is duplicated locally so the component is
 * self-contained; the parent still owns its own copy for the other (non-
 * extracted) InlineEdit call sites.
 */
"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { InlineEdit } from "@/components/ui/inline-edit";
import {
  getStrategyMeta,
  type WithdrawalStrategyType,
} from "@/lib/config/withdrawal-strategies";
import { formatPercent } from "@/lib/utils/format";
import type { Settings } from "./types";
import { decToWhole } from "./helpers";

type Props = {
  settings: Settings;
  handleSettingPercentUpdate: (field: string, wholePercent: string) => void;
};

export function RaiseAndRateSection({
  settings,
  handleSettingPercentUpdate,
}: Props) {
  const s = (settings?.withdrawalStrategy ?? "fixed") as WithdrawalStrategyType;
  const meta = getStrategyMeta(s);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm mt-2">
      <div className={!meta.usesPostRetirementRaise ? "opacity-40" : ""}>
        <span className="text-muted">
          Post-Retirement Raise
          <HelpTip text="Your annual 'raise' in retirement. The base is set by your Retirement Budget — this rate grows it each year, like a cost-of-living adjustment. Independent of the Inflation rate." />
        </span>
        <div className="font-medium">
          <InlineEdit
            value={decToWhole(
              settings.postRetirementInflation ?? settings.annualInflation,
            )}
            onSave={(v) =>
              handleSettingPercentUpdate("postRetirementInflation", v)
            }
            formatDisplay={(v) => formatPercent(Number(v) / 100, 2)}
            parseInput={(v) => v.replace(/[^0-9.]/g, "")}
            type="number"
            className="text-sm"
            editable={!!settings}
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
                  ? `Starting withdrawal rate for ${meta.label}. Sets the initial withdrawal amount, which the strategy then adjusts yearly based on portfolio performance.`
                  : "Your withdrawal rate applied to the projected retirement balance. Determines the annual withdrawal amount, which grows by the Post-Retirement Raise rate each year."
            }
          />
        </span>
        <div className="font-medium">
          <InlineEdit
            value={decToWhole(settings.withdrawalRate)}
            onSave={(v) => handleSettingPercentUpdate("withdrawalRate", v)}
            formatDisplay={(v) => formatPercent(Number(v) / 100, 2)}
            parseInput={(v) => v.replace(/[^0-9.]/g, "")}
            type="number"
            className="text-sm"
            editable={!!settings}
          />
        </div>
      </div>
    </div>
  );
}
