"use client";

/**
 * This year's filing status on the Taxes page — the household setting
 * (lib/pure/tax/filing-status.ts). Admins set it here; unset, it follows the
 * active Retirement Profile's status, else a W-4, and says which.
 */
import { HelpTip } from "@/components/ui/help-tip";
import { FocusTarget } from "@/components/ui/focus-target";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { useHouseholdFilingStatus } from "./use-household-filing-status";
import { RETURN_FILING_STATUS_VALUES } from "@/lib/config/filing-status";
import {
  FILING_STATUS_LABELS,
  FILING_STATUS_SOURCE_LABELS,
  filingStatusLabel,
} from "@/lib/config/display-labels";
import type { FilingStatusSource } from "@/lib/pure/tax/filing-status";

const HELP =
  "The filing status on this year's tax return. It sets the brackets and standard deduction here, the Roth IRA income limit and the IRS contribution limits. Retirement years use the Retirement Profile's own status. A W-4 status only sets withholding. Ledgr doesn't model married filing separately.";

export function FilingStatusRow({
  status,
  source,
}: {
  status: string | null;
  source: FilingStatusSource | null;
}) {
  const user = useUser();
  const { setting, save, saving } = useHouseholdFilingStatus();
  const followed =
    status && source && source !== "household"
      ? `${filingStatusLabel(status)} (${FILING_STATUS_SOURCE_LABELS[source]}'s)`
      : "Not set";
  return (
    <FocusTarget topic="filingStatus">
      <div className="flex items-center justify-between">
        <span className="text-muted inline-flex items-center">
          Filing status
          <HelpTip text={HELP} />
        </span>
        {isAdmin(user) ? (
          <select
            aria-label="Filing status on this year's return"
            className="text-primary hover:border-border focus:border-accent rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-sm focus:outline-none"
            value={setting ?? ""}
            disabled={saving}
            onChange={(e) => save(e.target.value || null)}
          >
            <option value="">{followed}</option>
            {RETURN_FILING_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {FILING_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-primary">
            {status ? filingStatusLabel(status) : "Not set"}
          </span>
        )}
      </div>
    </FocusTarget>
  );
}
