import { isPreTaxType, isRothIncomeLimited } from "@/lib/config/account-types";

/** How far back a backdoor deposit waiting to be converted is looked for:
 *  past a monthly contribute-then-convert cycle, with room for a late one. */
export const PENDING_CONVERSION_WINDOW_DAYS = 45;

/**
 * A traditional IRA deposit awaiting Roth conversion: latest balance less the window's lowest,
 * read from balances (transactions arrive days later). After-tax only on a backdoor route.
 */
export function pendingConversion(
  balances: readonly { day: string; balance: number }[],
  today: string,
  windowStart: string,
): number {
  const recent = balances.filter((b) => b.day >= windowStart && b.day <= today);
  if (recent.length < 2) return 0;
  const latest = recent.at(-1)!.balance;
  const lowest = Math.min(...recent.map((b) => b.balance));
  return Math.max(0, Math.round((latest - lowest) * 100) / 100);
}

/**
 * Pre-tax money in each person's IRA-type accounts (not 401(k)/403(b)); a backdoor conversion
 * is taxed pro-rata over it as of Dec 31, for which the current balance stands in.
 */
export function preTaxIraByPerson(
  accounts: readonly {
    accountType: string;
    taxType: string;
    ownerPersonId: number | null;
    amount: number;
  }[],
): {
  byPerson: Map<number, number>;
  /** Pre-tax IRA money with no owner recorded — can't be placed, so named as missing. */
  unowned: number;
} {
  const byPerson = new Map<number, number>();
  let unowned = 0;
  for (const a of accounts) {
    if (!isRothIncomeLimited(a.accountType) || !isPreTaxType(a.taxType))
      continue;
    if (a.amount <= 0) continue;
    if (a.ownerPersonId === null) {
      unowned += a.amount;
      continue;
    }
    byPerson.set(
      a.ownerPersonId,
      (byPerson.get(a.ownerPersonId) ?? 0) + a.amount,
    );
  }
  return { byPerson, unowned };
}
