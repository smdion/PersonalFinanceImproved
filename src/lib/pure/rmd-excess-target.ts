/**
 * Where reinvested RMD money goes in the projection (Retirement settings →
 * "Unspent required withdrawals"). Retirement money stays retirement money:
 * the household's chosen Retirement brokerage, else every Retirement
 * brokerage by balance (the engine's default), and with none a
 * projection-only retirement brokerage — never a Portfolio account.
 */
import {
  isRetirementParent,
  tracksCostBasis,
} from "@/lib/config/account-types";

export type RmdTargetPerfAccount = {
  id: number;
  isActive: boolean;
  accountType: string;
  parentCategory: string;
};

export type RmdTargetEntry = {
  category: string;
  parentCategory?: string;
  performanceAccountIds?: number[];
};

export type RmdExcessTargetResolution = {
  /** The chosen account's performance id, when it still qualifies. */
  targetPerformanceAccountId: number | null;
  /** Add a projection-only retirement brokerage (reinvesting, no
   *  Retirement brokerage to reinvest into). */
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
  const retirementBrokerages = entries.filter(
    (e) =>
      tracksCostBasis(e.category) &&
      isRetirementParent(e.parentCategory ?? "Retirement"),
  );
  const addProjectedBrokerage =
    reinvest && entries.length > 0 && retirementBrokerages.length === 0;
  if (id == null || !reinvest)
    return {
      targetPerformanceAccountId: null,
      addProjectedBrokerage,
      warning: null,
    };
  // The performance account is canonical for the parent category.
  const perf = input.perfAccounts.find((p) => p.id === id);
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
