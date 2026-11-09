/** The account caps a household filled in on a "Changes by year" row. */
import { getAllCategories } from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";

/** Only the entered caps: a blank account is uncapped (the engine's
 *  omitted account), never a $0 cap. Undefined when none is entered. */
export function enteredCaps(
  fields: Record<AccountCategory, string>,
): Partial<Record<AccountCategory, number>> | undefined {
  const caps: Partial<Record<AccountCategory, number>> = {};
  for (const category of getAllCategories())
    if (fields[category] !== "") caps[category] = parseFloat(fields[category]);
  return Object.keys(caps).length > 0 ? caps : undefined;
}
