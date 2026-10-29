/**
 * Where reinvested RMD money goes in the projection (Retirement settings →
 * "Unspent required withdrawals"). Retirement money stays retirement money:
 * the household's chosen Retirement brokerage, else every Retirement
 * brokerage by balance (the engine's default) — never a Portfolio account.
 * A household with no Retirement brokerage gets a projection-only one,
 * whatever the RMD setting: it is also where contribution overflow lands.
 * Parent category comes from the performance account (canonical), falling
 * back to the snapshot row's copy for entries without one.
 */
import {
  isRetirementParent,
  tracksCostBasis,
} from "@/lib/config/account-types";

type RmdTargetPerfAccount = {
  id: number;
  isActive: boolean;
  accountType: string;
  parentCategory: string;
};

type RmdTargetEntry = {
  category: string;
  parentCategory?: string;
  performanceAccountIds?: number[];
};

type RmdExcessTargetResolution = {
  /** The chosen account's performance id, when it still qualifies. */
  targetPerformanceAccountId: number | null;
  /** Add a projection-only retirement brokerage (the household has no
   *  Retirement brokerage to hold overflow or reinvested RMD money). */
  addProjectedBrokerage: boolean;
  /** Shown with the projection when a choice couldn't be honoured. */
  warning: string | null;
};

export function resolveRmdExcessTarget(input: {
  targetPerformanceAccountId: number | null;
  reinvest: boolean;
  /** The engine's individual accounts (breakdown entries). */
  entries: readonly RmdTargetEntry[];
  perfAccounts: readonly RmdTargetPerfAccount[];
}): RmdExcessTargetResolution {
  const { targetPerformanceAccountId: id, reinvest, entries } = input;
  const perfById = new Map(input.perfAccounts.map((p) => [p.id, p]));
  const parentOf = (e: RmdTargetEntry) =>
    e.performanceAccountIds
      ?.map((pid) => perfById.get(pid)?.parentCategory)
      .find((p) => p != null) ??
    e.parentCategory ??
    "Retirement";
  const retirementBrokerages = entries.filter(
    (e) => tracksCostBasis(e.category) && isRetirementParent(parentOf(e)),
  );
  const addProjectedBrokerage =
    entries.length > 0 && retirementBrokerages.length === 0;
  if (id == null || !reinvest)
    return {
      targetPerformanceAccountId: null,
      addProjectedBrokerage,
      warning: null,
    };
  // The performance account is canonical for the parent category.
  const perf = perfById.get(id);
  const qualifies =
    perf != null &&
    perf.isActive &&
    tracksCostBasis(perf.accountType) &&
    isRetirementParent(perf.parentCategory) &&
    retirementBrokerages.some((e) => e.performanceAccountIds?.includes(id));
  return qualifies
    ? { targetPerformanceAccountId: id, addProjectedBrokerage, warning: null }
    : {
        targetPerformanceAccountId: null,
        addProjectedBrokerage,
        warning: addProjectedBrokerage
          ? "The account picked for unspent required withdrawals is no longer a Retirement brokerage — reinvesting them in a projected retirement brokerage instead."
          : "The account picked for unspent required withdrawals is no longer a Retirement brokerage — spreading them across your Retirement brokerages instead.",
      };
}
