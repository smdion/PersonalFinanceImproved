"use client";

/** The household's return filing status setting (tax_filing_status): its
 *  saved value (null: unset), and a save that reloads every figure read from
 *  it. The Taxes page's Filing status row and the confirm prompt write it. */
import { trpc } from "@/lib/trpc";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { SK_TAX_FILING_STATUS } from "@/lib/constants/settings-keys";

export function useHouseholdFilingStatus() {
  const utils = trpc.useUtils();
  const upsert = trpc.settings.appSettings.upsert.useMutation();
  const [setting, save] = usePersistedSetting<string | null>(
    SK_TAX_FILING_STATUS,
    null,
    {
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
  return { setting, save, saving: upsert.isPending };
}
