/**
 * When the household's plan happens, from each person's own age and dates.
 * The one place that decides it: the engine input, the Salary Profile
 * switches, the simulation's horizon and the pages read this, so "when does
 * the plan retire" has one answer.
 *
 * - Ages count from the primary person. The plan's single return rate and
 *   the age on each projection year are theirs, so results depend on who is
 *   primary (the same anchor as the holdings glide path).
 * - Withdrawals start the year the last person with a job retires. Someone
 *   without a job has no pay to replace, so their retirement age doesn't
 *   hold the plan back or end anyone else's work. A job's own end date
 *   doesn't move it either: a job can end without its holder retiring.
 * - With no job in the plan, the last person's retirement year stands.
 * - The projection runs to the last person's end age.
 */
type TimelinePerson = {
  personId: number;
  birthYear: number;
  retirementAge: number;
  endAge: number;
};

type HouseholdTimeline = {
  /** The primary person's age in the plan's first year. */
  currentAge: number;
  /** The first year of withdrawals. */
  retirementYear: number;
  /** The year the projection runs to. */
  projectionEndYear: number;
  /** Each earner's own retirement year; empty with no earners. */
  retirementYearByPerson: Record<number, number>;
};

/** The first year of withdrawals: the last earner's own retirement year,
 *  or the last person's with no earners. */
export function planRetirementYear(
  people: readonly {
    personId: number;
    birthYear: number;
    retirementAge: number;
  }[],
  earnerIds: readonly number[],
): number {
  const earners = people.filter((p) => earnerIds.includes(p.personId));
  return Math.max(
    ...(earners.length > 0 ? earners : people).map(
      (p) => p.birthYear + p.retirementAge,
    ),
  );
}

export function householdTimeline(input: {
  people: readonly TimelinePerson[];
  primaryPersonId: number;
  /** People with a job in the plan. */
  earnerIds: readonly number[];
  /** The plan's first calendar year. */
  baseYear: number;
}): HouseholdTimeline {
  const { people, primaryPersonId, earnerIds, baseYear } = input;
  const primary =
    people.find((p) => p.personId === primaryPersonId) ?? people[0];
  if (!primary) throw new Error("householdTimeline needs at least one person");
  return {
    currentAge: baseYear - primary.birthYear,
    retirementYear: planRetirementYear(people, earnerIds),
    projectionEndYear: Math.max(...people.map((p) => p.birthYear + p.endAge)),
    retirementYearByPerson: Object.fromEntries(
      people
        .filter((p) => earnerIds.includes(p.personId))
        .map((p) => [p.personId, p.birthYear + p.retirementAge]),
    ),
  };
}

type PlanYears = {
  asOfDate: Date;
  currentAge: number;
  retirementYear: number;
  projectionEndYear: number;
};

/** A calendar year as the plan's age (the primary person's). */
export function planAgeInYear(plan: PlanYears, year: number): number {
  return plan.currentAge + (year - plan.asOfDate.getFullYear());
}

/** The plan's age when withdrawals start. Not anyone's retirement setting:
 *  in a couple it can be years past the primary person's own. */
export function planRetirementAge(plan: PlanYears): number {
  return planAgeInYear(plan, plan.retirementYear);
}

/** The plan's age in its last year. */
export function planEndAge(plan: PlanYears): number {
  return planAgeInYear(plan, plan.projectionEndYear);
}

/** The calendar year of a plan age, from the plan's first row. */
export function yearOfPlanAge(
  first: { year: number; age: number },
  age: number,
): number {
  return first.year + age - first.age;
}

/** A plan age for reading: the year, and whose age it is, since an age means
 *  something different for each person. "2035 (Sean, 48)". */
export function planAgeLabel(
  first: { year: number; age: number },
  primaryName: string | undefined,
  age: number,
): string {
  const year = yearOfPlanAge(first, age);
  return primaryName ? `${year} (${primaryName}, ${age})` : String(year);
}
