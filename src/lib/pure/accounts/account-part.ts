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
 *  else its snapshot row, else its contribution account (each has one
 *  parent); the engine's own parts by origin, category and parent. */
type PartIdentity = Partial<
  Pick<
    IndividualAccountInput,
    | "performanceAccountId"
    | "portfolioAccountId"
    | "contributionAccountId"
    | "origin"
    | "parentCategory"
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
 *  `contrib:`, `projected:` or `synthetic:`). A row id is one snapshot's: the
 *  key holds for one run, never stored or compared across restores. */
export function accountIdKeyOf(part: PartIdentity): AccountKey {
  return partKey(heldIdentityOf(part) ?? engineIdentityOf(part), part);
}

/** The part key of a Tax Buckets entry: by its performance account, else by
 *  its one snapshot row (one run's name for it), as the payload builds it;
 *  never one of the engine's own identities (`contrib:`, `projected:` …). */
export function entryKeyOf(
  entry: Pick<AccountPart, "category" | "taxType"> & {
    ownerPersonId?: number | null;
    performanceAccountId?: number | null;
    portfolioAccountIds: readonly number[];
  },
): AccountKey {
  const part = {
    ...entry,
    performanceAccountId: entry.performanceAccountId ?? undefined,
    portfolioAccountId: entry.portfolioAccountIds[0],
  };
  return partKey(heldIdentityOf(part) ?? noAccount(part), part);
}

/** A held account's identity: its performance account, else its snapshot row;
 *  undefined for a part with neither. */
function heldIdentityOf(
  part: Pick<
    PartIdentity,
    "performanceAccountId" | "portfolioAccountId" | "category"
  >,
): string | undefined {
  if (part.performanceAccountId != null)
    return `acct:${part.performanceAccountId}:${part.category}`;
  if (part.portfolioAccountId != null)
    return `row:${part.portfolioAccountId}:${part.category}`;
  return undefined;
}

/** The identity of a part with no held account: its contribution account, else
 *  the engine's own part by origin, category and parent. */
function engineIdentityOf(part: PartIdentity): string {
  if (part.contributionAccountId != null)
    return `contrib:${part.contributionAccountId}:${part.category}`;
  if (part.origin === "synthetic") return `synthetic:${part.category}`;
  if (part.origin === "projected")
    return `projected:${part.category}:${part.parentCategory}`;
  return noAccount(part);
}

function noAccount(part: Pick<AccountPart, "category">): never {
  throw new Error(
    `A ${part.category} account part has no performance account and no snapshot row`,
  );
}

/** The engine's key function for one individual account (`accountIdKeyOf`). */
export type IndKeyFn = (
  ia: Omit<PartIdentity, "ownerPersonId"> &
    Pick<AccountPart, "name" | "ownerPersonId">,
) => string;

/** A part the user entered: no `origin` (the engine's declared siblings and
 *  spec parts, the projected brokerage and synthetic parts all carry one). */
export function isHeldPart(part: { origin?: string }): boolean {
  return part.origin == null;
}

/** A part of a real account: a performance account, a snapshot row or a
 *  contribution account (`acct:`, `row:`, `contrib:`), entered or declared. */
export function hasRealAccount(part: PartIdentity): boolean {
  return (
    part.performanceAccountId != null ||
    part.portfolioAccountId != null ||
    part.contributionAccountId != null
  );
}
