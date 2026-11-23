/** One spread of money over account parts: by balance; when all are $0, by
 *  each part's account's other parts (each person's); when those are $0 too,
 *  equally. */
import { roundToCents, safeDivide, sumBy } from "../../../utils/math";
import type { IndKeyFn } from "../../accounts/account-part";
import type { IndividualAccountInput } from "../../accounts/account-balances.types";
import { credit } from "./ledger";

/** The run's parts and their balances. */
type Ledger = Record<"indAccounts", readonly IndividualAccountInput[]> &
  Record<"indKey", IndKeyFn> &
  Record<"indBalance", Map<string, number>>;

/** Each part's weight: its balance; when all are $0, its account's other
 *  parts' (each person's); when those are $0 too, equal. */
function weightsOf(ledger: Ledger, parts: IndividualAccountInput[]) {
  const balance = (ia: IndividualAccountInput) =>
    Math.max(0, ledger.indBalance.get(ledger.indKey(ia)) ?? 0);
  const own = parts.map(balance);
  if (sumBy(own, (w) => w) > 0) return own;
  const otherParts = parts.map((part) =>
    sumBy(
      ledger.indAccounts.filter(
        (ia) =>
          ia.taxType !== part.taxType &&
          ledger.indKey({ ...ia, taxType: part.taxType }) ===
            ledger.indKey(part),
      ),
      balance,
    ),
  );
  if (sumBy(otherParts, (w) => w) > 0) return otherParts;
  return parts.map(() => 1);
}

/** Each part's share of money spread over `parts` (`weightsOf`). */
export function partShares(
  ledger: Ledger,
  parts: IndividualAccountInput[],
): number[] {
  const weights = weightsOf(ledger, parts);
  const total = sumBy(weights, (w) => w);
  return weights.map((w) => safeDivide(w, total, 0));
}

/** `amount` over `parts` by their shares (`partShares`), the last part the
 *  cents left; each share credited to the part in every map of `into`. */
export function creditByWeight(
  ledger: Ledger,
  parts: IndividualAccountInput[],
  amount: number,
  into: Map<string, number>[],
): void {
  const shares = partShares(ledger, parts);
  let left = amount;
  parts.forEach((ia, i) => {
    const share =
      i === parts.length - 1 ? left : roundToCents(amount * shares[i]!);
    left = roundToCents(left - share);
    credit(ledger.indKey(ia), share, into);
  });
}
