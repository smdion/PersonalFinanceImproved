/** Which side of its category a part's money sits in: the rule the opening
 *  totals book by and eligibility splits a category's non-Retirement money by. */
import {
  getAccountTypeConfig,
  isTaxFreeBucket,
  type AccountCategory,
} from "../../config/account-types";

/** A category's side: its Traditional or Roth side, else its one balance. */
export type CategorySide = "traditional" | "roth" | "balance";

/** A Roth-capable category's Roth or Traditional side by the part's tax
 *  type, else its one balance. */
export function categorySide(
  category: AccountCategory,
  taxType: string,
): CategorySide {
  const { balanceStructure } = getAccountTypeConfig(category);
  if (balanceStructure !== "roth_traditional") return "balance";
  return isTaxFreeBucket(taxType) ? "roth" : "traditional";
}
