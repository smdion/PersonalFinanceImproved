/** Which individual account each contribution spec pays into. */
import type { ContributionSpec } from "../types/contribution-spec";
import type { IndividualAccountInput } from "../../accounts/account-balances.types";
import { TAX_TREATMENT_TO_TAX_TYPE } from "../../../config/tax-treatment-buckets";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
import { specKeyOf } from "./ledger";

/**
 * Build mapping from contribution spec keys to individual account keys.
 * Match on structured fields: category + ownerName + taxType (no fuzzy logic).
 */
export function buildSpecToAccountMapping(
  contributionSpecs: ContributionSpec[],
  indAccounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indParentCat: Map<string, string>,
): { specToAccount: Map<string, string>; accountsWithSpecs: Set<string> } {
  const specToAccount = new Map<string, string>();
  // The projection-only retirement brokerage has no contributions of its own.
  const accounts = indAccounts.filter((ia) => ia.origin !== "projected");

  refuseSharedSpecKeys(contributionSpecs);
  for (const spec of contributionSpecs) {
    const specTaxType = TAX_TREATMENT_TO_TAX_TYPE[spec.taxTreatment];
    const parentCatMatch = (ia: {
      name: string;
      category: string;
      taxType: string;
    }) => {
      const iaPCat = indParentCat.get(indKey(ia));
      if (iaPCat && spec.parentCategory) return iaPCat === spec.parentCategory;
      return true;
    };
    const exactOwner = (ia: { ownerPersonId?: number; ownerName?: string }) =>
      ia.ownerPersonId != null && spec.personId != null
        ? ia.ownerPersonId === spec.personId
        : ia.ownerName === spec.ownerName;
    const unowned = (ia: { ownerPersonId?: number; ownerName?: string }) =>
      ia.ownerPersonId === undefined && ia.ownerName === undefined;
    const ownerMatch = (ia: { ownerPersonId?: number; ownerName?: string }) =>
      exactOwner(ia) || unowned(ia);

    // The match rules, tried in rank order: the first that finds an account
    // in the spec's category wins.
    const matchRules: ((ia: IndividualAccountInput) => boolean)[] = [
      (ia) =>
        exactOwner(ia) && ia.taxType === specTaxType && parentCatMatch(ia),
      (ia) => unowned(ia) && ia.taxType === specTaxType && parentCatMatch(ia),
      (ia) => exactOwner(ia) && parentCatMatch(ia),
      (ia) => unowned(ia) && parentCatMatch(ia),
      ownerMatch,
    ];
    let match: IndividualAccountInput | undefined;
    for (const rule of matchRules) {
      match = accounts.find((ia) => ia.category === spec.category && rule(ia));
      if (match) break;
    }
    if (match) specToAccount.set(specKeyOf(spec), indKey(match));
  }

  return { specToAccount, accountsWithSpecs: new Set(specToAccount.values()) };
}

/** Each spec of a stretch is its own contribution account: two with one id
 *  would share one key, the second's amount overwriting the first's. */
function refuseSharedSpecKeys(specs: readonly ContributionSpec[]): void {
  const keys = new Set<string>();
  for (const spec of specs) {
    const key = specKeyOf(spec);
    if (keys.has(key))
      throw new Error(
        `Two contribution specs have one contribution account (${spec.contributionAccountId}): "${spec.name}" and another`,
      );
    keys.add(key);
  }
}
