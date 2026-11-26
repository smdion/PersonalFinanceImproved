/** A debit taken from account parts by balance: a Roth conversion's
 *  Traditional parts and its tax, and an owner's QCD from their IRAs. */
import type { IndividualAccountInput } from "../../accounts/account-balances.types";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
import { roundToCents } from "../../../utils/math";

/** Takes `amount` from `accounts` by balance (the first takes the cents the
 *  shares leave; cents they overshoot go back, in order, to parts that gave);
 *  none when they hold nothing. */
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
  const gave = accounts.map((ia) => {
    const key = keyOf(ia);
    const balance = Math.max(0, balances.get(key) ?? 0);
    const share = roundToCents(amount * (balance / total));
    const capped = Math.min(share, balance);
    balances.set(key, roundToCents(balance - capped));
    distributed += capped;
    return capped;
  });
  const remainder = roundToCents(amount - distributed);
  if (remainder > 0.005 && accounts.length > 0) {
    const key = keyOf(accounts[0]!);
    const balance = Math.max(0, balances.get(key) ?? 0);
    balances.set(key, roundToCents(Math.max(0, balance - remainder)));
  }
  let over = -remainder;
  accounts.forEach((ia, i) => {
    const back = roundToCents(Math.min(Math.max(0, over), gave[i]!));
    if (back <= 0) return;
    const key = keyOf(ia);
    balances.set(key, roundToCents(balances.get(key)! + back));
    over = roundToCents(over - back);
  });
}
