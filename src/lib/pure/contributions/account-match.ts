/** Which physical account a contribution spec lands in. */

/** One physical account row as it appears in `accountBreakdownByCategory`. */
export type BreakdownAccount = {
  name: string;
  taxType: string;
  accountType?: string;
  ownerName?: string;
  parentCategory?: string;
};

/**
 * The account a contribution maps to, tightest match first: owner/joint + tax + type + parent;
 * then owner/joint + tax + parent; owner + parent; any. No owner = joint, open to any member;
 * an `undefined` parent category matches anything.
 */
export function matchAccountForContribution(
  catAccounts: BreakdownAccount[],
  criteria: {
    // null and undefined behave identically: "no constraint" for parentCat,
    // and neither `===` a real taxType / owner string.
    contribOwner: string | null | undefined;
    matchTaxType: string | null | undefined;
    accountType: string | null | undefined;
    contribParentCat: string | null | undefined;
  },
): BreakdownAccount | undefined {
  const { contribOwner, matchTaxType, accountType, contribParentCat } =
    criteria;
  const exactOwner = (a: BreakdownAccount) => a.ownerName === contribOwner;
  const ownerMatch = (a: BreakdownAccount) =>
    a.ownerName === contribOwner || a.ownerName === undefined;
  const parentCatMatches = (a: BreakdownAccount) => {
    if (a.parentCategory && contribParentCat)
      return a.parentCategory === contribParentCat;
    return true;
  };

  return (
    catAccounts.find(
      (a) =>
        exactOwner(a) &&
        a.taxType === matchTaxType &&
        a.accountType === accountType &&
        parentCatMatches(a),
    ) ??
    catAccounts.find(
      (a) =>
        a.ownerName === undefined &&
        a.taxType === matchTaxType &&
        a.accountType === accountType &&
        parentCatMatches(a),
    ) ??
    catAccounts.find(
      (a) => exactOwner(a) && a.taxType === matchTaxType && parentCatMatches(a),
    ) ??
    catAccounts.find(
      (a) =>
        a.ownerName === undefined &&
        a.taxType === matchTaxType &&
        parentCatMatches(a),
    ) ??
    catAccounts.find((a) => exactOwner(a) && parentCatMatches(a)) ??
    catAccounts.find((a) => ownerMatch(a))
  );
}
