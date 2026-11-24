import {
  isTaxFreeBucket,
  isTripleTaxAdvantaged,
  getAccountTypeConfig,
  hasEarlyAccessRule,
  tracksCostBasis,
} from "@/lib/config/account-types";
import { penaltyFreePrefixAmount } from "@/lib/pure/accounts/early-access";
import { AccountEntry } from "./tax-buckets-account-row";

/** Groups every entry into the 5 buckets across both people ("Now" and "At
 *  Retirement"). A type with no early-access rule counts as accessible, joint or
 *  not; other joint entries are left out of the split and called out. */
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
      // Accessible = the leading contiguous run of penalty-free slices, the
      // engine's own penaltyFreePrefixAmount: an unseasoned conversion blocks
      // penalty-free slices behind it.
      const accessibleNow = penaltyFreePrefixAmount(entry.slices);
      b.accessibleNow += accessibleNow;
      b.locked += entry.balance - accessibleNow;
    } else if (hasEarlyAccessRule(entry.category, "none")) {
      // No early-access gate: all of it is penalty-free, as the engine has it.
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
  if (isTripleTaxAdvantaged(entry.category)) return "hsa";
  if (!isTaxFreeBucket(entry.taxType)) return "traditional";
  const ordering = getAccountTypeConfig(entry.category).rothOrderingRules;
  return ordering === "basis_first" ? "rothIra" : "rothEmployer";
}
