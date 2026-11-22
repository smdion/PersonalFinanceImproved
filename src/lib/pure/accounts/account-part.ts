import type {
  AccountKey,
  IndividualAccountInput,
} from "./account-balances.types";

/** One account part's label and facts: its account's name, category, tax
 *  type and owner (absent for a joint account). The name is a label, never
 *  part of a key. */
type AccountPart = {
  name: string;
  category: string;
  taxType: string;
  ownerPersonId?: number;
};

/** What names a part's account by id and category: its performance account,
 *  else its snapshot row (each has one parent); the engine's own parts by
 *  origin, category and parent. */
type PartIdentity = Partial<
  Pick<
    IndividualAccountInput,
    "performanceAccountId" | "portfolioAccountId" | "origin" | "parentCategory"
  >
> &
  Pick<AccountPart, "category" | "taxType"> & { ownerPersonId?: number | null };

/** The one key shape: (identity, tax type, owner or `joint`). */
function partKey(
  identity: string,
  part: Pick<AccountPart, "taxType"> & { ownerPersonId?: number | null },
): AccountKey {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the brand's one builder
  return `${identity}::${part.taxType}::${part.ownerPersonId ?? "joint"}` as AccountKey;
}

/** The key of one account part by its account's id (`acct:`, `row:`,
 *  `projected:` or `synthetic:`). A row id is one snapshot's: the key holds for
 *  one run, never stored or compared across snapshots or restores. */
export function accountIdKeyOf(part: PartIdentity): AccountKey {
  return partKey(identityOf(part), part);
}

/** The part key of a Tax Buckets entry: by its performance account, else by
 *  its one snapshot row (one run's name for it), as the payload builds it. */
export function entryKeyOf(
  entry: Pick<AccountPart, "category" | "taxType"> & {
    ownerPersonId?: number | null;
    performanceAccountId?: number | null;
    portfolioAccountIds: readonly number[];
  },
): AccountKey {
  return accountIdKeyOf({
    ...entry,
    performanceAccountId: entry.performanceAccountId ?? undefined,
    portfolioAccountId: entry.portfolioAccountIds[0],
  });
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

/** The engine's key function for one individual account (`accountIdKeyOf`). */
export type IndKeyFn = (
  ia: Omit<PartIdentity, "ownerPersonId"> &
    Pick<AccountPart, "name" | "ownerPersonId">,
) => string;

/** A part with a real account behind it: no `origin` (the engine's declared
 *  siblings, the projected brokerage and synthetic parts all carry one). */
export function isHeldPart(part: { origin?: string }): boolean {
  return part.origin == null;
}
