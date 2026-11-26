/** A debit taken from account parts by balance: a Roth conversion's
 *  Traditional parts and its tax, and an owner's QCD from their IRAs. */
import type { IndividualAccountInput } from "../../accounts/account-balances.types";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
import { roundToCents } from "../../../utils/math";

/** Takes `amount` from `accounts` by balance (the first absorbs the rounding
 *  remainder); none when they hold nothing. */
export function debitByBalance(
  { balances, keyOf }: { balances: Map<string, number>; keyOf: IndKeyFn },
  accounts: readonly IndividualAccountInput[],
  amount: number,
): void {
  const total = accounts.reduce(
    (s, ia) => s + Math.max(0, balances.get(keyOf(ia)) ?? 0),
    0,
  );
  if (total <= 0) return;
  let distributed = 0;
  for (const ia of accounts) {
    const key = keyOf(ia);
    const balance = Math.max(0, balances.get(key) ?? 0);
    const share = roundToCents(amount * (balance / total));
    const capped = Math.min(share, balance);
    balances.set(key, roundToCents(balance - capped));
    distributed += capped;
  }
  const remainder = roundToCents(amount - distributed);
  if (remainder > 0.005 && accounts.length > 0) {
    const key = keyOf(accounts[0]!);
    const balance = Math.max(0, balances.get(key) ?? 0);
    balances.set(key, roundToCents(Math.max(0, balance - remainder)));
  }
}
