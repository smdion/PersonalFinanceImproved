/** The account caps a household filled in on a "Changes by year" row. */
import { getAllCategories } from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";

/** Only the entered caps: a blank account, or text that isn't a number, is
 *  uncapped (the engine's omitted account), never a $0 or NaN cap.
 *  Undefined when none is entered. */
export function enteredCaps(
  fields: Record<AccountCategory, string>,
): Partial<Record<AccountCategory, number>> | undefined {
  const caps: Partial<Record<AccountCategory, number>> = {};
  for (const category of getAllCategories()) {
    const cap = parseFloat(fields[category]);
    if (Number.isFinite(cap)) caps[category] = cap;
  }
  return Object.keys(caps).length > 0 ? caps : undefined;
}
