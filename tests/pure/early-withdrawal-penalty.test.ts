/**
 * Unit tests for computeEarlyWithdrawalPenalty (penalty-hard-exclusion
 * behavior).
 *
 * Acceptance criteria exercised here:
 *   6. Cost path is exercised — penaltyCost === rate × penalizedAmount,
 *      with the correct rate per account type (10% IRA/401k/403b vs 20%
 *      HSA — this codebase's deliberate deviation from the design doc's
 *      uniform-10% instruction; see early-withdrawal-penalty.ts's docblock).
 *   9. Conservation — penalized = max(0, withdrawn - penaltyFreeAmount),
 *      never negative, never double-counted.
 */
import { describe, it, expect } from "vitest";
import { computeEarlyWithdrawalPenalty } from "@/lib/pure/early-withdrawal-penalty";
import type {
  AccountEligibility,
  EligibilityRecord,
} from "@/lib/pure/withdrawal-eligibility";
import type { AccountCategory } from "@/lib/calculators/types";
import {
  EARLY_WITHDRAWAL_PENALTY_RATE,
  HSA_NON_MEDICAL_PENALTY_RATE,
} from "@/lib/constants";

function makeExposure(
  entries: Record<
    string,
    {
      category: AccountCategory;
      penaltyFreeAmount: number;
      penaltyExposedAmount: number;
    }
  >,
): EligibilityRecord {
  const byKey = new Map<string, AccountEligibility>(
    Object.entries(entries).map(([key, e]) => [
      key,
      {
        indKey: key,
        category: e.category,
        taxType: "preTax",
        penaltyFreeAmount: e.penaltyFreeAmount,
        penaltyExposedAmount: e.penaltyExposedAmount,
        reason: "test fixture",
      },
    ]),
  );
  return {
    byKey,
    totalPenaltyExposed: 0,
    penaltyExposedTrad: {} as Record<AccountCategory, number>,
    penaltyExposedRoth: {} as Record<AccountCategory, number>,
    penaltyExposedTotal: {} as Record<AccountCategory, number>,
  };
}

describe("computeEarlyWithdrawalPenalty", () => {
  it("charges the standard 10% rate on a traditional IRA/401k/403b", () => {
    const exposure = makeExposure({
      k1: {
        category: "401k",
        penaltyFreeAmount: 0,
        penaltyExposedAmount: 50000,
      },
    });
    const result = computeEarlyWithdrawalPenalty({
      exposure,
      withdrawnByKey: new Map([["k1", 10000]]),
    });
    expect(result.penalizedAmount).toBe(10000);
    expect(result.penaltyCost).toBeCloseTo(
      10000 * EARLY_WITHDRAWAL_PENALTY_RATE,
      2,
    );
    expect(EARLY_WITHDRAWAL_PENALTY_RATE).toBe(0.1);
  });

  it("charges the higher 20% rate on HSA non-medical withdrawals, not the 10% IRA rate", () => {
    const exposure = makeExposure({
      k1: {
        category: "hsa",
        penaltyFreeAmount: 0,
        penaltyExposedAmount: 20000,
      },
    });
    const result = computeEarlyWithdrawalPenalty({
      exposure,
      withdrawnByKey: new Map([["k1", 5000]]),
    });
    expect(result.penalizedAmount).toBe(5000);
    expect(result.penaltyCost).toBeCloseTo(
      5000 * HSA_NON_MEDICAL_PENALTY_RATE,
      2,
    );
    expect(HSA_NON_MEDICAL_PENALTY_RATE).toBe(0.2);
    expect(result.penaltyCost).toBeGreaterThan(
      5000 * EARLY_WITHDRAWAL_PENALTY_RATE,
    );
  });

  it("only prices the portion of a withdrawal beyond the account's penalty-free capacity", () => {
    const exposure = makeExposure({
      k1: {
        category: "ira",
        penaltyFreeAmount: 15000,
        penaltyExposedAmount: 5000,
      },
    });
    // Withdraws 18000 -- 15000 is the penalty-free capacity, so only 3000
    // of this specific draw is penalized, not the full 5000 of exposure
    // (which was never all withdrawn).
    const result = computeEarlyWithdrawalPenalty({
      exposure,
      withdrawnByKey: new Map([["k1", 18000]]),
    });
    expect(result.penalizedAmount).toBe(3000);
    expect(result.penaltyCost).toBeCloseTo(
      3000 * EARLY_WITHDRAWAL_PENALTY_RATE,
      2,
    );
  });

  it("charges zero when the withdrawal stays within penalty-free capacity (the default, avoidPenalizedWithdrawals: true, path)", () => {
    const exposure = makeExposure({
      k1: {
        category: "ira",
        penaltyFreeAmount: 40000,
        penaltyExposedAmount: 60000,
      },
    });
    const result = computeEarlyWithdrawalPenalty({
      exposure,
      withdrawnByKey: new Map([["k1", 40000]]),
    });
    expect(result.penalizedAmount).toBe(0);
    expect(result.penaltyCost).toBe(0);
    expect(result.byKey.size).toBe(0);
  });

  it("never charges a negative penalty when withdrawn is less than penaltyFreeAmount", () => {
    const exposure = makeExposure({
      k1: {
        category: "ira",
        penaltyFreeAmount: 100000,
        penaltyExposedAmount: 0,
      },
    });
    const result = computeEarlyWithdrawalPenalty({
      exposure,
      withdrawnByKey: new Map([["k1", 500]]),
    });
    expect(result.penaltyCost).toBe(0);
    expect(result.penalizedAmount).toBe(0);
  });

  it("sums penalty cost across multiple accounts independently, mixing HSA and IRA rates", () => {
    const exposure = makeExposure({
      ira1: {
        category: "ira",
        penaltyFreeAmount: 0,
        penaltyExposedAmount: 10000,
      },
      hsa1: {
        category: "hsa",
        penaltyFreeAmount: 0,
        penaltyExposedAmount: 10000,
      },
    });
    const result = computeEarlyWithdrawalPenalty({
      exposure,
      withdrawnByKey: new Map([
        ["ira1", 10000],
        ["hsa1", 10000],
      ]),
    });
    const expected =
      10000 * EARLY_WITHDRAWAL_PENALTY_RATE +
      10000 * HSA_NON_MEDICAL_PENALTY_RATE;
    expect(result.penaltyCost).toBeCloseTo(expected, 2);
    expect(result.penalizedAmount).toBe(20000);
    expect(result.byKey.size).toBe(2);
  });

  it("ignores an account with no withdrawal recorded at all", () => {
    const exposure = makeExposure({
      k1: {
        category: "ira",
        penaltyFreeAmount: 0,
        penaltyExposedAmount: 50000,
      },
    });
    const result = computeEarlyWithdrawalPenalty({
      exposure,
      withdrawnByKey: new Map(),
    });
    expect(result.penaltyCost).toBe(0);
    expect(result.penalizedAmount).toBe(0);
  });
});
