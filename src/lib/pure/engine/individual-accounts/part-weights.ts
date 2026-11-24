/** One spread of money over account parts: by balance; when all are $0, by
 *  each part's account's other parts (each person's); when those are $0 too,
 *  equally; a group under $1 blends toward the next rule (`inflowShares`). */
import { roundToCents, sumBy } from "../../../utils/math";
import type { IndKeyFn } from "../../accounts/account-part";
import type { IndividualAccountInput } from "../../accounts/account-balances.types";
import { credit } from "./ledger";

/** The run's parts and their balances. */
type Ledger = Record<"indAccounts", readonly IndividualAccountInput[]> &
  Record<"indKey", IndKeyFn> &
  Record<"indBalance", Map<string, number>>;

/** From this group total ($1) the balances alone set an inflow's split. */
const BALANCE_SPLIT_FLOOR = 1;

/**
 * Each member's share of money flowing into a group of total T (`weights`, its balances): from
 * $1 by balance; at $0 the `fallback()` shares; between, T/$1 of the first and the rest of the
 * second, so 1¢ beside $0 parts takes 1% beyond its fallback share, not all (E0 PW1).
 */
export function inflowShares(
  weights: readonly number[],
  fallback: () => readonly number[],
): number[] {
  const total = sumBy(weights, (w) => w);
  if (total >= BALANCE_SPLIT_FLOOR) return weights.map((w) => w / total);
  const fallbackShares = fallback();
  if (total <= 0) return [...fallbackShares];
  const byBalance = total / BALANCE_SPLIT_FLOOR;
  return weights.map(
    (w, i) => byBalance * (w / total) + (1 - byBalance) * fallbackShares[i]!,
  );
}

/** Each of `n` members' share when split equally. */
export const equalShares = (n: number) => () =>
  Array.from({ length: n }, () => 1 / n);

/** Each part's share of money spread over `parts`: by balance; else by its
 *  account's other parts (each person's); else equal (`inflowShares`). */
export function partShares(
  ledger: Ledger,
  parts: IndividualAccountInput[],
): number[] {
  const balance = (ia: IndividualAccountInput) =>
    Math.max(0, ledger.indBalance.get(ledger.indKey(ia)) ?? 0);
  const otherParts = () =>
    parts.map((part) =>
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
  return inflowShares(parts.map(balance), () =>
    inflowShares(otherParts(), equalShares(parts.length)),
  );
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
