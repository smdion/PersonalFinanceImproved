/**
 * Engine input validation: the warnings a run starts with, and the rates it
 * clamps before the year loop reads them.
 */
import type { ProjectionInput } from "./types/projection-result";
import { formatPercent } from "../../utils/percent";
import { MAX_INFLATION_RATE, MIN_INFLATION_RATE } from "../../constants";
import {
  getAccountTypeConfig,
  isTaxFreeBucket,
} from "../../config/account-types";
import { emptyTaxBucketMap } from "../../config/tax-treatment-buckets";

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
  // chosen account that no longer qualifies) — shown with the result's.
  warnings.push(...(input.inputWarnings ?? []));
  // The aggregate buckets, the per-category balances (what withdrawal
  // routing draws from) and the individual accounts must describe the same
  // money: a gap is counted as retirement money the router may never
  // reach, which moves withdrawals, depletion and the plan's verdict.
  const categoryTotals = emptyTaxBucketMap();
  for (const balance of Object.values(input.startingAccountBalances)) {
    if (balance.structure === "roth_traditional") {
      categoryTotals.preTax += balance.traditional;
      categoryTotals.taxFree += balance.roth;
    } else if (balance.structure === "single_bucket")
      categoryTotals.hsa += balance.balance;
    else categoryTotals.afterTax += balance.balance;
  }
  for (const [key, sum] of Object.entries(categoryTotals)) {
    const start = input.startingBalances[key as keyof typeof categoryTotals];
    if (Math.abs(sum - start) > 1)
      warnings.push(
        `[DIAG] starting balances: ${key} is $${start.toFixed(2)} but the account categories hold $${sum.toFixed(2)}`,
      );
  }
  if (input.individualAccounts?.length) {
    const byBucket = emptyTaxBucketMap();
    for (const ia of input.individualAccounts) {
      const key = isTaxFreeBucket(ia.taxType)
        ? "taxFree"
        : getAccountTypeConfig(ia.category).taxBucketKey;
      if (key in byBucket)
        byBucket[key as keyof typeof byBucket] += ia.startingBalance;
    }
    for (const [key, sum] of Object.entries(byBucket)) {
      const start = input.startingBalances[key as keyof typeof byBucket];
      if (Math.abs(sum - start) > 1)
        warnings.push(
          `[DIAG] starting balances: ${key} is $${start.toFixed(2)} but the accounts hold $${sum.toFixed(2)}`,
        );
    }
  }
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
