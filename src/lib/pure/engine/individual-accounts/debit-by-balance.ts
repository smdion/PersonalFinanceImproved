/** A debit taken from account parts by balance: a Roth conversion's
 *  Traditional parts and its tax, and an owner's QCD from their IRAs. */
import type { IndividualAccountInput } from "../../accounts/account-balances.types";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
import { roundToCents } from "../../../utils/math";

/** Takes `amount` from `accounts` by balance (the rounding residual in order:
 *  cents short from the parts' balance left, cents over back to parts that
 *  gave); none when they hold nothing. */
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
  let remaining = roundToCents(amount - distributed);
  accounts.forEach((ia, i) => {
    const key = keyOf(ia);
    const balance = balances.get(key)!;
    const take = roundToCents(
      remaining > 0
        ? Math.min(remaining, balance)
        : Math.max(remaining, -gave[i]!),
    );
    if (take === 0) return;
    balances.set(key, roundToCents(balance - take));
    remaining = roundToCents(remaining - take);
  });
}
