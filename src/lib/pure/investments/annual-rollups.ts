/** Performance rollups' pure parts: which category an account row rolls up
 *  into, and a category's sums as annual_performance columns and back. */

import {
  accountTypeToPerformanceCategory,
  type PerfCategory,
} from "@/lib/config/display-labels";
import { type Rollup, computeReturn } from "./returns";
import { toNumber } from "@/lib/utils/numbers";

/** The performance_accounts columns these helpers read; a schema row fits
 *  (the account type is what the category lookup takes). */
type PerfAccountRef = {
  id: number;
  accountType: Parameters<typeof accountTypeToPerformanceCategory>[0];
};

/** The annual_performance columns read back as a rollup; a schema row fits. */
type AnnualRollupColumns = {
  beginningBalance: string;
  totalContributions: string;
  yearlyGainLoss: string;
  endingBalance: string;
  employerContributions: string;
  distributions: string;
  fees: string;
  rollovers: string;
};

export function buildPerfAcctLookups<P extends PerfAccountRef>(
  perfAccounts: P[],
) {
  return new Map(perfAccounts.map((pa) => [pa.id, pa]));
}

export function resolveMaster<P extends PerfAccountRef>(
  a: {
    id: number;
    performanceAccountId: number | null;
    institution: string;
    accountLabel: string;
  },
  byId: Map<number, P>,
): P {
  if (a.performanceAccountId == null) {
    throw new Error(
      `account_performance.id=${a.id} (${a.institution}:${a.accountLabel}) has null performanceAccountId`,
    );
  }
  const master = byId.get(a.performanceAccountId);
  if (!master) {
    throw new Error(
      `account_performance.id=${a.id} references missing performance_account.id=${a.performanceAccountId}`,
    );
  }
  return master;
}

/** The rollup category an account row belongs to — from its account type,
 *  never its parentCategory (Retirement is a read-time rollup, not a row). */
export function getEffectiveCategory(
  a: {
    id: number;
    performanceAccountId: number | null;
    institution: string;
    accountLabel: string;
  },
  byId: Map<number, PerfAccountRef>,
): PerfCategory {
  return accountTypeToPerformanceCategory(
    resolveMaster(a, byId).accountType,
  ) as PerfCategory;
}

export const money = (n: number) => n.toFixed(2);

export const pct = (n: number | null) => (n == null ? null : n.toFixed(6));

export function rollupColumns(r: Rollup) {
  return {
    beginningBalance: money(r.beginBal),
    totalContributions: money(r.contribs),
    yearlyGainLoss: money(r.gainLoss),
    endingBalance: money(r.endBal),
    employerContributions: money(r.employer),
    distributions: money(r.distributions),
    fees: money(r.fees),
    rollovers: money(r.rollovers),
    annualReturnPct: pct(
      computeReturn(
        r.beginBal,
        r.contribs,
        r.gainLoss,
        r.distributions,
        r.fees,
        r.rollovers,
      ),
    ),
  };
}

export function rowRollup(row: AnnualRollupColumns): Rollup {
  return {
    beginBal: toNumber(row.beginningBalance),
    contribs: toNumber(row.totalContributions),
    gainLoss: toNumber(row.yearlyGainLoss),
    endBal: toNumber(row.endingBalance),
    employer: toNumber(row.employerContributions),
    distributions: toNumber(row.distributions),
    fees: toNumber(row.fees),
    rollovers: toNumber(row.rollovers),
  };
}
