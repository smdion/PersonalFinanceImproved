/**
 * Tests for computeWithdrawalEligibility (v0.7.8, PLAN-v0.7.8-v4 Group 2.1,
 * plus the tracked-basis follow-up — see
 * DESIGN-DECISION-v0.7.8-tracked-basis.md). Not yet wired into the engine —
 * these are pure-function tests against the locked designs.
 */
import { describe, it, expect } from "vitest";
import { computeWithdrawalEligibility } from "@/lib/pure/withdrawal-eligibility";
import type { EligibilityAccountInput } from "@/lib/pure/withdrawal-eligibility";
import { initRothBasisState } from "@/lib/pure/roth-basis-tracking";

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
    category: "401k",
    taxType: "preTax",
    ownerPersonId: 1,
    ownerBirthYear: 1990,
    ...overrides,
  };
}

describe("computeWithdrawalEligibility", () => {
  it("locks a 401k when Rule of 55 hasn't been met and the owner is under 59.5", () => {
    const ia = account({
      name: "Old Employer 401k",
      ownerBirthYear: 1990, // age 36 in 2026
      ruleOf55: {
        eligible: false,
        separationYear: 2020,
        source: "derived",
        knownFutureSeparationYear: null,
      },
    });
    const record = computeWithdrawalEligibility({
      year: 2026,
      indAccts: [ia],
      indBal: new Map([[indKey(ia), 100000]]),
      indKey,
    });
    const entry = record.byKey.get(indKey(ia))!;
    expect(entry.penaltyExposedAmount).toBe(100000);
    expect(entry.penaltyFreeAmount).toBe(0);
    expect(record.totalPenaltyExposed).toBe(100000);
    expect(record.penaltyExposedTrad["401k"]).toBe(100000);
    expect(entry.reason).toBe(
      "Locked until Rule of 55 or age 59½ (currently 36)",
    );
  });

  it("does not lock a 401k once Rule of 55 was already met (separated at/after 55)", () => {
    const ia = account({
      name: "Rule of 55 401k",
      ownerBirthYear: 1971, // age 55 in 2026
      ruleOf55: {
        eligible: true,
        separationYear: 2026,
        source: "derived",
        knownFutureSeparationYear: null,
      },
    });
    const record = computeWithdrawalEligibility({
      year: 2026,
      indAccts: [ia],
      indBal: new Map([[indKey(ia), 100000]]),
      indKey,
    });
    const entry = record.byKey.get(indKey(ia))!;
    expect(entry.penaltyExposedAmount).toBe(0);
    expect(entry.penaltyFreeAmount).toBe(100000);
    expect(record.totalPenaltyExposed).toBe(0);
    expect(entry.reason).toBe("Eligible — Rule of 55 met (separated 2026)");
  });

  it("does not lock a 401k once the owner turns 59.5 regardless of Rule of 55", () => {
    const ia = account({
      name: "Still Employed 401k",
      ownerBirthYear: 1966, // age 60 in 2026 (>= 59.5 threshold)
      ruleOf55: {
        eligible: false,
        separationYear: null,
        source: "active",
        knownFutureSeparationYear: null,
      },
    });
    const record = computeWithdrawalEligibility({
      year: 2026,
      indAccts: [ia],
      indBal: new Map([[indKey(ia), 50000]]),
      indKey,
    });
    const entry = record.byKey.get(indKey(ia))!;
    expect(entry.penaltyExposedAmount).toBe(0);
    // Both gates are satisfied here (age 60, and projectRuleOf55 also
    // resolves Rule of 55 as met by assuming separation in the projected
    // year itself, since source is "active" with no known future date) —
    // Rule of 55 is reported first when both apply.
    expect(entry.reason).toBe("Eligible — Rule of 55 met (separated 2026)");
  });

  it("projects a still-employed (source active) worker's Rule of 55 forward to a future year they'd have separated in", () => {
    // Born 1985: turns 55 in 2040. "Now" they're still employed (source
    // "active", no known future separation) — projectRuleOf55 should
    // evaluate as if they separate in the projected year itself.
    const ia = account({
      name: "Future Rule of 55",
      ownerBirthYear: 1985,
      ruleOf55: {
        eligible: false,
        separationYear: null,
        source: "active",
        knownFutureSeparationYear: null,
      },
    });
    const lockedIn2030 = computeWithdrawalEligibility({
      year: 2030, // age 45 — not yet 55
      indAccts: [ia],
      indBal: new Map([[indKey(ia), 80000]]),
      indKey,
    }).byKey.get(indKey(ia))!;
    expect(lockedIn2030.penaltyExposedAmount).toBe(80000);

    const eligibleIn2041 = computeWithdrawalEligibility({
      year: 2041, // age 56 — separating (projected) at 56, Rule of 55 met
      indAccts: [ia],
      indBal: new Map([[indKey(ia), 80000]]),
      indKey,
    }).byKey.get(indKey(ia))!;
    expect(eligibleIn2041.penaltyExposedAmount).toBe(0);
  });

  describe("ruleOf55ForceIneligible (v0.7.8 forecasting toggle)", () => {
    it("forces a still-employed (source active) worker's projected Rule of 55 to ineligible", () => {
      // Same fixture as the "projects a still-employed worker forward" case
      // above, but with the override on -- year 2041 would normally resolve
      // eligible (age 56, projected separation at 56). This is the exact
      // case a first implementation attempt got wrong: mutating the "now"
      // status's .eligible before projection did nothing here, because
      // projectRuleOf55 recomputes eligible from scratch for source
      // "active" and discards whatever was passed in.
      const ia = account({
        name: "Future Rule of 55",
        ownerBirthYear: 1985,
        ruleOf55: {
          eligible: false,
          separationYear: null,
          source: "active",
          knownFutureSeparationYear: null,
        },
        ruleOf55ForceIneligible: true,
      });
      const entry = computeWithdrawalEligibility({
        year: 2041, // age 56 -- would be eligible without the override
        indAccts: [ia],
        indBal: new Map([[indKey(ia), 80000]]),
        indKey,
      }).byKey.get(indKey(ia))!;
      expect(entry.penaltyExposedAmount).toBe(80000);
      expect(entry.reason).toContain("Rule of 55 marked unavailable");
    });

    it("does NOT lock a 63-year-old with the override on -- the 59½ path still applies", () => {
      // The bug an advisor review caught: a naive short-circuit to
      // locked=true would incorrectly lock this account. Rule-of-55-
      // ineligible is not the same as locked -- the pro_rata branch is
      // "Rule of 55 OR 59½", and the override only ever removes the
      // Rule of 55 leg.
      const ia = account({
        name: "Older Worker 401k",
        ownerBirthYear: 1963, // age 63 in 2026 -- well past 59.5
        ruleOf55: {
          eligible: false,
          separationYear: null,
          source: "active",
          knownFutureSeparationYear: null,
        },
        ruleOf55ForceIneligible: true,
      });
      const entry = computeWithdrawalEligibility({
        year: 2026,
        indAccts: [ia],
        indBal: new Map([[indKey(ia), 60000]]),
        indKey,
      }).byKey.get(indKey(ia))!;
      expect(entry.penaltyExposedAmount).toBe(0);
      expect(entry.penaltyFreeAmount).toBe(60000);
      expect(entry.reason).toBe("Eligible — age 59½ or older");
    });

    it("omitted (default) leaves Rule of 55 projection unaffected -- byte-identical to no override", () => {
      const withoutOverride = account({
        name: "Future Rule of 55",
        ownerBirthYear: 1985,
        ruleOf55: {
          eligible: false,
          separationYear: null,
          source: "active",
          knownFutureSeparationYear: null,
        },
      });
      const withOverrideFalseish = account({
        ...withoutOverride,
        ruleOf55ForceIneligible: undefined,
      });
      const a = computeWithdrawalEligibility({
        year: 2041,
        indAccts: [withoutOverride],
        indBal: new Map([[indKey(withoutOverride), 80000]]),
        indKey,
      }).byKey.get(indKey(withoutOverride))!;
      const b = computeWithdrawalEligibility({
        year: 2041,
        indAccts: [withOverrideFalseish],
        indBal: new Map([[indKey(withOverrideFalseish), 80000]]),
        indKey,
      }).byKey.get(indKey(withOverrideFalseish))!;
      expect(a).toEqual(b);
      expect(a.penaltyExposedAmount).toBe(0);
    });
  });

  it("locks a Traditional IRA under 59.5, unlocks at/after 59.5", () => {
    const under = account({
      name: "Trad IRA",
      category: "ira",
      taxType: "preTax",
      ownerBirthYear: 2000, // age 26
    });
    const lockedResult = computeWithdrawalEligibility({
      year: 2026,
      indAccts: [under],
      indBal: new Map([[indKey(under), 40000]]),
      indKey,
    }).byKey.get(indKey(under))!;
    expect(lockedResult.penaltyExposedAmount).toBe(40000);

    const older = account({
      name: "Trad IRA",
      category: "ira",
      taxType: "preTax",
      ownerBirthYear: 1960, // age 66
    });
    const eligibleResult = computeWithdrawalEligibility({
      year: 2026,
      indAccts: [older],
      indBal: new Map([[indKey(older), 40000]]),
      indKey,
    }).byKey.get(indKey(older))!;
    expect(eligibleResult.penaltyExposedAmount).toBe(0);
  });

  it("a Roth IRA with real contribution basis is not locked even for a young owner (contribution basis is always penalty-free)", () => {
    const ia = account({
      name: "Roth IRA",
      category: "ira",
      taxType: "taxFree",
      ownerBirthYear: 2000, // age 26 — not 59.5
      rothBasisMeta: {
        year: 2024,
        contributionBasis: 20000,
        conversionBasis: 0,
        latestConversionYear: null,
        isSeeded: false,
        updatedAt: new Date("2024-01-01"),
      },
    });
    const record = computeWithdrawalEligibility({
      year: 2026,
      indAccts: [ia],
      indBal: new Map([[indKey(ia), 25000]]),
      indKey,
    });
    const entry = record.byKey.get(indKey(ia))!;
    // Contribution-basis slice ($20k) is always penalty-free; the $5k of
    // growth behind it in the prefix is not — per-dollar partition
    // (DESIGN-DECISION-v0.7.8-penalty-hard-exclusion.md § Q1), not the
    // old binary "any penalty-free slice ⇒ whole account not locked" model.
    expect(entry.penaltyFreeAmount).toBe(20000);
    expect(entry.penaltyExposedAmount).toBe(5000);
    // Balance ($25k) exceeds basis ($20k) — some growth is penalty-exposed,
    // so the reason text says "Partially eligible", never plain "Eligible"
    // (that would read as a free lunch on the $5k of growth).
    expect(entry.reason).toBe(
      "Partially eligible — $20,000.00 basis penalty-free, $5,000.00 growth locked until 59½",
    );
    expect(entry.basisRemaining).toBe(20000);
  });

  it("a Roth IRA with zero basis (all growth) for a young owner IS locked", () => {
    const ia = account({
      name: "Roth IRA (all growth)",
      category: "ira",
      taxType: "taxFree",
      ownerBirthYear: 2000, // age 26
      rothBasisMeta: null,
    });
    const record = computeWithdrawalEligibility({
      year: 2026,
      indAccts: [ia],
      indBal: new Map([[indKey(ia), 10000]]),
      indKey,
    });
    const entry = record.byKey.get(indKey(ia))!;
    expect(entry.penaltyExposedAmount).toBe(10000);
    expect(record.penaltyExposedRoth["ira"]).toBe(10000);
    expect(entry.reason).toBe("Locked until age 59½ — no basis remaining");
    expect(entry.basisRemaining).toBe(0);
  });

  it("locks an HSA under 65, unlocks at/after 65", () => {
    const young = account({
      name: "HSA",
      category: "hsa",
      taxType: "hsa",
      ownerBirthYear: 1980, // age 46
    });
    const lockedResult = computeWithdrawalEligibility({
      year: 2026,
      indAccts: [young],
      indBal: new Map([[indKey(young), 15000]]),
      indKey,
    }).byKey.get(indKey(young))!;
    expect(lockedResult.penaltyExposedAmount).toBe(15000);
    expect(lockedResult.reason).toBe(
      "Locked until age 65 — non-medical withdrawal penalty (currently 46)",
    );

    const old = account({
      name: "HSA",
      category: "hsa",
      taxType: "hsa",
      ownerBirthYear: 1955, // age 71
    });
    const eligibleResult = computeWithdrawalEligibility({
      year: 2026,
      indAccts: [old],
      indBal: new Map([[indKey(old), 15000]]),
      indKey,
    }).byKey.get(indKey(old))!;
    expect(eligibleResult.penaltyExposedAmount).toBe(0);
    expect(eligibleResult.reason).toBe("Eligible — age 65 or older");
  });

  it("never locks brokerage regardless of age", () => {
    const ia = account({
      name: "Brokerage",
      category: "brokerage",
      taxType: "afterTax",
      ownerBirthYear: 2005, // age 21
    });
    const record = computeWithdrawalEligibility({
      year: 2026,
      indAccts: [ia],
      indBal: new Map([[indKey(ia), 30000]]),
      indKey,
    });
    expect(record.byKey.get(indKey(ia))!.penaltyExposedAmount).toBe(0);
    expect(record.totalPenaltyExposed).toBe(0);
    expect(record.byKey.get(indKey(ia))!.reason).toBe(
      "Always accessible — no age or employer restriction",
    );
  });

  it("never locks a joint account (no ownerPersonId to resolve an age from)", () => {
    const ia = account({
      name: "Joint 401k",
      ownerPersonId: undefined,
      ownerBirthYear: undefined,
      ruleOf55: null,
    });
    const record = computeWithdrawalEligibility({
      year: 2026,
      indAccts: [ia],
      indBal: new Map([[indKey(ia), 60000]]),
      indKey,
    });
    expect(record.byKey.get(indKey(ia))!.penaltyExposedAmount).toBe(0);
    expect(record.byKey.get(indKey(ia))!.reason).toBe(
      "No individual eligibility rule (joint account)",
    );
  });

  it("totalPenaltyExposed is 0 when nothing is locked — the byte-identity no-op signal", () => {
    const ia = account({
      name: "Eligible 401k",
      ownerBirthYear: 1960,
      ruleOf55: {
        eligible: true,
        separationYear: 2020,
        source: "derived",
        knownFutureSeparationYear: null,
      },
    });
    const record = computeWithdrawalEligibility({
      year: 2026,
      indAccts: [ia],
      indBal: new Map([[indKey(ia), 100000]]),
      indKey,
    });
    expect(record.totalPenaltyExposed).toBe(0);
    for (const cat of Object.keys(record.penaltyExposedTotal)) {
      expect(
        record.penaltyExposedTotal[
          cat as keyof typeof record.penaltyExposedTotal
        ],
      ).toBe(0);
    }
  });

  it("sums locked dollars across multiple accounts and categories", () => {
    const a = account({
      name: "Locked 401k",
      category: "401k",
      taxType: "preTax",
      ownerPersonId: 1,
      ownerBirthYear: 1995, // age 31
      ruleOf55: {
        eligible: false,
        separationYear: null,
        source: "no_data",
        knownFutureSeparationYear: null,
      },
    });
    const b = account({
      name: "Locked HSA",
      category: "hsa",
      taxType: "hsa",
      ownerPersonId: 1,
      ownerBirthYear: 1995,
    });
    const record = computeWithdrawalEligibility({
      year: 2026,
      indAccts: [a, b],
      indBal: new Map([
        [indKey(a), 70000],
        [indKey(b), 15000],
      ]),
      indKey,
    });
    expect(record.totalPenaltyExposed).toBe(85000);
    expect(record.penaltyExposedTrad["401k"]).toBe(70000);
    expect(record.penaltyExposedTotal["hsa"]).toBe(15000);
  });
});

describe("computeWithdrawalEligibility — tracked basis (indBasis)", () => {
  it("reads tracked basis instead of the static rothBasisMeta snapshot when indBasis is supplied", () => {
    const ia = account({
      name: "Roth IRA",
      category: "ira",
      taxType: "taxFree",
      ownerBirthYear: 2000, // age 26
      // Stale snapshot says $0 basis — would be locked if read directly.
      rothBasisMeta: {
        year: 2020,
        contributionBasis: 0,
        conversionBasis: 0,
        latestConversionYear: null,
        isSeeded: false,
        updatedAt: new Date("2020-01-01"),
      },
    });
    const key = indKey(ia);
    // Tracked state has since grown to real basis via modeled contributions.
    const indBasis = new Map([
      [
        key,
        {
          contributionBasis: 15000,
          conversionBasis: 0,
          latestConversionYear: null,
          sourceYear: 2020,
          isSeeded: false,
          stale: true,
        },
      ],
    ]);
    const record = computeWithdrawalEligibility({
      year: 2026,
      indAccts: [ia],
      indBal: new Map([[key, 20000]]),
      indKey,
      indBasis,
    });
    const entry = record.byKey.get(key)!;
    // Penalty-free via tracked basis ($15k), NOT the stale $0 snapshot;
    // the $5k of growth behind it is still penalty-exposed.
    expect(entry.penaltyFreeAmount).toBe(15000);
    expect(entry.penaltyExposedAmount).toBe(5000);
    expect(entry.basisRemaining).toBe(15000);
    expect(entry.basisUncertain).toBe(true); // stale source year disclosed
    expect(entry.reason).toContain("$15,000.00 basis penalty-free");
  });

  it("is byte-identical to the snapshot path when indBasis is omitted (existing behavior preserved)", () => {
    const ia = account({
      name: "Roth IRA",
      category: "ira",
      taxType: "taxFree",
      ownerBirthYear: 2000,
      rothBasisMeta: {
        year: 2026,
        contributionBasis: 8000,
        conversionBasis: 0,
        latestConversionYear: null,
        isSeeded: false,
        updatedAt: new Date("2026-01-01"),
      },
    });
    const key = indKey(ia);
    const withoutIndBasis = computeWithdrawalEligibility({
      year: 2026,
      indAccts: [ia],
      indBal: new Map([[key, 20000]]),
      indKey,
    }).byKey.get(key)!;
    expect(withoutIndBasis.basisRemaining).toBe(8000);
    expect(withoutIndBasis.basisUncertain).toBeUndefined();
  });

  it("reflects basis exhaustion: an account initially eligible via basis becomes locked once tracked basis is drawn to zero", () => {
    const ia = account({
      name: "Roth IRA",
      category: "ira",
      taxType: "taxFree",
      ownerBirthYear: 2000, // age 26 — under 59½
      rothBasisMeta: null,
    });
    const key = indKey(ia);
    const withBasis = computeWithdrawalEligibility({
      year: 2026,
      indAccts: [ia],
      indBal: new Map([[key, 5000]]),
      indKey,
      indBasis: new Map([
        [
          key,
          {
            contributionBasis: 5000,
            conversionBasis: 0,
            latestConversionYear: null,
            sourceYear: 2020,
            isSeeded: false,
            stale: false,
          },
        ],
      ]),
    }).byKey.get(key)!;
    expect(withBasis.penaltyExposedAmount).toBe(0);

    // Same account, same year, basis now fully drawn down (e.g. by a prior
    // withdrawal this same projected year, per drawFromBasis/applyBasisDraw).
    const basisExhausted = computeWithdrawalEligibility({
      year: 2026,
      indAccts: [ia],
      indBal: new Map([[key, 5000]]),
      indKey,
      indBasis: new Map([
        [
          key,
          initRothBasisState(null, 2026), // all-zero
        ],
      ]),
    }).byKey.get(key)!;
    expect(basisExhausted.penaltyExposedAmount).toBe(5000);
    expect(basisExhausted.reason).toBe(
      "Locked until age 59½ — no basis remaining",
    );
  });

  // R41 — per-account penalty-allowance override
  describe("allowPenalizedWithdrawals (R41)", () => {
    it("defaults to false and leaves the *StillExcluded aggregates identical to the plain ones when no account opts in", () => {
      const ia = account({
        name: "Old Employer 401k",
        ownerBirthYear: 1990, // age 36 in 2026
        ruleOf55: {
          eligible: false,
          separationYear: 2020,
          source: "derived",
          knownFutureSeparationYear: null,
        },
      });
      const record = computeWithdrawalEligibility({
        year: 2026,
        indAccts: [ia],
        indBal: new Map([[indKey(ia), 100000]]),
        indKey,
      });
      const entry = record.byKey.get(indKey(ia))!;
      expect(entry.allowPenalizedWithdrawals).toBe(false);
      expect(record.penaltyExposedTradStillExcluded).toEqual(
        record.penaltyExposedTrad,
      );
      expect(record.penaltyExposedRothStillExcluded).toEqual(
        record.penaltyExposedRoth,
      );
      expect(record.penaltyExposedTotalStillExcluded).toEqual(
        record.penaltyExposedTotal,
      );
    });

    it("excludes an allowed account's exposed dollars from *StillExcluded while keeping a disallowed sibling's in both", () => {
      const lockedRuleOf55 = {
        eligible: false,
        separationYear: 2020,
        source: "derived" as const,
        knownFutureSeparationYear: null,
      };
      const allowedAcct = account({
        name: "Allowed 401k",
        ownerBirthYear: 1990,
        ruleOf55: lockedRuleOf55,
        allowPenalizedWithdrawals: true,
      });
      const disallowedAcct = account({
        name: "Disallowed 401k",
        ownerBirthYear: 1990,
        ruleOf55: lockedRuleOf55,
      });
      const record = computeWithdrawalEligibility({
        year: 2026,
        indAccts: [allowedAcct, disallowedAcct],
        indBal: new Map([
          [indKey(allowedAcct), 40000],
          [indKey(disallowedAcct), 60000],
        ]),
        indKey,
      });
      // Both accounts are fully penalty-exposed (Rule of 55 not met, under
      // 59.5) -- the plain aggregate sums both.
      expect(record.penaltyExposedTrad["401k"]).toBe(100000);
      // The "still excluded" aggregate only counts the disallowed account.
      expect(record.penaltyExposedTradStillExcluded["401k"]).toBe(60000);
      expect(
        record.byKey.get(indKey(allowedAcct))?.allowPenalizedWithdrawals,
      ).toBe(true);
      expect(
        record.byKey.get(indKey(disallowedAcct))?.allowPenalizedWithdrawals,
      ).toBe(false);
    });
  });
});
