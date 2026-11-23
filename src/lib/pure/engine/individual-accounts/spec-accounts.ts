/** Which individual account each contribution spec pays into. */
import type { ContributionSpec } from "../types/contribution-spec";
import type { IndividualAccountInput } from "../../accounts/account-balances.types";
import { TAX_TREATMENT_TO_TAX_TYPE } from "../../../config/tax-treatment-buckets";
import {
  accountIdKeyOf,
  type IndKeyFn,
} from "@/lib/pure/accounts/account-part";
import { sumBy } from "../../../utils/math";
import { credit, specKeyOf } from "./ledger";
import { creditByWeight } from "./part-weights";

/** The account parts a spec pays, by key: one, or (a joint spec on an
 *  account held in owner parts) each owner's part of its tax type. */
export type SpecParts = readonly string[];

/** The identity a spec's account gives its parts: its performance account,
 *  else its own contribution account, else (Simple) the synthetic pot. */
function specAccountIdentity(
  spec: ContributionSpec,
): Pick<
  IndividualAccountInput,
  "performanceAccountId" | "contributionAccountId" | "origin"
> {
  const { account } = spec;
  if (account.kind === "performance")
    return { performanceAccountId: account.performanceAccountId };
  if (account.kind === "unlinked")
    return { contributionAccountId: spec.contributionAccountId };
  return { origin: "synthetic" };
}

/** The parts of `parts` a spec pays: its account's part of its tax type for
 *  its person; on an account held whole, the joint part; joint over owner
 *  parts, each owner's. With none, its own $0 part (`origin: "spec"`). */
export function specParts(
  spec: ContributionSpec,
  parts: readonly IndividualAccountInput[],
): IndividualAccountInput[] {
  const taxType = TAX_TREATMENT_TO_TAX_TYPE[spec.taxTreatment];
  const own = {
    ...specAccountIdentity(spec),
    category: spec.category,
    taxType,
    parentCategory: spec.parentCategory,
  };
  const accountOf = (part: Parameters<typeof accountIdKeyOf>[0]) =>
    accountIdKeyOf({ ...part, taxType: "", ownerPersonId: null });
  const ofAccount = parts.filter((ia) => accountOf(ia) === accountOf(own));
  const heldWhole =
    ofAccount.length > 0 && ofAccount.every((ia) => ia.ownerPersonId == null);
  const joint = spec.ownership === "joint" || spec.personId == null;
  const ownerParts = ofAccount.filter(
    (ia) => ia.ownerPersonId != null && ia.taxType === taxType,
  );
  if (joint && !heldWhole && ownerParts.length > 0) return ownerParts;
  const owner =
    joint || heldWhole || own.origin ? undefined : (spec.personId ?? undefined);
  const part = { ...own, ...(owner != null ? { ownerPersonId: owner } : {}) };
  const found = parts.find((ia) => accountIdKeyOf(ia) === accountIdKeyOf(part));
  return [
    found ?? { ...part, name: spec.name, startingBalance: 0, origin: "spec" },
  ];
}

/**
 * Each spec's parts by spec key: the parts of its own account (`specParts`),
 * which the opening state declares. A spec whose part isn't declared throws.
 */
export function buildSpecToAccountMapping(
  contributionSpecs: ContributionSpec[],
  indAccounts: IndividualAccountInput[],
  indKey: IndKeyFn,
): { specToAccount: Map<string, SpecParts>; accountsWithSpecs: Set<string> } {
  const specToAccount = new Map<string, SpecParts>();
  refuseSharedSpecKeys(contributionSpecs);
  for (const spec of contributionSpecs) {
    const parts = specParts(spec, indAccounts);
    if (parts.some((ia) => !indAccounts.includes(ia)))
      throw new Error(
        `Contribution "${spec.name}" (${spec.contributionAccountId}) pays a part the opening state didn't declare`,
      );
    specToAccount.set(specKeyOf(spec), parts.map(indKey));
  }

  return {
    specToAccount,
    accountsWithSpecs: new Set([...specToAccount.values()].flat()),
  };
}

/** A spec's money: on its one part, or over several by weight
 *  (`creditByWeight`), credited in every map of `into`. */
export function creditSpecParts(
  ledger: Parameters<typeof creditByWeight>[0],
  parts: SpecParts,
  amount: number,
  into: Map<string, number>[],
): void {
  if (parts.length === 1) {
    credit(parts[0]!, amount, into);
    return;
  }
  const byKey = new Map(
    ledger.indAccounts.map((ia) => [ledger.indKey(ia), ia]),
  );
  creditByWeight(
    ledger,
    parts.map((key) => byKey.get(key)!),
    amount,
    into,
  );
}

/** The amount the maps hold for a spec's parts, together. */
export function onSpecParts(map: Map<string, number>, parts: SpecParts) {
  return sumBy(parts, (key) => map.get(key) ?? 0);
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
