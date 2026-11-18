import type {
  AccountKey,
  IndividualAccountInput,
} from "./account-balances.types";

/** One account part as the engine keys it: the account's name, category,
 *  tax type and owner (absent for a joint account). */
type AccountPart = {
  name: string;
  category: string;
  taxType: string;
  ownerPersonId?: number;
};

/** What names a part's account by id and category: its performance account,
 *  else its snapshot row (each has one parent); the engine's own parts by
 *  origin, category and parent. */
type PartIdentity = Pick<
  IndividualAccountInput,
  | "category"
  | "taxType"
  | "performanceAccountId"
  | "portfolioAccountId"
  | "origin"
  | "parentCategory"
> & { ownerPersonId?: number | null };

/** The one key shape: (identity, tax type, owner or `joint`). */
function partKey(
  identity: string,
  part: Pick<AccountPart, "taxType"> & { ownerPersonId?: number | null },
): AccountKey {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the brand's one builder
  return `${identity}::${part.taxType}::${part.ownerPersonId ?? "joint"}` as AccountKey;
}

/** The key of one account part, by its name and category. Two people's
 *  same-named accounts stay apart; a joint account keys on `"joint"`. */
export function accountKeyOf(
  part: Omit<AccountPart, "ownerPersonId"> & { ownerPersonId?: number | null },
): AccountKey {
  return partKey(`${part.name}::${part.category}`, part);
}

/** The key of one account part by its account's id (`acct:`, `row:`,
 *  `projected:` or `synthetic:`). A row id is one snapshot's: the key holds for
 *  one run, never stored or compared across snapshots or restores. */
export function accountIdKeyOf(part: PartIdentity): AccountKey {
  return partKey(identityOf(part), part);
}

function identityOf(part: PartIdentity): string {
  if (part.performanceAccountId != null)
    return `acct:${part.performanceAccountId}:${part.category}`;
  if (part.portfolioAccountId != null)
    return `row:${part.portfolioAccountId}:${part.category}`;
  if (part.origin === "synthetic") return `synthetic:${part.category}`;
  if (part.origin === "projected")
    return `projected:${part.category}:${part.parentCategory}`;
  throw new Error(
    `A ${part.category} account part has no performance account and no snapshot row`,
  );
}

/** The engine's key function for one individual account (`accountKeyOf`). */
export type IndKeyFn = (ia: AccountPart) => string;

/** A part with a real account behind it: no `origin` (the engine's declared
 *  siblings, the projected brokerage and synthetic parts all carry one). */
export function isHeldPart(part: { origin?: string }): boolean {
  return part.origin == null;
}
