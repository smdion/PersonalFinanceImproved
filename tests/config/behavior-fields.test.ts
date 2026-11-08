/**
 * The behavior fields that replace isHsaCategory/isIraCategory outside Tax
 * Buckets (RULES § Data-Driven Architecture rule 10) answer exactly as the
 * identity checks did, at each site's own expression, for every configured
 * category and for stored text this version doesn't know — so no figure moves.
 */
import { describe, it, expect } from "vitest";
import {
  ACCOUNT_TYPE_CONFIG,
  getAllCategories,
  hasEarlyAccessRule,
  hasOpenFundChoice,
  isHsaCategory,
  isIraCategory,
  isRothIncomeLimited,
  isTaxableCategory,
  paysMedicalExpenses,
} from "@/lib/config/account-types";
import type { AccountTypeConfig } from "@/lib/config/account-types.types";

const BY_TEXT: Partial<Record<string, AccountTypeConfig>> = ACCOUNT_TYPE_CONFIG;

/** Stored text no configured category matches. */
const UNKNOWN = [
  "",
  "HSA",
  "Ira",
  "roth ira",
  "457b",
  "529",
  "toString",
  "__proto__",
  "constructor",
];
const EVERY = [...getAllCategories(), ...UNKNOWN];

function sameAt(
  site: string,
  next: (c: string) => boolean,
  old: (c: string) => boolean,
) {
  it(site, () => {
    for (const c of EVERY) expect([c, next(c)]).toEqual([c, old(c)]);
  });
}

describe("lib/pure sites", () => {
  sameAt(
    "retirement-bridge: Traditional IRA source",
    (c) => hasEarlyAccessRule(c, "ira_59_half"),
    isIraCategory,
  );
  sameAt(
    "retirement-bridge: HSA set apart",
    (c) => hasEarlyAccessRule(c, "hsa_non_medical"),
    isHsaCategory,
  );
  sameAt("cash-positions: HSA cash buffer", paysMedicalExpenses, isHsaCategory);
  sameAt(
    "cash-positions and roth-ira: the backdoor's IRA",
    isRothIncomeLimited,
    isIraCategory,
  );
  sameAt(
    "roth-ira: workplace plan",
    (c) => hasEarlyAccessRule(c, "employer_plan"),
    // The old isPayrollDeductibleCategory(c) && !isHsaCategory(c).
    (c) =>
      getAllCategories().some((k) => k === c) &&
      BY_TEXT[c]?.isPayrollDeductible === true &&
      !isHsaCategory(c),
  );
  sameAt(
    "fund-findings: funds chosen freely",
    hasOpenFundChoice,
    (c) => isIraCategory(c) || isTaxableCategory(c),
  );
  it("roth-ira: the Roth IRA panel's category", () => {
    expect(getAllCategories().find(isRothIncomeLimited)).toBe(
      getAllCategories().find(isIraCategory),
    );
  });
});
