import { toNumber } from "@/lib/utils/numbers";

/** A debt's balance now: the pulled one while a budget account feeds it,
 *  else the one entered — with the day it's from. */
export function debtBalance(d: {
  balance: string;
  balanceAsOf: string;
  apiBalance: string | null;
  apiBalanceDate: string | null;
}): { balance: number; asOf: string; pulled: boolean } {
  return d.apiBalance != null
    ? {
        balance: toNumber(d.apiBalance),
        asOf: d.apiBalanceDate ?? d.balanceAsOf,
        pulled: true,
      }
    : { balance: toNumber(d.balance), asOf: d.balanceAsOf, pulled: false };
}

/** Is a debt still owed on `asOfDate` (YYYY-MM-DD)? Paid off by its date,
 *  or — fed by a budget account — once the pulled balance reaches zero. */
export function isOpenDebt(
  d: { paidOffDate: string | null; apiBalance?: string | null },
  asOfDate: string,
): boolean {
  if (d.apiBalance != null && toNumber(d.apiBalance) <= 0) return false;
  return d.paidOffDate == null || d.paidOffDate > asOfDate;
}
