/**
 * Invented Salary Profiles for the salary entries shape (stored-JSON tag,
 * v0106-salary-entries.ts): each `salaries` root as stored, as the shape
 * stores it, and the ones it refuses, for the restore step and both
 * migrators.
 */
import { BLANK_SALARY_ENTRY } from "@/lib/db/shapes/salary-entry-defaults";
import { checkSalaryEntries } from "@/lib/db/stored-salary-entries";

/** A complete entry: every field the entry schema requires. */
export const complete = (fields: Record<string, unknown> = {}) => ({
  ...BLANK_SALARY_ENTRY,
  salary: 91_000,
  bonusPercent: 0.1,
  ...fields,
});

const ROUTING = {
  rules: [{ from: "2026-01", to: null, splits: [{ goalId: 1, pct: 100 }] }],
  baseNetPayPerCheck: 2100,
  enabled: true,
};
const WHOLE = {
  "10": complete(),
  "11": complete({
    payPeriod: "semimonthly",
    bonusDestination: "spending",
    otherEarnings: { "3": 120 },
    extraPaycheckRouting: ROUTING,
    anchorPayDate: "2026-01-09",
  }),
};

const rule = (snapshot?: number) => ({
  from: "2026-01",
  to: null,
  splits: [{ goalId: 1, pct: 100 }],
  ...(snapshot === undefined ? {} : { netPaySnapshot: snapshot }),
});
/** A string root's routings go through the money tag's snapshot rule. */
const SNAPSHOT_WITH_BASE = {
  "10": complete({
    extraPaycheckRouting: { rules: [rule(1800)], baseNetPayPerCheck: 2000 },
  }),
};
/** The person the cases' jobs belong to. */
export const SNAPSHOT_PERSON = {
  id: 1,
  name: "Invented",
  is_primary_user: true,
};
/** The jobs the cases' entries are for (an entry for any other job is
 *  read by nothing). */
export const JOBS = [10, 11].map((id) => ({
  id,
  person_id: 1,
  employer_name: `Invented ${id}`,
  start_date: "2015-01-01",
  is_speculative: false,
}));
/** Savings mode, no base: on a string root, read by nothing before, the
 *  snapshot goes with the unwrap. */
export const SNAPSHOT_PAID: SalaryCase = {
  id: 308,
  before: JSON.stringify({
    "10": complete({ extraPaycheckRouting: { rules: [rule(1777.77)] } }),
  }),
  after: { "10": complete({ extraPaycheckRouting: { rules: [rule()] } }) },
};

export type SalaryCase = {
  id: number;
  /** The root as a JSON value: a string is a root stored as a JSON string
   *  (SQLite's text `"{…}"`, a PostgreSQL string scalar). */
  before: unknown;
  after: unknown;
};

/** Converted or left alone: none refused. */
export const PROFILES: SalaryCase[] = [
  // Already readable: untouched.
  { id: 201, before: WHOLE, after: WHOLE },
  { id: 202, before: {}, after: {} },
  // A JSON null reads as no entries: stored as {}.
  { id: 203, before: null, after: {} },
  // A root stored as a JSON string of an object: the object (a fix: it
  // read as no salaries).
  { id: 204, before: JSON.stringify(WHOLE), after: WHOLE },
  // Retired keys go; the rest stays as stored.
  {
    id: 205,
    before: {
      "10": complete({ include401kInBonus: true }),
      "11": complete({
        includeBonusInContributions: false,
        include401kInBonus: false,
      }),
    },
    after: { "10": complete(), "11": complete() },
  },
  // A string root's routings lose their snapshots.
  {
    id: 206,
    before: JSON.stringify(SNAPSHOT_WITH_BASE),
    after: {
      "10": complete({
        extraPaycheckRouting: { rules: [rule()], baseNetPayPerCheck: 2000 },
      }),
    },
  },
  // An entry for a job the install doesn't have goes.
  { id: 207, before: { ...WHOLE, "99": complete() }, after: WHOLE },
  SNAPSHOT_PAID,
];

/** The ids the converter writes. */
export const WRITTEN = [203, 204, 205, 206, 207, 308];

export const SECRET_VALUE = 123_456.78;

/** Refused, each alone and all together. */
export const REFUSED: SalaryCase[] = [
  { id: 301, before: [complete()], after: null },
  { id: 302, before: 42, after: null },
  { id: 303, before: JSON.stringify(JSON.stringify(WHOLE)), after: null },
  {
    id: 304,
    before: { "10": complete({ payPeriod: "fortnightly" }) },
    after: null,
  },
  {
    id: 305,
    before: { "10": complete({ salary: SECRET_VALUE, oldBonusRule: 1 }) },
    after: null,
  },
  {
    id: 306,
    before: { "10": complete({ anchorPayDate: "0002-01-09" }) },
    after: null,
  },
  {
    id: 307,
    before: { "10": { salary: SECRET_VALUE, bonusPercent: 0 } },
    after: null,
  },
];

export const REFUSED_FIELDS = [
  "salaries",
  "payPeriod",
  "unlistedKey",
  "anchorPayDate",
];

/** The entries a reader reads: an existing job's, without the retired keys,
 *  which nothing reads. */
const withoutRetired = (read: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(read)
      .filter(([job]) => JOBS.some((j) => String(j.id) === job))
      .map(([job, entry]) => {
        const rest: Record<string, unknown> = Object.assign({}, entry);
        delete rest["include401kInBonus"];
        delete rest["includeBonusInContributions"];
        return [job, rest];
      }),
  );

/** What the readers read after the tag, without the retired keys, which
 *  nothing reads. */
export function profileReads(salaries: unknown): unknown {
  return withoutRetired(
    checkSalaryEntries({
      id: 1,
      salaries: salaries as Record<string, never>,
    }).salaries,
  );
}

/** What they read before it (checkSalaryEntries then): a JSON null as no
 *  entries, any other object root as stored. */
export function profileReadsBeforeTag(salaries: unknown): unknown {
  if (salaries === null) return {};
  return withoutRetired(salaries as Record<string, unknown>);
}
