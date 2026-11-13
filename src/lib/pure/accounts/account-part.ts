/** One account part as the engine keys it: the account's name, category,
 *  tax type and owner (absent for a joint account). */
type AccountPart = {
  name: string;
  category: string;
  taxType: string;
  ownerPersonId?: number;
};

/** One account part's identity in the engine's ledger and on its per-account
 *  rows. Opaque: compared only for equality, built only by `accountKeyOf`. */
export type AccountKey = string & { readonly __brand: "AccountKey" };

/** The key of one account part. Two people's same-named accounts stay apart;
 *  a joint account keys on `"joint"`. */
export function accountKeyOf(
  part: Omit<AccountPart, "ownerPersonId"> & { ownerPersonId?: number | null },
): AccountKey {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the brand's one builder
  return `${part.name}::${part.category}::${part.taxType}::${part.ownerPersonId ?? "joint"}` as AccountKey;
}

/** The engine's key function for one individual account (`accountKeyOf`). */
export type IndKeyFn = (ia: AccountPart) => string;

/** A part with a real account behind it: no `origin` (the engine's declared
 *  siblings, the projected brokerage and synthetic parts all carry one). */
export function isHeldPart(part: { origin?: string }): boolean {
  return part.origin == null;
}
