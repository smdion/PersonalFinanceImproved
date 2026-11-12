/** The stored-JSON tag's Salary Profile entries, live and on restore: a
 *  root every reader reads as an object, retired keys gone, and the start
 *  refused for an entry the entry schema refuses. Rules: SALARY_ENTRIES_CONVERTER. */
// No import from migration-converters.ts, which registers this one.
import {
  BONUS_DESTINATION_VALUES,
  PAY_PERIOD_VALUES,
  PAY_WEEK_VALUES,
  SALARY_DIVISOR_VALUES,
} from "../../config/enum-values";
import { W4_FILING_STATUS_VALUES } from "../../config/filing-status";
import { isCalendarDate } from "../../utils/date";
import { ConverterRefusal } from "./converter-refusal";
import { withoutSnapshots } from "./v0106-net-pay-snapshot";
import { isRow, parsedJson, type Row, type Update } from "./converter-rows";
import {
  UNLISTED_KEY,
  arrayOf,
  isBoolean,
  isNumber,
  isText,
  nullable,
  numberIn,
  objectOf,
  oneOf,
  recordOf,
  refusedKeys,
  type Fields,
} from "./frozen-shape";

// Each closed set is its values as of this tag and the config's now: a
// value a later release adds is never refused, and one it retires is
// still read here until that release's own tag converts it.
const PAY_PERIODS = [
  ...["weekly", "biweekly", "semimonthly", "monthly"],
  ...PAY_PERIOD_VALUES,
];
const PAY_WEEKS = [...["even", "odd", "na"], ...PAY_WEEK_VALUES];
const W4_STATUSES = [...["MFJ", "Single", "HOH"], ...W4_FILING_STATUS_VALUES];
const BONUS_DESTINATIONS = [
  ...["budget", "spending"],
  ...BONUS_DESTINATION_VALUES,
];

/** Keys an entry once held that no reader reads (each contribution
 *  account's fromBonus holds what they said). Only ever grows. */
const RETIRED_KEYS: readonly string[] = [
  "include401kInBonus",
  "includeBonusInContributions",
];

/** A stored date the entry schema takes: its own check, read live. */
const isStoredDate = (value: unknown) =>
  typeof value === "string" && isCalendarDate(value);

const atLeastZero = numberIn(0);
const split = objectOf(
  {
    goalId: { check: numberIn(-Infinity, Infinity, true) },
    pct: { check: isNumber },
  },
  false,
);

// The routing's fields as of this tag; its pay period is PAY_PERIODS.
const ROUTING_FIELDS: Fields = {
  rules: {
    check: arrayOf(
      objectOf(
        {
          from: { check: isText },
          to: { check: nullable(isText) },
          splits: { check: arrayOf(split) },
        },
        false,
      ),
    ),
  },
  overrides: {
    check: arrayOf(
      objectOf(
        { month: { check: isText }, splits: { check: arrayOf(split) } },
        false,
      ),
    ),
    optional: true,
  },
  baseNetPayPerCheck: { check: isNumber, optional: true },
  baseYear: { check: isNumber, optional: true },
  yearlyGrowth: {
    check: recordOf(
      objectOf(
        {
          type: { check: oneOf(["pct", "dollar"]) },
          value: { check: isNumber },
        },
        false,
      ),
    ),
    optional: true,
  },
  payPeriod: { check: oneOf(PAY_PERIODS), optional: true },
  anchorPayDate: { check: nullable(isText), optional: true },
  enabled: { check: isBoolean, optional: true },
};

/** salaryEntrySchema's fields and checks as of this tag (shapes/json-
 *  schemas.ts): a test holds the live keys inside these, so they only grow. */
export const SALARY_ENTRY_FIELDS: Fields = {
  salary: { check: atLeastZero },
  bonusPercent: { check: atLeastZero },
  bonusMultiplier: { check: atLeastZero },
  monthsInBonusYear: { check: numberIn(0, 12) },
  bonusOverride: { check: nullable(atLeastZero) },
  payPeriod: { check: oneOf(PAY_PERIODS) },
  // A key a later release added: the config's values, optional.
  salaryDivisor: { check: oneOf(SALARY_DIVISOR_VALUES), optional: true },
  payWeek: { check: oneOf(PAY_WEEKS) },
  anchorPayDate: { check: nullable(isStoredDate) },
  budgetPeriodsPerMonth: {
    check: nullable((v) => isNumber(v) && Number(v) > 0),
  },
  w4FilingStatus: { check: oneOf(W4_STATUSES) },
  w4Box2cChecked: { check: isBoolean },
  additionalFedWithholding: { check: atLeastZero },
  bonusMonth: { check: nullable(numberIn(1, 12, true)) },
  bonusDayOfMonth: { check: nullable(numberIn(1, 31, true)) },
  extraPaycheckRouting: { check: nullable(objectOf(ROUTING_FIELDS, true)) },
  bonusDestination: { check: oneOf(BONUS_DESTINATIONS), optional: true },
  otherEarnings: {
    check: recordOf(atLeastZero, (k) => /^\d+$/.test(k)),
    optional: true,
  },
};

const ENTRY_KEYS: readonly string[] = Object.keys(SALARY_ENTRY_FIELDS);

const NOT_READABLE = "salary_entry_not_readable";

/** Its one refusal: ids and field names only. */
const REFUSALS = {
  [NOT_READABLE]: {
    problem:
      "Salary Profile entries hold a value or key the Salary Profile can't read",
    upgradeFix:
      "Start the previous version; in each listed Salary Profile, remove the job whose pay holds a listed field and add its pay again; then upgrade again.",
    restoreFix:
      "Restore it in the version that made it, do the same there, back it up again and restore that backup.",
    fields: ["salaries", UNLISTED_KEY, ...ENTRY_KEYS],
  },
} as const;

/** The root as an object, and whether to write it: a JSON null is `{}`, a
 *  JSON string of an object's text the object (both written); a backup row
 *  without the column takes its default. Null for any other root. */
function readRoot(
  raw: unknown,
): { salaries: Row; write: boolean; unwrapped: boolean } | null {
  if (raw === undefined)
    return { salaries: {}, write: false, unwrapped: false };
  const value = parsedJson(raw);
  if (value === null) return { salaries: {}, write: true, unwrapped: false };
  if (isRow(value)) return { salaries: value, write: false, unwrapped: false };
  if (typeof value !== "string") return null;
  const inner = parsedJson(value);
  return isRow(inner)
    ? { salaries: inner, write: true, unwrapped: true }
    : null;
}

/** A routing's rules without their saved net pay: on an unwrapped root
 *  nothing could read the profile, so its snapshots go with the unwrap. */
function unwrappedRouting(entry: Row): Row {
  const routing = entry["extraPaycheckRouting"];
  if (!isRow(routing) || !Array.isArray(routing["rules"])) return entry;
  return { ...entry, extraPaycheckRouting: withoutSnapshots(routing) };
}

/** The entries every reader reads: an entry for a job the install doesn't
 *  have goes (when its jobs were read), retired keys go, and an unwrapped
 *  root's snapshots go. `changed` when anything went. */
function tidied(
  salaries: Row,
  jobs: ReadonlySet<string> | null,
  unwrapped: boolean,
): { salaries: Row; changed: boolean } {
  let changed = false;
  const out: Row = {};
  for (const [jobId, entry] of Object.entries(salaries)) {
    if (jobs && !jobs.has(jobId)) {
      changed = true;
      continue;
    }
    if (!isRow(entry)) {
      out[jobId] = entry;
      continue;
    }
    let next: Row = entry;
    if (RETIRED_KEYS.some((k) => Object.hasOwn(entry, k))) {
      next = {};
      for (const [k, v] of Object.entries(entry))
        if (!RETIRED_KEYS.includes(k)) next[k] = v;
    }
    if (unwrapped) next = unwrappedRouting(next);
    out[jobId] = next;
    changed ||= next !== entry;
  }
  return { salaries: out, changed };
}

/** The entry fields this tag's entry shape refuses, as field names. */
export function refusedFields(salaries: Row): string[] {
  return Object.values(salaries).flatMap((entry) =>
    isRow(entry) ? refusedKeys(entry, SALARY_ENTRY_FIELDS, true) : ["salaries"],
  );
}

// Gated on structure (a root that isn't an object, a key from a fixed
// retired list, a job id the jobs table lacks) and a frozen schema check;
// each step is a projection, so a replay finds nothing.
export const SALARY_ENTRIES_CONVERTER = {
  tables: ["salary_profiles", "jobs"],
  runs: "afterSql",
  refusals: REFUSALS,
  convert: (
    tables: Readonly<Record<string, readonly unknown[] | undefined>>,
  ) => {
    const updates: Update[] = [];
    const refused: number[] = [];
    const fields: string[] = [];
    const jobRows = tables["jobs"];
    const jobs = jobRows
      ? new Set(jobRows.filter(isRow).map((j) => String(j["id"])))
      : null;
    for (const profile of (tables["salary_profiles"] ?? []).filter(isRow)) {
      const id = Number(profile["id"]);
      const root = readRoot(profile["salaries"]);
      if (!root) {
        refused.push(id);
        fields.push("salaries");
        continue;
      }
      const { salaries, changed } = tidied(root.salaries, jobs, root.unwrapped);
      const bad = refusedFields(salaries);
      if (bad.length > 0) {
        refused.push(id);
        fields.push(...bad);
        continue;
      }
      if (root.write || changed)
        updates.push({ table: "salary_profiles", id, set: { salaries } });
    }
    if (refused.length > 0)
      throw new ConverterRefusal(NOT_READABLE, { salary_profiles: refused }, [
        ...new Set(fields),
      ]);
    return {
      updates,
      notes: [
        `${updates.length} Salary Profiles' entries given an object root or cleared of retired keys and entries nothing reads`,
      ],
    };
  },
} as const;
