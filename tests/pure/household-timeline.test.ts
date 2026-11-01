import { describe, expect, it } from "vitest";
import {
  householdTimeline,
  planAgeInYear,
  planEndAge,
  planRetirementAge,
  planRetirementYear,
} from "@/lib/pure/household-timeline";

/** Fictional households: the timeline must handle any of them. */
const person = (
  personId: number,
  birthYear: number,
  retirementAge = 65,
  endAge = 95,
) => ({ personId, birthYear, retirementAge, endAge });

const timeline = (
  people: ReturnType<typeof person>[],
  earnerIds: number[],
  primaryPersonId = 1,
) => householdTimeline({ people, primaryPersonId, earnerIds, baseYear: 2026 });

describe("householdTimeline", () => {
  it("one person: their own age and dates", () => {
    const t = timeline([person(1, 1980, 60, 90)], [1]);
    expect(t).toMatchObject({
      currentAge: 46,
      retirementYear: 2040,
      projectionEndYear: 2070,
    });
  });

  it("two earners, same retirement age, four years apart: each keeps their own year", () => {
    const t = timeline([person(1, 1987, 55), person(2, 1991, 55)], [1, 2]);
    expect(t.currentAge).toBe(39);
    expect(t.retirementYear).toBe(2046);
    expect(t.retirementYearByPerson).toEqual({ 1: 2042, 2: 2046 });
  });

  it("different retirement ages: the last earner's year, not the highest age", () => {
    const t = timeline([person(1, 1960, 70), person(2, 1990, 55)], [1, 2]);
    expect(t.retirementYear).toBe(2045);
  });

  it("an earner isn't stopped early by a jobless spouse's younger retirement age", () => {
    const t = timeline([person(1, 1980, 65), person(2, 1980, 55)], [1]);
    expect(t.retirementYear).toBe(2045);
  });

  it("a jobless spouse's later date doesn't hold the plan in accumulation", () => {
    const t = timeline([person(1, 1980, 60), person(2, 1990, 70)], [1]);
    expect(t.retirementYear).toBe(2040);
    expect(t.retirementYearByPerson).toEqual({ 1: 2040 });
  });

  it("the earner needn't be the primary person", () => {
    const t = timeline([person(1, 1980, 60), person(2, 1985, 60)], [2], 1);
    expect(t.currentAge).toBe(46);
    expect(t.retirementYear).toBe(2045);
  });

  it("a younger primary person anchors the ages", () => {
    const t = timeline([person(1, 1995), person(2, 1975)], [1, 2], 1);
    expect(t.currentAge).toBe(31);
  });

  it("no jobs: the last person's own retirement year", () => {
    const t = timeline([person(1, 1980, 60), person(2, 1985, 60)], []);
    expect(t.retirementYear).toBe(2045);
    expect(t.retirementYearByPerson).toEqual({});
  });

  it("different end ages: the last person's end", () => {
    const t = timeline(
      [person(1, 1980, 65, 100), person(2, 1990, 65, 85)],
      [1],
    );
    expect(t.projectionEndYear).toBe(2080);
  });

  it("three people: one rule", () => {
    const t = timeline(
      [person(1, 1970, 60), person(2, 1972, 60), person(3, 2000, 40)],
      [1, 2, 3],
    );
    expect(t.retirementYear).toBe(2040);
  });

  it("already retired: a year in the past", () => {
    const t = timeline([person(1, 1950, 65)], [1]);
    expect(t.retirementYear).toBe(2015);
  });

  it("an unknown primary falls back to the first person", () => {
    const t = timeline([person(1, 1980), person(2, 1990)], [1, 2], 99);
    expect(t.currentAge).toBe(46);
  });
});

describe("planRetirementYear", () => {
  it("matches the timeline", () => {
    const people = [person(1, 1987, 55), person(2, 1991, 55)];
    expect(planRetirementYear(people, [1, 2])).toBe(
      timeline(people, [1, 2]).retirementYear,
    );
  });
});

describe("plan ages", () => {
  const plan = {
    asOfDate: new Date(2026, 5, 1),
    currentAge: 39,
    retirementYear: 2046,
    projectionEndYear: 2086,
  };
  it("reads years on the primary person's scale", () => {
    expect(planAgeInYear(plan, 2030)).toBe(43);
    expect(planRetirementAge(plan)).toBe(59);
    expect(planEndAge(plan)).toBe(99);
  });
});
