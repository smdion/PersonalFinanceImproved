"use client";

/**
 * Uninvested cash per account — judged once by lib/pure/cash-positions.ts
 * from the holdings overview (portfolio permission), the current glide
 * path's cash target, the HSA buffer defaults and setting, and the Roth
 * verdict (a traditional IRA mid-backdoor isn't drag). Fetching only.
 */
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useHouseholdIncomeSummary } from "@/lib/hooks/use-household-income-summary";
import { useRothIra } from "@/lib/hooks/use-roth-ira";
import { SK_HSA_CASH_BUFFER } from "@/lib/constants/settings-keys";
import {
  judgeCashDrag,
  judgeHsaCash,
  type CashFinding,
} from "@/lib/pure/cash-positions";

export function useCashFindings(): {
  isLoading: boolean;
  drag: CashFinding[];
  hsa: (CashFinding & { buffer: number })[];
} {
  const user = useUser();
  const available = hasPermission(user, "portfolio");
  const overview = trpc.investments.getHoldingsOverview.useQuery(undefined, {
    enabled: available,
  });
  const summary = useHouseholdIncomeSummary();
  const roth = useRothIra();
  const [bufferSetting] = usePersistedSetting<number | null>(
    SK_HSA_CASH_BUFFER,
    null,
  );
  const o = overview.data;
  if (!available || !o)
    return {
      isLoading: available && overview.isLoading,
      drag: [],
      hsa: [],
    };

  const cashClassId =
    o.allocation.categories.find((c) => c.bucket === "cash")?.assetClassId ??
    null;
  const cashRow = o.allocation.rows.find((r) => r.assetClassId === cashClassId);
  const accounts = o.accounts.map((a) => ({
    simplefinAccountId: a.simplefinAccountId,
    label: a.label,
    accountType: a.accountType,
    taxType: a.taxType,
    ownerPersonId: a.ownerPersonId,
    holdings: a.holdings,
    uninvestedCash: a.uninvestedCash,
  }));
  return {
    isLoading: summary.isLoading || roth.isLoading,
    drag: judgeCashDrag({
      accounts,
      cashClass:
        o.targetSource === "current" && cashRow && cashRow.targetPct !== null
          ? { targetShare: cashRow.targetPct, buckets: cashRow.buckets }
          : null,
      excludeTraditionalIra: roth.view?.judgement?.verdict === "backdoor",
    }),
    hsa: judgeHsaCash({
      accounts,
      bufferSetting,
      defaultBuffers: summary.data?.hsaBuffers ?? [],
    }),
  };
}
