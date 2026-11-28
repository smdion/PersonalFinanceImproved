/** What a year states about its account parts: the rows a page lists. */
import type {
  IndividualAccountInput,
  IndividualAccountYearBalance,
} from "../../accounts/account-balances.types";
import { isHeldPart } from "@/lib/pure/accounts/account-part";

/** A held part shows; a synthetic one never; any other once it holds money. */
function isShown(
  part: IndividualAccountInput,
  row: IndividualAccountYearBalance,
): boolean {
  if (isHeldPart(part)) return true;
  if (part.origin === "synthetic") return false;
  const drawn = row.draw !== undefined && row.draw.withdrawal !== 0;
  return row.balance !== 0 || row.contribution !== 0 || drawn;
}

/** The year's view from each part's record (`records[i]` is `parts[i]`'s).
 *  A run with no entered account lists no rows. */
export function yearAccountView(
  parts: IndividualAccountInput[],
  records: IndividualAccountYearBalance[],
  holdsRealAccount: boolean,
) {
  return {
    individualAccountBalances: holdsRealAccount
      ? records.filter((row, i) => isShown(parts[i]!, row))
      : [],
  };
}
