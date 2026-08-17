/**
 * Retirement profile-switch salary injection — regression tests for the two
 * bugs the Salary Profile split surfaced in build-engine-payload.ts:
 *
 *  1. DOUBLE-INJECTION: the loop used to push a perPersonSalaryOverrides
 *     entry for EVERY personId in the referenced profile, from EVERY
 *     retirement_salary_overrides row — so two people's rows for the same
 *     year, both pointing at a profile containing both people, produced four
 *     entries (two per person). retirement_salary_overrides has
 *     per-(person, year) grain, so a row must contribute only its own
 *     person's value.
 *
 *  2. WRONG RAISE-RATE PERSON: the growth factor used the PRIMARY person's
 *     retirementSettings.salaryAnnualIncrease for everyone, even though
 *     retirementSettings is per-person.
 *
 * It also guards the invariant the presence encoding exists to protect: only
 * a pinned SALARY carries a number to grow. A person whose salary resolves
 * live in the switched profile must get NO injected override — the engine is
 * already projecting their job salary forward, so injecting one would
 * compound a second, redundant salary path. That includes someone who pins
 * only BONUS terms: bonus terms are not a salary and must not be injected as
 * one, which is a new way to get this wrong under the presence encoding.
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
const SWITCH_YEAR = 2031;
const YEARS_OUT = SWITCH_YEAR - CURRENT_YEAR; // 5

// Deliberately different per person so bug 2 is detectable.
const ALEX_RAISE = 0.03;
const BLAKE_RAISE = 0.07;

const ALEX_PROFILE_SALARY = 200000;
const BLAKE_PROFILE_SALARY = 150000;

describe("retirement profile-switch salary injection", () => {
  let testCaller: Awaited<ReturnType<typeof createTestCaller>>;
  let payload: NonNullable<Awaited<ReturnType<typeof buildEnginePayload>>>;
  let alexId: number;
  let blakeId: number;
  let caseyId: number;

  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    testCaller = await createTestCaller();
    const { db } = testCaller;

    alexId = db
      .insert(schema.people)
      .values({
        name: "Alex",
        dateOfBirth: "1990-01-01",
        isPrimaryUser: true,
      })
      .returning({ id: schema.people.id })
      .get().id;
    blakeId = db
      .insert(schema.people)
      .values({
        name: "Blake",
        dateOfBirth: "1990-01-01",
        isPrimaryUser: false,
      })
      .returning({ id: schema.people.id })
      .get().id;

    caseyId = db
      .insert(schema.people)
      .values({
        name: "Casey",
        dateOfBirth: "1990-01-01",
        isPrimaryUser: false,
      })
      .returning({ id: schema.people.id })
      .get().id;

    seedJob(db, alexId, { annualSalary: "120000" });
    seedJob(db, blakeId, { annualSalary: "100000" });
    seedJob(db, caseyId, { annualSalary: "80000" });

    db.insert(schema.budgetProfiles)
      .values({
        name: "Main Budget",
        isActive: true,
        columnLabels: ["Standard"],
      })
      .run();
    seedPerformanceAccount(db);

    const retSettings = (personId: number, raise: string) => ({
      personId,
      retirementAge: 65,
      endAge: 95,
      returnAfterRetirement: "0.06",
      annualInflation: "0.03",
      salaryAnnualIncrease: raise,
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
    db.insert(schema.retirementSettings)
      .values(retSettings(alexId, String(ALEX_RAISE)))
      .run();
    db.insert(schema.retirementSettings)
      .values(retSettings(blakeId, String(BLAKE_RAISE)))
      .run();
    db.insert(schema.retirementSettings)
      .values(retSettings(caseyId, String(ALEX_RAISE)))
      .run();

    // One Salary Profile holding all three people — Alex and Blake pinned at
    // fixed amounts (the exact shape that used to double-inject), Casey
    // following their job record.
    const salaryProfileId = db
      .insert(schema.salaryProfiles)
      .values({
        name: "Household Raise",
        salaries: {
          [String(alexId)]: { salary: ALEX_PROFILE_SALARY },
          [String(blakeId)]: { salary: BLAKE_PROFILE_SALARY },
          // Pins bonus terms but NOT salary — has a profile entry, yet
          // nothing here to grow.
          [String(caseyId)]: { bonusPercent: 0.4 },
        },
      })
      .returning({ id: schema.salaryProfiles.id })
      .get().id;

    // One row per person for the SAME year, all referencing that one profile
    // — the household-wide switch expressed at the table's grain.
    for (const personId of [alexId, blakeId, caseyId]) {
      db.insert(schema.retirementSalaryOverrides)
        .values({
          personId,
          projectionYear: SWITCH_YEAR,
          overrideSalary: "0",
          salaryProfileId,
        })
        .run();
    }

    const data = await fetchRetirementData(testCaller.db, {});
    const result = await buildEnginePayload(testCaller.db, data, {});
    if (!result) throw new Error("buildEnginePayload returned null");
    payload = result;
  });

  afterAll(() => {
    vi.useRealTimers();
    testCaller.cleanup();
  });

  const entriesFor = (personId: number) =>
    payload.baseEngineInput.perPersonSalaryOverrides!.filter(
      (o) => o.personId === personId && o.year === SWITCH_YEAR,
    );

  it("injects exactly one entry per (person, year) — no double-injection", () => {
    const all = payload.baseEngineInput.perPersonSalaryOverrides!.filter(
      (o) => o.year === SWITCH_YEAR,
    );
    // Two salary-pinned people; Casey pins only bonus terms, so nothing.
    expect(all).toHaveLength(2);
    expect(entriesFor(alexId)).toHaveLength(1);
    expect(entriesFor(blakeId)).toHaveLength(1);
  });

  it("injects NOTHING for a person whose salary resolves live", () => {
    // The presence invariant at the profile-switch site. Casey HAS an entry
    // in the profile — so `.has(personId)` is true for them — but pins only
    // bonus terms. Anything keying off entry presence rather than the
    // `salary` field specifically would inject a bogus override here.
    expect(entriesFor(caseyId)).toHaveLength(0);
  });

  it("injects each person's OWN value from the shared profile", () => {
    // Alex's row must not carry Blake's salary and vice versa.
    expect(entriesFor(alexId)[0]!.value).toBeCloseTo(
      ALEX_PROFILE_SALARY * Math.pow(1 + ALEX_RAISE, YEARS_OUT),
      6,
    );
    expect(entriesFor(blakeId)[0]!.value).toBeCloseTo(
      BLAKE_PROFILE_SALARY * Math.pow(1 + BLAKE_RAISE, YEARS_OUT),
      6,
    );
  });

  it("grows each person by their OWN raise rate, not the primary's", () => {
    // Blake's rate is 7%; growing by Alex's 3% (the old bug) would give a
    // materially smaller number, so this assertion is the real guard.
    const grownWithOwnRate =
      BLAKE_PROFILE_SALARY * Math.pow(1 + BLAKE_RAISE, YEARS_OUT);
    const grownWithPrimaryRate =
      BLAKE_PROFILE_SALARY * Math.pow(1 + ALEX_RAISE, YEARS_OUT);
    expect(grownWithOwnRate).not.toBeCloseTo(grownWithPrimaryRate, 2);
    expect(entriesFor(blakeId)[0]!.value).toBeCloseTo(grownWithOwnRate, 6);
  });
});
