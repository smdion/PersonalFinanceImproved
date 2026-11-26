/**
 * A synthetic account type, added to the config object for the length of a
 * call: a brokerage-like entry with its own label and chart colours, and a
 * two-year household with all its money in it.
 */
import {
  ACCOUNT_TYPE_CONFIG,
  buildCategoryRecord,
} from "@/lib/config/account-types";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import { engineHouseholdFixture } from "./answer-key-household";
import { engineInput } from "../pure/fixtures/engine-input";
import { makeAccumulationDefaults } from "../pure/fixtures/engine-fixtures";

export const SYNTHETIC_CATEGORY = "synthetic-test-category";

/** A brokerage-like entry with its own label and chart colours. */
const SYNTHETIC_ENTRY = {
  ...ACCOUNT_TYPE_CONFIG.brokerage,
  displayLabel: "Synthetic Plan",
  chartHex: { standard: "#123456", roth: "#654321" },
};

export function withSyntheticCategory<T>(fn: () => T): T {
  const config = ACCOUNT_TYPE_CONFIG as Record<string, unknown>;
  config[SYNTHETIC_CATEGORY] = { ...SYNTHETIC_ENTRY };
  try {
    return fn();
  } finally {
    delete config[SYNTHETIC_CATEGORY];
  }
}

/** A household working in 2026 and retired in 2027, with all its money in
 *  the synthetic category: contributions and withdrawals both go there. */
export function twoYearHousehold(): ProjectionInput {
  const input = engineHouseholdFixture({
    status: "Single",
    people: [{ birthYear: 1961, job: { salary: 100_000, lastYear: 2026 } }],
    spending: 40_000,
    // The end year itself isn't run (RULES Known Gaps), so 2028 gives two.
    endYear: 2028,
  });
  const only = () => {
    const record = buildCategoryRecord(() => 0);
    Reflect.set(record, SYNTHETIC_CATEGORY, 1);
    return record;
  };
  input.accumulationDefaults = makeAccumulationDefaults({
    contributionRate: 0.1,
    routingMode: "percentage",
    accountSplits: only(),
    taxSplits: {},
  });
  input.decumulationDefaults.withdrawalOrder = [];
  Reflect.set(
    input.decumulationDefaults.withdrawalOrder,
    0,
    SYNTHETIC_CATEGORY,
  );
  input.decumulationDefaults.withdrawalSplits = only();
  Reflect.set(input.startingAccountBalances, SYNTHETIC_CATEGORY, {
    structure: "basis_tracking",
    balance: 500_000,
    basis: 500_000,
  });
  input.startingBalances.afterTax += 500_000;
  input.startingBalances.afterTaxBasis += 500_000;
  return engineInput(input);
}
