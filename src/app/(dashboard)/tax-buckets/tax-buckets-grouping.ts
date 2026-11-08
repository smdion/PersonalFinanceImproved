import {
  isTaxFreeBucket,
  isHsaCategory,
  isIraCategory,
  tracksCostBasis,
} from "@/lib/config/account-types";
import { penaltyFreePrefixAmount } from "@/lib/pure/accounts/early-access";
import { AccountEntry } from "./tax-buckets-account-row";

/** Household-first: group every account entry into one of the 5 buckets,
 *  summing balance + accessible-now/locked across BOTH people. Brokerage
 *  is unconditionally penalty-free regardless of owner (no age/employer
 *  gate at all), so a jointly-owned brokerage entry — which skips
 *  per-person early-access computation entirely — still counts its full
 *  balance as accessible; other jointly-owned entries (rare in practice)
 *  are excluded from the accessible/locked split and called out.
 *
 *  Shared between the "Now" and "At Retirement" views — same grouping
 *  logic, fed a different `entries` array. */
export function buildBuckets(entries: AccountEntry[]) {
  const buckets = new Map<
    BucketKey,
    {
      balance: number;
      accessibleNow: number;
      locked: number;
      excludedJoint: number;
      entries: AccountEntry[];
    }
  >();
  for (const entry of entries) {
    const key = bucketKeyFor(entry);
    if (!buckets.has(key)) {
      buckets.set(key, {
        balance: 0,
        accessibleNow: 0,
        locked: 0,
        excludedJoint: 0,
        entries: [],
      });
    }
    const b = buckets.get(key)!;
    b.balance += entry.balance;
    b.entries.push(entry);
    if (entry.slices.length > 0) {
      // Penalty-free capacity is the LEADING, CONTIGUOUS prefix of
      // penalty-free slices (penaltyFreePrefixAmount, @/lib/pure/accounts/early-access)
      // — the SAME single computation path the withdrawal-routing engine
      // uses — NOT a sum of every penalty-free slice regardless of
      // position. An unseasoned Roth conversion slice blocks access to any
      // penalty-free slice behind it even though that slice's own
      // `penaltyFree` flag is true; summing them independently here would
      // silently disagree with what the engine actually routes.
      const accessibleNow = penaltyFreePrefixAmount(entry.slices);
      b.accessibleNow += accessibleNow;
      b.locked += entry.balance - accessibleNow;
      // lint-violation-ok: `key` is this page's own BucketKey union, not an
      // AccountCategory — no account-types.ts predicate applies here.
    } else if (key === "brokerage") {
      b.accessibleNow += entry.balance;
    } else if (entry.ownerPersonId == null) {
      b.excludedJoint += entry.balance;
    }
  }

  let householdTotal = 0;
  let householdAccessible = 0;
  let householdLocked = 0;
  for (const b of buckets.values()) {
    householdTotal += b.balance;
    householdAccessible += b.accessibleNow;
    householdLocked += b.locked;
  }

  return { buckets, householdTotal, householdAccessible, householdLocked };
}

/** The page's buckets, in display order. */
export const BUCKET_KEYS = [
  "traditional",
  "rothIra",
  "rothEmployer",
  "brokerage",
  "hsa",
] as const;

type BucketKey = (typeof BUCKET_KEYS)[number];

export const BUCKET_META: Record<
  BucketKey,
  { label: string; helpText?: string }
> = {
  traditional: { label: "Traditional" },
  rothIra: {
    label: "Roth IRA",
    helpText:
      "Real Roth IRA ordering rules: contributions and seasoned conversions come out first, always, before growth.",
  },
  rothEmployer: {
    label: "Roth 401k / 403b",
    helpText:
      "IRS pro-rata rule: a distribution from a designated Roth 401k/403b can't cleanly isolate basis — the tax-free fraction is only realized on a full distribution.",
  },
  brokerage: { label: "Brokerage" },
  hsa: { label: "HSA" },
};

function bucketKeyFor(entry: AccountEntry): BucketKey {
  if (tracksCostBasis(entry.category)) return "brokerage";
  if (isHsaCategory(entry.category)) return "hsa";
  if (!isTaxFreeBucket(entry.taxType)) return "traditional";
  return isIraCategory(entry.category) ? "rothIra" : "rothEmployer";
}
