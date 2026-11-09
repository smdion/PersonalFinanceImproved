/** Small builders the baseline households share. */
import type { SalaryEntry } from "@/lib/db/shapes/salary-entry-defaults";
import type { Household } from "./seed";

type Job = Household["jobs"][number];
type Account = Household["accounts"][number];
type Settings = Household["settings"];
type Category = NonNullable<Settings["withdrawalOrder"]>[number];

/** A job paid biweekly with no anchor date, unless the entry says more. */
export function job(
  key: string,
  person: string,
  employerName: string,
  startDate: string,
  entry: Partial<SalaryEntry>,
): Job {
  return { key, person, employerName, startDate, entry };
}

/** An account nobody pays into: one row per part in today's snapshot. */
export function heldAccount(
  key: string,
  perf: Account["perf"],
  snapshot: Account["snapshot"],
): Account {
  return { key, perf, snapshot, contrib: [] };
}

/** Budget lines: [category, subcategory, monthly, essential?]. */
export function budgetLines(
  lines: [string, string, number, boolean?][],
): Household["budget"] {
  return lines.map(([category, subcategory, monthly, essential = true]) => ({
    category,
    subcategory,
    monthly,
    essential,
  }));
}

/** The ledgers' settings: Fixed, waterfall in the given order, no Roth
 *  bracket target, no conversions. */
export function ledgerSettings(
  filingStatus: "Single" | "MFJ",
  returnAfterRetirement: string,
  annualInflation: string,
  salaryAnnualIncrease: string,
  withdrawalOrder: Category[],
): Settings {
  return {
    returnAfterRetirement,
    annualInflation,
    salaryAnnualIncrease,
    withdrawalRate: "0.04",
    filingStatus,
    withdrawalStrategy: "fixed",
    withdrawalRoutingMode: "waterfall",
    withdrawalOrder,
    rothBracketTarget: null,
    enableRothConversions: false,
  };
}

/** Settings for a household the review gave no strategy: the strategy is
 *  chosen per household so the baseline covers each of them. */
export function plainSettings(
  filingStatus: "Single" | "MFJ" | "HOH",
  withdrawalStrategy: NonNullable<Settings["withdrawalStrategy"]>,
  rates: {
    returnAfterRetirement: string;
    annualInflation: string;
    salaryAnnualIncrease: string;
  } = {
    returnAfterRetirement: "0.05",
    annualInflation: "0.03",
    salaryAnnualIncrease: "0.03",
  },
): Settings {
  return { ...rates, withdrawalRate: "0.04", filingStatus, withdrawalStrategy };
}
