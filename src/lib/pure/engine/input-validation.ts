/**
 * Engine input validation: the warnings a run starts with, and the rates it
 * clamps before the year loop reads them.
 */
import type { ProjectionInput } from "./types/projection-result";
import { formatPercent } from "../../utils/percent";
import { MAX_INFLATION_RATE, MIN_INFLATION_RATE } from "../../constants";
import { bookedTaxType } from "../../config/tax-treatment-buckets";

/**
 * Validate and clamp engine inputs. Pushes warnings for any clamped values.
 * Returns sanitized copies of fields that may need clamping.
 */
export function validateEngineInputs(
  input: ProjectionInput,
  warnings: string[],
): {
  salaryGrowthRate: number;
  inflationRate: number;
  postRetirementInflationRate: number;
} {
  // Setup notes the caller resolved while building the input (e.g. a
  // chosen account that doesn't qualify) — shown with the result's.
  warnings.push(...(input.inputWarnings ?? []));
  // The opening parts are the starting money: the engine has nothing to
  // start from without them (synthetic parts stand in for no account).
  if (input.individualAccounts.length === 0)
    throw new Error("The engine input has no account parts to start from");
  // Parts arrive booked: each part's tax type is its category's own.
  for (const ia of input.individualAccounts) {
    const booked = bookedTaxType(ia.category, ia.taxType);
    if (booked !== ia.taxType)
      throw new Error(
        `Part "${ia.name}" (${ia.category}) has tax type "${ia.taxType}", which its account type books as "${booked}"`,
      );
  }
  // A NaN age would read as "nobody 65+" and turn on the ACA logic.
  const ages = [input.currentAge, ...(input.perPersonBirthYears ?? [])];
  if (!ages.every(Number.isFinite))
    throw new Error("A person's age or birth year is not a number");
  validateOneBirthYearPerPerson(input);
  let { salaryGrowthRate, inflationRate } = input;
  let postRetirementInflationRate =
    input.postRetirementInflationRate ?? inflationRate;

  if (salaryGrowthRate < -1) {
    warnings.push(
      `Salary growth rate clamped from ${formatPercent(salaryGrowthRate, 1)} to -100%`,
    );
    salaryGrowthRate = -1;
  }

  if (inflationRate > MAX_INFLATION_RATE) {
    warnings.push(
      `Inflation rate clamped from ${formatPercent(inflationRate, 1)} to ${formatPercent(MAX_INFLATION_RATE)}`,
    );
    inflationRate = MAX_INFLATION_RATE;
  } else if (inflationRate < MIN_INFLATION_RATE) {
    warnings.push(
      `Inflation rate clamped from ${formatPercent(inflationRate, 1)} to ${formatPercent(MIN_INFLATION_RATE)}`,
    );
    inflationRate = MIN_INFLATION_RATE;
  }

  if (postRetirementInflationRate > MAX_INFLATION_RATE) {
    warnings.push(
      `Post-retirement raise rate clamped to ${formatPercent(MAX_INFLATION_RATE)}`,
    );
    postRetirementInflationRate = MAX_INFLATION_RATE;
  } else if (postRetirementInflationRate < MIN_INFLATION_RATE) {
    warnings.push(
      `Post-retirement raise rate clamped to ${formatPercent(MIN_INFLATION_RATE)}`,
    );
    postRetirementInflationRate = MIN_INFLATION_RATE;
  }

  if (input.returnRates.length === 0) {
    warnings.push("No return rates configured — investment growth will be 0%");
  }

  if (
    input.contributionSpecs &&
    input.contributionSpecs.length > 0 &&
    input.contributionSpecs.every((s) => s.baseAnnual === 0 && s.value === 0)
  ) {
    warnings.push("All contribution accounts have $0 contributions configured");
  }

  return { salaryGrowthRate, inflationRate, postRetirementInflationRate };
}

/** A person's birth year is the one in `people`: every account owner is one of
 *  them, `currentAge` is the primary's (`primaryPersonId`, else the first) in
 *  the as-of year, and `perPersonBirthYears`, when sent, holds the same years. */
function validateOneBirthYearPerPerson(input: ProjectionInput): void {
  const { people } = input;
  const ids = new Set(people.map((p) => p.personId));
  for (const ia of input.individualAccounts)
    if (ia.ownerPersonId != null && !ids.has(ia.ownerPersonId))
      throw new Error(
        `Account "${ia.name}" names owner ${ia.ownerPersonId}, who isn't among the household's people`,
      );
  const primary =
    input.primaryPersonId == null
      ? people[0]
      : people.find((p) => p.personId === input.primaryPersonId);
  if (!primary) throw new Error("The engine input names no primary person");
  const primaryAge = input.asOfDate.getFullYear() - primary.birthYear;
  if (input.currentAge !== primaryAge)
    throw new Error(
      `currentAge ${input.currentAge} disagrees with person ${primary.personId}'s birth year ${primary.birthYear} (age ${primaryAge})`,
    );
  const sent = input.perPersonBirthYears;
  const sorted = (years: readonly number[]) => [...years].sort((a, b) => a - b);
  const expected = sorted(people.map((p) => p.birthYear));
  if (sent && sorted(sent).join() !== expected.join())
    throw new Error(
      `perPersonBirthYears ${sent.join(", ")} disagree with the people's birth years ${expected.join(", ")}`,
    );
}
