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
 * Resolve which physical account (from one category's breakdown) a
 * contribution spec maps to, via a 6-tier precedence cascade — tightest
 * match first, loosening one facet at a time:
 *
 *   1. owner name + tax type + account type + parent category
 *   2. no owner        + tax type + account type + parent category
 *   3. owner name + tax type +              parent category   (drop account type)
 *   4. no owner        + tax type +              parent category
 *   5. owner name +                           parent category  (drop tax type)
 *   6. owner name OR no owner                                  (loosest)
 *
 * "No owner" (`ownerName === undefined`) means a joint/household account,
 * which any of that household's contributions may land in. A parent-category
 * criterion of `undefined` on the spec, or `undefined` on the account row,
 * is treated as "matches anything" (see `parentCatMatches`).
 *
 * Split out of `buildProfileContribData`'s inline `.map()` so the
 * cascade has a name, a doc, and isolated test coverage in a file that
 * was the site of an employer-match grouping bug; `tests/server/
 * match-account-for-contribution.test.ts` pins each tier.
 */
export function matchAccountForContribution(
  catAccounts: BreakdownAccount[],
  criteria: {
    // null and undefined behave identically here — both mean "no such
    // constraint" for parentCat, and neither will `===` a real taxType /
    // owner string (matching the pre-extraction inline behavior).
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
