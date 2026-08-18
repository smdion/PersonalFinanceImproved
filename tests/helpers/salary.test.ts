import "../helpers/setup-mocks";
import { describe, it, expect } from "vitest";
import {
  computeBonusGross,
  getEffectiveIncome,
  getTotalCompensation,
  applyActiveSalary,
  applyActiveBonusTerms,
  resolveCompensation,
  applySalaryProfileRow,
  type BonusTerms,
  type SalaryProfileActiveMap,
} from "@/server/helpers/salary";

describe("computeBonusGross", () => {
  it("computes bonus from percent and multiplier", () => {
    // $120,000 salary × 10% bonus × 1.0 multiplier × (12/12 months)
    expect(computeBonusGross(120000, "0.10", "1", null)).toBe(12000);
  });

  it("applies bonusMultiplier", () => {
    // $120,000 × 10% × 1.5 = $18,000
    expect(computeBonusGross(120000, "0.10", "1.5", null)).toBe(18000);
  });

  it("returns 0 when bonus percent is 0", () => {
    expect(computeBonusGross(120000, "0", "1", null)).toBe(0);
  });

  it("returns 0 when bonus percent is null", () => {
    expect(computeBonusGross(120000, null, null, null)).toBe(0);
  });

  it("prorates for partial bonus year", () => {
    // $120,000 × 10% × 1 × (6/12) = $6,000
    expect(computeBonusGross(120000, "0.10", "1", 6)).toBe(6000);
  });

  it("defaults multiplier to 1 when null", () => {
    expect(computeBonusGross(120000, "0.10", null, null)).toBe(12000);
  });

  it("treats a stored zero multiplier as a real zero, not unset", () => {
    // A stored "0" is a real "no bonus this cycle" value — only a
    // genuinely null multiplier defaults to 1x. See computeBonusGross.
    expect(computeBonusGross(120000, "0.10", "0", null)).toBe(0);
  });

  it("defaults monthsInBonusYear to 12 when null", () => {
    expect(computeBonusGross(120000, "0.10", "1", null)).toBe(12000);
  });

  it("rounds to cents", () => {
    // 100000 × 0.15 × 1.1 × (12/12) = 16500.000...
    const result = computeBonusGross(100000, "0.15", "1.1", null);
    expect(result).toBe(16500);
    // Check that the result has at most 2 decimal places
    expect(Math.round(result * 100)).toBe(result * 100);
  });
});

// ---------------------------------------------------------------------------
// getEffectiveIncome / getTotalCompensation (pure)
// ---------------------------------------------------------------------------

describe("getEffectiveIncome", () => {
  // A job carries no bonus terms of its own any more — bonusTerms is
  // whatever a Salary Profile's entry resolved to (see resolveCompensation).
  const bonusTerms: BonusTerms = {
    bonusPercent: "0.10",
    bonusMultiplier: "1",
    monthsInBonusYear: 12,
  };

  it("returns base salary when includeBonusInContributions is false", () => {
    const job = { includeBonusInContributions: false };
    expect(getEffectiveIncome(job, 120000, bonusTerms)).toBe(120000);
  });

  it("returns salary + bonus when includeBonusInContributions is true", () => {
    const job = { includeBonusInContributions: true };
    // 120000 + 120000 * 0.10 * 1 * (12/12) = 132000
    expect(getEffectiveIncome(job, 120000, bonusTerms)).toBe(132000);
  });
});

describe("getTotalCompensation", () => {
  const bonusTerms: BonusTerms = {
    bonusPercent: "0.10",
    bonusMultiplier: "1",
    monthsInBonusYear: 12,
  };

  it("returns salary + bonus regardless of includeBonusInContributions", () => {
    expect(getTotalCompensation(120000, bonusTerms)).toBe(132000);
  });

  it("returns just salary when no bonus", () => {
    const noBonus: BonusTerms = { ...bonusTerms, bonusPercent: "0" };
    expect(getTotalCompensation(120000, noBonus)).toBe(120000);
  });
});

// ---------------------------------------------------------------------------
// applyActiveSalary / applyActiveBonusTerms (pure) — the Plan/session tier,
// independent of Salary Profiles.
// ---------------------------------------------------------------------------

describe("applyActiveSalary", () => {
  it("returns the override when the map has an entry for the person", () => {
    const map = new Map([[1, { salary: 150000 }]]);
    expect(applyActiveSalary(1, 100000, map)).toBe(150000);
  });

  it("returns the raw salary when the map has no entry for the person", () => {
    const map = new Map([[2, { salary: 150000 }]]);
    expect(applyActiveSalary(1, 100000, map)).toBe(100000);
  });

  it("returns the raw salary for an empty map", () => {
    expect(applyActiveSalary(1, 100000, new Map())).toBe(100000);
  });

  it("honors a zero-dollar override rather than falling back", () => {
    const map = new Map([[1, { salary: 0 }]]);
    expect(applyActiveSalary(1, 100000, map)).toBe(0);
  });

  it("falls back to raw when the entry pins bonus terms but no salary", () => {
    const map = new Map([[1, { bonusPercent: 0.2 }]]);
    expect(applyActiveSalary(1, 100000, map)).toBe(100000);
  });
});

describe("applyActiveBonusTerms", () => {
  const resolved: BonusTerms = {
    bonusPercent: "0.10",
    bonusMultiplier: "1",
    monthsInBonusYear: 12,
  };

  it("returns the resolved terms unchanged when the override entry is undefined", () => {
    expect(applyActiveBonusTerms(undefined, resolved)).toEqual(resolved);
  });

  it("overrides only the fields the entry sets", () => {
    expect(applyActiveBonusTerms({ bonusPercent: 0.2 }, resolved)).toEqual({
      bonusPercent: "0.2",
      bonusMultiplier: "1",
      monthsInBonusYear: 12,
    });
  });

  it("overrides all three fields when all are set", () => {
    expect(
      applyActiveBonusTerms(
        { bonusPercent: 0.25, bonusMultiplier: 1.5, monthsInBonusYear: 6 },
        resolved,
      ),
    ).toEqual({
      bonusPercent: "0.25",
      bonusMultiplier: "1.5",
      monthsInBonusYear: 6,
    });
  });
});

// ---------------------------------------------------------------------------
// resolveCompensation — the single definition of pay under a Salary Profile
// ---------------------------------------------------------------------------

describe("resolveCompensation", () => {
  it("returns $0/no bonus when the profile has no entry for the job", () => {
    const map: SalaryProfileActiveMap = new Map();
    const comp = resolveCompensation(map, 1);
    expect(comp).toEqual({
      salary: 0,
      bonus: 0,
      totalComp: 0,
      terms: {
        bonusPercent: null,
        bonusMultiplier: null,
        monthsInBonusYear: null,
      },
    });
  });

  it("resolves salary and bonus straight from the job's complete entry", () => {
    const map: SalaryProfileActiveMap = new Map([
      [
        1,
        {
          salary: 120000,
          bonusPercent: 0.1,
          bonusMultiplier: 1,
          monthsInBonusYear: 12,
        },
      ],
    ]);
    const comp = resolveCompensation(map, 1);
    expect(comp.salary).toBe(120000);
    expect(comp.bonus).toBe(12000);
    expect(comp.totalComp).toBe(132000);
  });

  it("prorates by monthsInBonusYear", () => {
    const map: SalaryProfileActiveMap = new Map([
      [
        1,
        {
          salary: 100000,
          bonusPercent: 0.1,
          bonusMultiplier: 1,
          monthsInBonusYear: 6,
        },
      ],
    ]);
    expect(resolveCompensation(map, 1).bonus).toBe(5000);
  });

  it("an entry for a DIFFERENT job never applies", () => {
    const map: SalaryProfileActiveMap = new Map([
      [
        11,
        {
          salary: 90000,
          bonusPercent: 0,
          bonusMultiplier: 1,
          monthsInBonusYear: 12,
        },
      ],
    ]);
    expect(resolveCompensation(map, 1).salary).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applySalaryProfileRow — building the jobId-keyed map from a stored row
// ---------------------------------------------------------------------------

describe("applySalaryProfileRow", () => {
  it("returns an empty map for a null profile", () => {
    expect(applySalaryProfileRow(null).size).toBe(0);
  });

  it("returns an empty map for a profile with no entries", () => {
    expect(applySalaryProfileRow({ salaries: {} }).size).toBe(0);
  });

  it("loads a stored profile into a jobId-keyed map", () => {
    const entry = {
      salary: 100000,
      bonusPercent: 0.05,
      bonusMultiplier: 1,
      monthsInBonusYear: 12,
    };
    const map = applySalaryProfileRow({ salaries: { "7": entry } });
    expect(map.get(7)).toEqual(entry);
  });
});
