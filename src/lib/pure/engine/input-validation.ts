/**
 * Engine input validation: the warnings a run starts with, and the rates it
 * clamps before the year loop reads them.
 */
import type { ProjectionInput } from "./types/projection-result";
import { formatPercent } from "../../utils/percent";
import { MAX_INFLATION_RATE, MIN_INFLATION_RATE } from "../../constants";

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
  // A NaN age would read as "nobody 65+" and turn on the ACA logic.
  const ages = [input.currentAge, ...(input.perPersonBirthYears ?? [])];
  if (!ages.every(Number.isFinite))
    throw new Error("A person's age or birth year is not a number");
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
