"use client";

/**
 * This year's filing status on the Taxes page — the household setting
 * (lib/pure/filing-status.ts). Admins set it here; unset, it follows the
 * active Retirement Profile's status, else a W-4, and says which.
 */
import { HelpTip } from "@/components/ui/help-tip";
import { FocusTarget } from "@/components/ui/focus-target";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { SK_TAX_FILING_STATUS } from "@/lib/constants/settings-keys";
import { W4_FILING_STATUS_VALUES } from "@/lib/config/enum-values";
import {
  FILING_STATUS_LABELS,
  filingStatusLabel,
} from "@/lib/config/display-labels";
import type { FilingStatusSource } from "@/lib/pure/filing-status";

const SOURCE_TEXT: Record<Exclude<FilingStatusSource, "household">, string> = {
  retirementProfile: "the Retirement Profile's",
  w4: "the W-4's",
};

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
  const utils = trpc.useUtils();
  const upsert = trpc.settings.appSettings.upsert.useMutation();
  const [setting, setSetting] = usePersistedSetting<string | null>(
    SK_TAX_FILING_STATUS,
    null,
    {
      // Every figure figured from it reloads once the setting is saved.
      writeVia: async (value) => {
        await upsert.mutateAsync({ key: SK_TAX_FILING_STATUS, value });
        await Promise.all([
          utils.paycheck.invalidate(),
          utils.contribution.invalidate(),
          utils.projection.invalidate(),
        ]);
      },
    },
  );
  const followed =
    status && source && source !== "household"
      ? `${filingStatusLabel(status)} (${SOURCE_TEXT[source]})`
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
            disabled={upsert.isPending}
            onChange={(e) => setSetting(e.target.value || null)}
          >
            <option value="">{followed}</option>
            {W4_FILING_STATUS_VALUES.map((s) => (
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
