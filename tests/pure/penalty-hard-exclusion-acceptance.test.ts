/**
 * Acceptance-criteria tests for the v0.7.8 penalty-hard-exclusion pass —
 * see .scratch/docs/plans/DESIGN-DECISION-v0.7.8-penalty-hard-exclusion.md
 * § "Acceptance criteria" for the numbered list this file works through.
 * Criteria requiring real routing (10 — per-mode unmetNeed/shortfall
 * typing) live in withdrawal-routing.test.ts; the dedicated Monte Carlo
 * honesty test (11) lives in
 * tests/calculators/monte-carlo-penalty-honesty.test.ts; the penalty-cost
 * pricing math (6) lives in tests/pure/early-withdrawal-penalty.test.ts.
 * This file covers the criteria provable directly against
 * computeWithdrawalEligibility and getRmdStartAge.
 */
import { describe, it, expect } from "vitest";
import {
  computeWithdrawalEligibility,
  type EligibilityAccountInput,
} from "@/lib/pure/withdrawal-eligibility";
import { getRmdStartAge } from "@/lib/config/rmd-tables";
import { PENALTY_FREE_AGE } from "@/lib/constants";

const indKey = (ia: {
  name: string;
  category: string;
  taxType: string;
  ownerPersonId?: number;
}) =>
  `${ia.name}::${ia.category}::${ia.taxType}::${ia.ownerPersonId ?? "joint"}`;

function account(
  overrides: Partial<EligibilityAccountInput>,
): EligibilityAccountInput {
  return {
    name: "Test Account",
    category: "ira",
    taxType: "taxFree",
    ownerPersonId: 1,
    ownerBirthYear: 1990,
    ...overrides,
  };
}

describe("penalty-hard-exclusion acceptance criteria", () => {
  // Criterion 5 (static half): every SECURE 2.0 RMD start age exceeds
  // PENALTY_FREE_AGE, so RMD dollars are never penalty-exposed by
  // construction -- no runtime code needed to enforce it, just this
  // invariant holding forever.
  it("criterion 5 (RMD-exempt by construction): every RMD start age exceeds PENALTY_FREE_AGE", () => {
    const birthYears = [1930, 1945, 1950, 1951, 1955, 1959, 1960, 1975, 2000];
    for (const by of birthYears) {
      expect(getRmdStartAge(by)).toBeGreaterThan(PENALTY_FREE_AGE);
    }
  });

  // Criterion 3: the exact reported case. Pre-59½ Roth IRA, $40k
  // contribution basis, $60k growth ($100k balance) -- a $50k need against
  // it draws exactly $40k of penalty-free capacity, zero growth.
  it("criterion 3 (the reported case): a pre-59½ Roth IRA's penalty-free capacity is exactly its basis, not its whole balance", () => {
    const ia = account({
      name: "Roth IRA",
      ownerBirthYear: 2000, // well under 59.5
      rothBasisMeta: {
        year: 2024,
        contributionBasis: 40000,
        conversionBasis: 0,
        latestConversionYear: null,
        isSeeded: false,
        updatedAt: new Date("2024-01-01"),
      },
    });
    const record = computeWithdrawalEligibility({
      year: 2026,
      indAccts: [ia],
      indBal: new Map([[indKey(ia), 100000]]),
      indKey,
    });
    const entry = record.byKey.get(indKey(ia))!;
    expect(entry.penaltyFreeAmount).toBe(40000);
    expect(entry.penaltyExposedAmount).toBe(60000);
    // A caller (routeForMode / Tier A) that respects this partition can
    // draw at most 40000 penalty-free from this account regardless of a
    // larger need -- the $10k of a hypothetical $50k need beyond that must
    // come from elsewhere or become penaltyAvoidedShortfall, never this
    // account's growth. That routing behavior itself is asserted in
    // withdrawal-routing.test.ts; this test locks in the exposure
    // partition the routing math depends on.
  });

  // Criterion 4: prefix rule. Unseasoned (this-year) conversion basis sits
  // behind contribution basis in Roth IRA release order -- penalty-free
  // capacity stops at the contribution-basis prefix; the conversion is not
  // skipped over to reach anything, and growth behind IT is doubly
  // unreachable.
  it("criterion 4 (prefix rule): an unseasoned conversion sitting behind contribution basis blocks penalty-free access to itself and to growth behind it", () => {
    const ia = account({
      name: "Roth IRA",
      ownerBirthYear: 2000,
      rothBasisMeta: {
        year: 2024,
        contributionBasis: 20000,
        conversionBasis: 30000,
        latestConversionYear: 2026, // converted THIS year -- not yet seasoned
        isSeeded: false,
        updatedAt: new Date("2024-01-01"),
      },
    });
    const record = computeWithdrawalEligibility({
      year: 2026,
      indAccts: [ia],
      // balance = 20k contribution + 30k conversion + 25k growth
      indBal: new Map([[indKey(ia), 75000]]),
      indKey,
    });
    const entry = record.byKey.get(indKey(ia))!;
    // Only the contribution-basis prefix is penalty-free -- the unseasoned
    // conversion (and the growth behind it) both stay exposed.
    expect(entry.penaltyFreeAmount).toBe(20000);
    expect(entry.penaltyExposedAmount).toBe(55000);
  });

  // Criterion 9: conservation. penaltyFreeAmount + penaltyExposedAmount ===
  // balance, for every account shape this gate handles.
  it("criterion 9 (conservation): penaltyFreeAmount + penaltyExposedAmount === balance across every branch", () => {
    const fixtures: { ia: EligibilityAccountInput; balance: number }[] = [
      {
        ia: account({
          name: "Young 401k",
          category: "401k",
          taxType: "preTax",
        }),
        balance: 200000,
      },
      {
        ia: account({
          name: "Old Roth IRA",
          ownerBirthYear: 1950,
          rothBasisMeta: {
            year: 2020,
            contributionBasis: 10000,
            conversionBasis: 0,
            latestConversionYear: null,
            isSeeded: false,
            updatedAt: new Date("2020-01-01"),
          },
        }),
        balance: 300000,
      },
      {
        ia: account({
          name: "HSA",
          category: "hsa",
          taxType: "preTax",
          ownerBirthYear: 1995,
        }),
        balance: 40000,
      },
      {
        ia: account({
          name: "Brokerage",
          category: "brokerage",
          taxType: "afterTax",
        }),
        balance: 90000,
      },
      {
        ia: account({
          name: "Joint Brokerage",
          category: "brokerage",
          taxType: "afterTax",
          ownerPersonId: undefined,
          ownerBirthYear: undefined,
        }),
        balance: 50000,
      },
    ];
    const indBal = new Map(fixtures.map((f) => [indKey(f.ia), f.balance]));
    const record = computeWithdrawalEligibility({
      year: 2026,
      indAccts: fixtures.map((f) => f.ia),
      indBal,
      indKey,
    });
    for (const f of fixtures) {
      const entry = record.byKey.get(indKey(f.ia))!;
      expect(entry.penaltyFreeAmount + entry.penaltyExposedAmount).toBeCloseTo(
        f.balance,
        2,
      );
    }
  });

  // Criterion 2: set containment. Every dollar that the OLD binary model
  // would have called "locked" (i.e. would report as fully penalty-exposed,
  // 100% of balance) must still be fully penalty-exposed under the new
  // per-dollar model -- locked ⊆ penalty-exposed.
  it("criterion 2 (set containment): an account with zero penalty-free capacity is exposed on its entire balance, matching the old whole-account-locked verdict", () => {
    const ia = account({
      name: "All-growth Roth IRA",
      ownerBirthYear: 2000,
      rothBasisMeta: {
        year: 2024,
        contributionBasis: 0,
        conversionBasis: 0,
        latestConversionYear: null,
        isSeeded: false,
        updatedAt: new Date("2024-01-01"),
      },
    });
    const record = computeWithdrawalEligibility({
      year: 2026,
      indAccts: [ia],
      indBal: new Map([[indKey(ia), 80000]]),
      indKey,
    });
    const entry = record.byKey.get(indKey(ia))!;
    expect(entry.penaltyFreeAmount).toBe(0);
    expect(entry.penaltyExposedAmount).toBe(80000);
  });

  // Criterion 13: joint accounts. No ownerBirthYear ⇒ no age to gate on ⇒
  // fully penalty-free, and the reason string says so plainly rather than
  // silently defaulting.
  it("criterion 13 (joint accounts): an account with no resolvable owner is fully penalty-free", () => {
    const ia = account({
      name: "Joint Brokerage",
      category: "brokerage",
      taxType: "afterTax",
      ownerPersonId: undefined,
      ownerBirthYear: undefined,
    });
    const record = computeWithdrawalEligibility({
      year: 2026,
      indAccts: [ia],
      indBal: new Map([[indKey(ia), 60000]]),
      indKey,
    });
    const entry = record.byKey.get(indKey(ia))!;
    expect(entry.penaltyFreeAmount).toBe(60000);
    expect(entry.penaltyExposedAmount).toBe(0);
    expect(entry.reason).toBe("No individual eligibility rule (joint account)");
  });
});
