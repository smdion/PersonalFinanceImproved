/**
 * A lump sum's account parts: the one place a lump sum's account name is
 * matched to its part. The year logic and Simple mode both read it.
 */
import type { IndividualAccountInput } from "../accounts/account-balances.types";
import type { LumpSum } from "./types/year-overrides";
import { isRetirementMoney } from "../../config/account-types";
import { taxTypeOnSide } from "../../config/tax-treatment-buckets";
import { portfolioFirst, retirementFirst } from "./individual-accounts/ledger";

/**
 * A lump sum's parts, of its category and tax type, ordered by whose money it is (its parent; unset:
 * Retirement first; Portfolio money skips the projection-only part while another exists): the
 * named one, else (a name none carries) the first parent's, shared by balance; unnamed, the first.
 */
export function resolveLumpSumTargets(
  ls: LumpSum,
  accounts: readonly IndividualAccountInput[],
): IndividualAccountInput[] {
  const taxType = taxTypeOnSide(ls.targetAccount, ls.taxType);
  const parts = accounts.filter(
    (ia) => ia.category === ls.targetAccount && ia.taxType === taxType,
  );
  const parentOf = (ia: IndividualAccountInput) => ia.parentCategory;
  const real = parts.filter((ia) => ia.origin !== "projected");
  const ordered = isRetirementMoney(ls.targetParentCategory)
    ? retirementFirst(parts, parentOf)
    : real.length > 0
      ? portfolioFirst(real, parentOf)
      : parts;
  const first = ordered[0];
  if (!ls.targetAccountName || !first) return ordered.slice(0, 1);
  const named = parts.filter((ia) => ia.name === ls.targetAccountName);
  const owned = named.find((ia) => ia.ownerName === ls.targetOwnerName);
  if (ls.targetOwnerName && owned) return [owned];
  if (named.length > 0) return [named[0]!];
  return ordered.filter(
    (ia) =>
      isRetirementMoney(ia.parentCategory) ===
      isRetirementMoney(first.parentCategory),
  );
}
