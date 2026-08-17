/**
 * The Salary Profile PIN invariant — "presence of a field is the pin" —
 * proved at build-engine-payload's year-0 bonus adjustment, the site most
 * likely to go silently wrong when the encoding changed.
 *
 * BACKGROUND. The engine compounds future years off `totalCompFullFormula`
 * (always the full-formula bonus). This year's ACTUAL bonus may differ,
 * because `job_bonus_overrides` can pin it. The difference is fed in as a
 * year-0-only `currentYearBonusAdjustment` so one unusual year doesn't
 * depress every projected year after it.
 *
 * THE TRAP. That adjustment used to be skipped entirely for anyone present in
 * the salary override map, justified by "a pin replaces the whole number,
 * bonus included". That was true only while a pin could ONLY be a flat salary
 * that overwrote total comp and discarded bonus. Under the presence encoding
 * a pin sets individual fields, so a pinned SALARY keeps live bonus terms and
 * still earns a real bonus — and the old guard would suppress a correction
 * that is genuinely needed. The guard's premise inverted.
 *
 * The fix is an identity rather than another guard: both bonuses are computed
 * from the same effective salary and the same effective bonus terms, so the
 * adjustment is exactly `totalComp - totalCompFullFormula` for everyone, and
 * cannot double-count. These tests pin that down for all three shapes.
 *
 * Every person below has a `job_bonus_overrides` row deliberately BELOW their
 * formula bonus, so a correctly-computed adjustment is always non-zero and an
 * incorrectly-suppressed one is always absent — the two are never confusable.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createTestCaller, seedJob, seedPerformanceAccount } from "./setup";
import {
  buildEnginePayload,
  fetchRetirementData,
} from "@/server/retirement/build-engine-payload";
import * as schema from "@/lib/db/schema-sqlite";

const FIXED_NOW = new Date("2026-04-14T12:00:00Z");
const CURRENT_YEAR = 2026;

const BASE_SALARY = 100000;
const BONUS_PERCENT = 0.1; // live terms: full-formula bonus = 10,000
const PINNED_BONUS = 4000; // deliberately below the formula
const PINNED_SALARY = 250000;
const PINNED_BONUS_PERCENT = 0.2; // pinned terms: 20% instead of 10%

describe("salary profile pin invariant — year-0 bonus adjustment", () => {
  let testCaller: Awaited<ReturnType<typeof createTestCaller>>;
  let payload: NonNullable<Awaited<ReturnType<typeof buildEnginePayload>>>;
  /** No pins at all — the control arm. */
  let unpinnedPersonId: number;
  /** Salary pinned, bonus terms live. The branch the old guard broke. */
  let salaryPinnedPersonId: number;
  /** Bonus terms pinned, salary live. */
  let bonusPinnedPersonId: number;
  let salaryProfileId: number;

  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    testCaller = await createTestCaller();
    const { db } = testCaller;

    const addPerson = (name: string, primary: boolean) =>
      db
        .insert(schema.people)
        .values({
          name,
          dateOfBirth: "1990-01-01",
          isPrimaryUser: primary,
        })
        .returning({ id: schema.people.id })
        .get().id;

    unpinnedPersonId = addPerson("Unpinned", true);
    salaryPinnedPersonId = addPerson("SalaryPinned", false);
    bonusPinnedPersonId = addPerson("BonusPinned", false);

    for (const personId of [
      unpinnedPersonId,
      salaryPinnedPersonId,
      bonusPinnedPersonId,
    ]) {
      const jobId = seedJob(db, personId, {
        annualSalary: String(BASE_SALARY),
        bonusPercent: String(BONUS_PERCENT),
        bonusMultiplier: "1.0",
        monthsInBonusYear: 12,
      });
      // A pinned current-year bonus below the formula — this is what makes
      // the year-0 adjustment non-zero.
      db.insert(schema.jobBonusOverrides)
        .values({
          jobId,
          year: CURRENT_YEAR,
          overrideAmount: String(PINNED_BONUS),
        })
        .run();
    }

    db.insert(schema.budgetProfiles)
      .values({
        name: "Main Budget",
        isActive: true,
        columnLabels: ["Standard"],
      })
      .run();
    seedPerformanceAccount(db);

    const retSettings = (personId: number) => ({
      personId,
      retirementAge: 65,
      endAge: 95,
      returnAfterRetirement: "0.06",
      annualInflation: "0.03",
      salaryAnnualIncrease: "0.03",
      withdrawalRate: "0.04",
      taxMultiplier: "1.0",
      grossUpForTaxes: true,
      socialSecurityMonthly: "2500",
      ssStartAge: 67,
      raisesDuringRetirement: false,
      enableRothConversions: false,
      withdrawalStrategy: "fixed" as const,
      gkSkipInflationAfterLoss: true,
      filingStatus: "MFJ" as const,
    });
    for (const personId of [
      unpinnedPersonId,
      salaryPinnedPersonId,
      bonusPinnedPersonId,
    ]) {
      db.insert(schema.retirementSettings).values(retSettings(personId)).run();
    }

    salaryProfileId = db
      .insert(schema.salaryProfiles)
      .values({
        name: "One Of Each",
        salaries: {
          // The unpinned person has NO KEY — which is the same statement as
          // an empty entry, and the reason a profile need not enumerate
          // everyone to be complete.
          [String(salaryPinnedPersonId)]: { salary: PINNED_SALARY },
          [String(bonusPinnedPersonId)]: {
            bonusPercent: PINNED_BONUS_PERCENT,
          },
        },
      })
      .returning({ id: schema.salaryProfiles.id })
      .get().id;

    const data = await fetchRetirementData(testCaller.db, { salaryProfileId });
    const result = await buildEnginePayload(testCaller.db, data, {
      salaryProfileId,
    });
    if (!result) throw new Error("buildEnginePayload returned null");
    payload = result;
  });

  afterAll(() => {
    vi.useRealTimers();
    testCaller.cleanup();
  });

  const adjustments = () =>
    payload.baseEngineInput.currentYearBonusAdjustment ?? {};

  it("applies the year-0 bonus adjustment for a person with no pins", () => {
    // Control arm: unchanged from before the redesign.
    expect(adjustments()[unpinnedPersonId]).toBeCloseTo(
      PINNED_BONUS - BASE_SALARY * BONUS_PERCENT, // 4000 - 10000
      6,
    );
  });

  it("STILL applies it for a pinned salary with live bonus terms", () => {
    // THE REGRESSION GUARD. The old code skipped this person entirely
    // because they were present in the salary override map. Their bonus is
    // not gone — it is the live 10% of their PINNED 250k salary — so the
    // job_bonus_overrides correction is still owed, and is now computed
    // against the pinned salary rather than the live one.
    expect(adjustments()[salaryPinnedPersonId]).toBeCloseTo(
      PINNED_BONUS - PINNED_SALARY * BONUS_PERCENT, // 4000 - 25000
      6,
    );
    // Explicitly NOT the old behaviour.
    expect(adjustments()[salaryPinnedPersonId]).toBeDefined();
  });

  it("uses the PINNED bonus terms when the entry pins them", () => {
    // Salary stays live (100k), but the formula side uses 20%, not the
    // job record's 10% — the pinned terms drive both sides of the delta.
    expect(adjustments()[bonusPinnedPersonId]).toBeCloseTo(
      PINNED_BONUS - BASE_SALARY * PINNED_BONUS_PERCENT, // 4000 - 20000
      6,
    );
  });

  it("compounding baselines use pinned salary AND pinned bonus terms", () => {
    // salaryByPerson is the engine's per-person compounding baseline
    // (totalCompFullFormula): effective salary + FULL-formula bonus at the
    // effective terms. This year's pinned bonus is handled by the year-0
    // adjustment above, deliberately not by depressing this baseline.
    const byPerson = payload.baseEngineInput.salaryByPerson!;
    expect(byPerson[unpinnedPersonId]).toBeCloseTo(
      BASE_SALARY + BASE_SALARY * BONUS_PERCENT, // 110,000
      6,
    );
    // A pinned salary NO LONGER swallows the bonus — this is the shipped bug
    // being fixed. It used to be exactly PINNED_SALARY.
    expect(byPerson[salaryPinnedPersonId]).toBeCloseTo(
      PINNED_SALARY + PINNED_SALARY * BONUS_PERCENT, // 275,000
      6,
    );
    expect(byPerson[salaryPinnedPersonId]).not.toBeCloseTo(PINNED_SALARY, 6);
    expect(byPerson[bonusPinnedPersonId]).toBeCloseTo(
      BASE_SALARY + BASE_SALARY * PINNED_BONUS_PERCENT, // 120,000
      6,
    );
  });

  it("adjustment equals totalComp − totalCompFullFormula for everyone", () => {
    // The identity that replaced the guard. If this holds, the correction
    // can neither be double-counted nor suppressed, whatever is pinned.
    const totalAdjustment = Object.values(adjustments()).reduce(
      (s, v) => s + v,
      0,
    );
    // baseEngineInput.currentSalary IS totalCompensationFullFormula — the
    // compounding baseline — while payload.totalCompensation is this year's
    // resolved comp.
    expect(totalAdjustment).toBeCloseTo(
      payload.totalCompensation - payload.baseEngineInput.currentSalary,
      6,
    );
  });
});
