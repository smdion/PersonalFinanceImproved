/** The stress test: the projection re-run at the three canonical
 *  scenarios (conservative, baseline, optimistic). */

import { planEndAge } from "@/lib/pure/household/household-timeline";
import { assessPlan } from "@/lib/pure/retirement/plan-outcome";
import { calculateProjection } from "@/lib/pure/engine";
import { getStressTestScenarios } from "./stress-test";
import { roundToCents } from "@/lib/utils/math";

type ProjectionInput = Parameters<typeof calculateProjection>[0];

interface StressTestRunInput {
  // Narrow subset of the engine input, matching what buildEnginePayload
  // exposes. We intentionally type this loosely because it's spread into
  // calculateProjection with additional overrides below; TS can't see
  // through the spread, so we cast at the call boundary.
  baseEngineInput: Omit<
    ProjectionInput,
    "decumulationDefaults" | "accumulationOverrides" | "decumulationOverrides"
  >;
  /** The household's saved "Changes by year" (resolved by the caller);
   *  omitted = none. */
  accumulationOverrides?: ProjectionInput["accumulationOverrides"];
  decumulationOverrides?: ProjectionInput["decumulationOverrides"];
  /** Fully resolved by the caller (stress-test.ts) via the shared
   *  `buildDecumulationDefaults` (_shared.ts) — the household's real
   *  routing mode, RMD/QCD handling, discretionary order, and active
   *  strategy + params. Each scenario below overrides only
   *  `withdrawalRate` (its own controlled variable: conservative /
   *  baseline / optimistic each test a different rate); everything else
   *  is the household's actual plan, not a hardcoded one. Deliberately
   *  NOT built in this file — this helper
   *  isn't a router under `projection/`, so it doesn't import
   *  `buildDecumulationDefaults` itself; resolving in the router and
   *  passing the built object down keeps this a mechanical one-field
   *  override, same shape the existing tests already exercise. */
  decumulationDefaults: ProjectionInput["decumulationDefaults"];
}

interface StressTestScenarioResult {
  label: string;
  description: string;
  returnRate: number;
  inflationRate: number;
  salaryGrowthRate: number;
  withdrawalRate: number;
  nestEggAtRetirement: number;
  sustainableWithdrawal: number;
  /** First age the plan falls short (assessPlan), null if it holds. */
  failureAge: number | null;
}

/**
 * Run the three stress-test scenarios (conservative, baseline, optimistic)
 * against the user's plan. Each scenario overrides returnRates (flat
 * schedule at the scenario's nominal rate), inflationRate, salaryGrowthRate,
 * and withdrawalRate before calling calculateProjection.
 */
export function runStressTestScenarios(
  input: StressTestRunInput,
): StressTestScenarioResult[] {
  const { baseEngineInput, decumulationDefaults } = input;
  const stressScenarios = getStressTestScenarios();

  return stressScenarios.map((scenario) => {
    const flatReturnRates: { label: string; rate: number }[] = [];
    for (
      let a = baseEngineInput.currentAge;
      a <= planEndAge(baseEngineInput);
      a++
    ) {
      flatReturnRates.push({ label: `Age ${a}`, rate: scenario.returnRate });
    }

    const scenarioDecumulationDefaults = {
      ...decumulationDefaults,
      withdrawalRate: scenario.withdrawalRate,
    };

    const result = calculateProjection({
      ...baseEngineInput,
      returnRates: flatReturnRates,
      inflationRate: scenario.inflationRate,
      // The household's gap between the two rates stays, as in a Simulation.
      ...(baseEngineInput.postRetirementInflationRate != null
        ? {
            postRetirementInflationRate:
              scenario.inflationRate +
              baseEngineInput.postRetirementInflationRate -
              baseEngineInput.inflationRate,
          }
        : {}),
      salaryGrowthRate: scenario.salaryGrowthRate,
      salaryGrowthRateByPerson: undefined, // the scenario's rate, for everyone
      decumulationDefaults: scenarioDecumulationDefaults,
      // The household's saved "Changes by year" (D6).
      accumulationOverrides: input.accumulationOverrides ?? [],
      decumulationOverrides: input.decumulationOverrides ?? [],
    } as ProjectionInput);

    const retirementYear =
      baseEngineInput.retirementYear <= baseEngineInput.asOfDate.getFullYear()
        ? result.projectionByYear[0]
        : result.projectionByYear.find(
            (p) => p.year === baseEngineInput.retirementYear,
          );
    const nestEgg = retirementYear?.retirementBalance ?? 0;

    return {
      label: scenario.label,
      description: scenario.description,
      returnRate: scenario.returnRate,
      inflationRate: scenario.inflationRate,
      salaryGrowthRate: scenario.salaryGrowthRate,
      withdrawalRate: scenario.withdrawalRate,
      nestEggAtRetirement: roundToCents(nestEgg),
      sustainableWithdrawal: result.sustainableWithdrawal,
      failureAge: assessPlan(result).failureAge,
    };
  });
}
