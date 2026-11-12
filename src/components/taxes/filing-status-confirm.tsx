"use client";

/** The one-time filing status prompt (Taxes, Paycheck), for an admin while
 *  the status isn't the household's own. The Retirement Profile's can be
 *  confirmed; a W-4's (withholding only) is named, never preselected. */
import { Button } from "@/components/ui/button";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { useHouseholdIncomeSummary } from "@/lib/hooks/use-household-income-summary";
import { RETURN_FILING_STATUS_VALUES } from "@/lib/config/filing-status";
import { FILING_STATUS_IF_UNKNOWN } from "@/lib/pure/tax/filing-status";
import {
  FILING_STATUS_LABELS,
  FILING_STATUS_SOURCE_LABELS,
  filingStatusLabel,
} from "@/lib/config/display-labels";
import { useHouseholdFilingStatus } from "./use-household-filing-status";

export function FilingStatusConfirm() {
  const user = useUser();
  const { data } = useHouseholdIncomeSummary();
  const { save, saving } = useHouseholdFilingStatus();
  if (!data || !isAdmin(user) || data.filingStatusSource === "household")
    return null;
  const { filingStatus: status, filingStatusSource: source } = data;
  // A wizard-made W-4 says MFJ by default: one click mustn't store it.
  const confirmable = status && source === "retirementProfile";
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded bg-amber-50 px-3 py-2 text-sm text-amber-700">
      <span>
        {status && source
          ? `${confirmable ? "Confirm" : "Choose"} your filing status: this year's taxes use ${filingStatusLabel(status)}, taken from ${FILING_STATUS_SOURCE_LABELS[source]}${confirmable ? "" : ", which sets withholding, not the return"}.`
          : `Choose your filing status: none is saved, so the projection figures taxes as ${filingStatusLabel(FILING_STATUS_IF_UNKNOWN)}.`}{" "}
        You can change it on the Taxes page.
      </span>
      {confirmable ? (
        <Button size="sm" disabled={saving} onClick={() => save(status)}>
          Confirm
        </Button>
      ) : (
        <select
          aria-label="Filing status on this year's return"
          className="rounded border border-amber-300 bg-white px-1 py-0.5 text-sm"
          value=""
          disabled={saving}
          onChange={(e) => e.target.value && save(e.target.value)}
        >
          <option value="">Choose…</option>
          {RETURN_FILING_STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {FILING_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
