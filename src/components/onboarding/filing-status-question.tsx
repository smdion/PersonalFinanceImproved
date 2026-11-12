"use client";

/**
 * The first-run wizard's filing status question: saved as the household's
 * return status as soon as it's picked, so no W-4 stands in for it. Left
 * unanswered, the Taxes and Paycheck pages ask later.
 */
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { SK_TAX_FILING_STATUS } from "@/lib/constants/settings-keys";
import {
  FILING_STATUS_ORDER,
  parseReturnFilingStatus,
} from "@/lib/config/filing-status";
import { filingStatusLabel } from "@/lib/config/display-labels";

export function FilingStatusQuestion() {
  const [status, setStatus] = usePersistedSetting<string | null>(
    SK_TAX_FILING_STATUS,
    null,
  );
  return (
    <label className="flex flex-col gap-1">
      <span className="text-primary font-medium">
        How does your household file its tax return?
      </span>
      <span className="text-muted text-sm">
        It sets this year&apos;s tax brackets and the projection&apos;s. Each
        job&apos;s W-4 starts from it. You can change it on the Taxes page.
      </span>
      <select
        aria-label="Filing status on your tax return"
        value={parseReturnFilingStatus(status) ?? ""}
        onChange={(e) => setStatus(parseReturnFilingStatus(e.target.value))}
        className="bg-surface-primary text-primary border-default w-full rounded-lg border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none sm:w-72"
      >
        <option value="">Choose…</option>
        {FILING_STATUS_ORDER.map((s) => (
          <option key={s} value={s}>
            {filingStatusLabel(s)}
          </option>
        ))}
      </select>
    </label>
  );
}
