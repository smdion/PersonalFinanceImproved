/**
 * The conversion variant, e2e-dc: screens-e2e D with Roth conversions on,
 * so a converting household reaches the engine through the server path.
 */
import type { Household } from "./seed";

/** e2e-d with a larger IRA: Sam holds Traditional and Roth parts, Alex a
 *  Traditional part only (Alex's Roth part is declared at $0). It converts
 *  to the 12% bracket, and RMD smoothing may raise that to 24%. */
export function conversionVariant(base: Household): Household {
  return {
    ...base,
    key: "e2e-dc",
    source: `${base.key} converting, with a larger IRA`,
    accounts: base.accounts.map((a) =>
      a.perf.accountType === "ira"
        ? {
            ...a,
            snapshot: [
              { ...a.snapshot[0]!, amount: "1600000" },
              a.snapshot[1]!,
              { ...a.snapshot[2]!, amount: "1000000" },
            ],
          }
        : a,
    ),
    returnRates: [[0, "0.06"]],
    settings: {
      ...base.settings,
      returnAfterRetirement: "0.05",
      enableRothConversions: true,
      rmdSmoothingEnabled: true,
      rmdSmoothingMaxBracketTarget: "0.24",
    },
  };
}
