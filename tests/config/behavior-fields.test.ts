/**
 * Migration proof: each site's field equals its isHsaCategory/isIraCategory
 * check for every category and unknown text. Delete with them in v0.11; a new
 * type failing here is expected, never bend its flags to pass.
 */
import { describe, it, expect } from "vitest";
import {
  ACCOUNT_TYPE_CONFIG,
  getAllCategories,
  hasEarlyAccessRule,
  hasOpenFundChoice,
  isHsaCategory,
  isIraCategory,
  isQcdEligible,
  nonMedicalPenaltyRate,
  isRothIncomeLimited,
  isTaxableCategory,
  paysMedical,
} from "@/lib/config/account-types";
import {
  EARLY_WITHDRAWAL_PENALTY_RATE,
  HSA_NON_MEDICAL_PENALTY_RATE,
} from "@/lib/constants";
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
  sameAt("cash-positions: HSA cash buffer", paysMedical, isHsaCategory);
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

describe("server and sync sites", () => {
  sameAt(
    "investments loadAccounts isHsa, ingest card-spending redaction, paycheck HSA coverage",
    paysMedical,
    isHsaCategory,
  );
  sameAt(
    "paycheck: the Roth IRA panel's IRA room",
    isRothIncomeLimited,
    isIraCategory,
  );
});

describe("UI sites", () => {
  sameAt("holdings: the HSA cash buffer", paysMedical, isHsaCategory);
  sameAt("decumulation table: the QCD line", isQcdEligible, isIraCategory);
  sameAt(
    "account notes and decumulation table: the HSA draw note and source",
    (c) => nonMedicalPenaltyRate(c) !== null,
    isHsaCategory,
  );
  it("contribution card: the penalty rate it names", () => {
    for (const c of EVERY)
      expect([
        c,
        nonMedicalPenaltyRate(c) ?? EARLY_WITHDRAWAL_PENALTY_RATE,
      ]).toEqual([
        c,
        isHsaCategory(c)
          ? HSA_NON_MEDICAL_PENALTY_RATE
          : EARLY_WITHDRAWAL_PENALTY_RATE,
      ]);
  });
});
