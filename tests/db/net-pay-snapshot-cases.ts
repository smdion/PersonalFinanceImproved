/**
 * Invented Salary Profiles for the extra-paycheck snapshot shape (money
 * tag, v0106-net-pay-snapshot.ts): each routing as stored, as the shape
 * leaves it, and the ones it refuses, for the restore step and both
 * migrators.
 */
import { projectedNetPay } from "@/lib/pure/paycheck/net-pay-growth";
import { isExtraPaycheckBudgetMode } from "@/lib/pure/paycheck/extra-paycheck-months";
import { BLANK_SALARY_ENTRY } from "@/lib/db/shapes/salary-entry-defaults";

type Routing = Record<string, unknown>;
const rule = (from: string, to: string | null, snapshot?: number) => ({
  from,
  to,
  splits: [{ goalId: 1, pct: 100 }],
  ...(snapshot === undefined ? {} : { netPaySnapshot: snapshot }),
});
/** A complete entry (the stored-JSON tag refuses a partial one). */
const entry = (routing?: Routing) => ({
  ...BLANK_SALARY_ENTRY,
  salary: 90000,
  bonusPercent: 0,
  ...(routing ? { extraPaycheckRouting: routing } : {}),
});
const strip = (r: Routing) => ({
  ...r,
  rules: (r["rules"] as Record<string, unknown>[]).map(
    ({ netPaySnapshot: _gone, ...rest }) => rest,
  ),
});

const WITH_BASE: Routing = {
  rules: [rule("2026-01", "2026-06", 1800), rule("2026-07", null, 1900)],
  baseNetPayPerCheck: 2000,
  baseYear: 2026,
  yearlyGrowth: { 2027: { type: "pct", value: 3 } },
};
const BUDGET_MODE: Routing = {
  rules: [rule("2026-01", null, 1700)],
  enabled: false,
};
const NO_SNAPSHOT: Routing = { rules: [rule("2026-01", null)] };
/** Savings mode, no base: pays the snapshot. */
export const REFUSED_ROUTING: Routing = {
  rules: [rule("2026-01", null, 1777.77)],
};
const REFUSED_ZERO: Routing = {
  rules: [rule("2026-01", null, 0)],
  enabled: true,
};

export type ProfileCase = { id: number; before: unknown; after: unknown };

/** The jobs the routings belong to (person 1): open, ended in the future,
 *  ended in the past, speculative. Key "99" names no job. */
export const JOBS = [
  ...[10, 11, 12, 13, 21].map((id) => ({ id, end_date: null })),
  { id: 22, end_date: "2099-12-31" },
  { id: 31, end_date: "2020-01-31" },
].map((j) => ({
  ...j,
  person_id: 1,
  employer_name: `Invented ${j.id}`,
  start_date: "2015-01-01",
  is_speculative: false,
}));
export const SPECULATIVE_JOB = {
  id: 30,
  person_id: 1,
  employer_name: "Invented 30",
  start_date: "2015-01-01",
  end_date: null,
  is_speculative: true,
};
const ALL_JOBS = [...JOBS, SPECULATIVE_JOB];
/** The jobs the savings materializer may walk (it skips a speculative one). */
const WALKED = new Set(
  ALL_JOBS.filter((j) => !j.is_speculative).map((j) => String(j.id)),
);

/** Converted or left alone: none refused. */
export const PROFILES: ProfileCase[] = [
  {
    id: 101,
    before: {
      "10": entry(WITH_BASE),
      "11": entry(BUDGET_MODE),
      "12": entry(),
      "13": entry(NO_SNAPSHOT),
      // Savings mode, no base, but no materializer walks these jobs.
      "30": entry(REFUSED_ROUTING),
      "99": entry(REFUSED_ROUTING),
    },
    after: {
      "10": entry(strip(WITH_BASE)),
      "11": entry(strip(BUDGET_MODE)),
      "12": entry(),
      "13": entry(NO_SNAPSHOT),
      "30": entry(strip(REFUSED_ROUTING)),
      "99": entry(strip(REFUSED_ROUTING)),
    },
  },
  // Already converted, and an empty profile: untouched.
  {
    id: 102,
    before: { "10": entry(strip(WITH_BASE)) },
    after: { "10": entry(strip(WITH_BASE)) },
  },
  { id: 103, before: {}, after: {} },
];

/** Refused, beside convertible ones: profile ids and job ids only. */
export const REFUSED: ProfileCase[] = [
  {
    id: 107,
    before: { "21": entry(REFUSED_ROUTING), "10": entry(WITH_BASE) },
    after: null,
  },
  // A job ending in the future still pays it.
  { id: 108, before: { "22": entry(REFUSED_ZERO) }, after: null },
  // So may one whose end date has passed: that takes today's date, which a
  // migration doesn't read.
  { id: 109, before: { "31": entry(REFUSED_ROUTING) }, after: null },
];
export const REFUSED_IDS = {
  salary_profiles: [107, 108, 109],
  jobs: [21, 22, 31],
};
/** A stored value the refusal must never print. */
export const SECRET_VALUE = "1777.77";

/**
 * What every reader reads of a routing: the mode, the base pay (absent,
 * a number), the growth, and each rule's net pay per month as the savings
 * materializer paid it before the tag (`base ?? rule.netPaySnapshot ?? 0`,
 * frozen here), for the months 2026-01 to 2028-12.
 */
export function routingReads(routing: Routing) {
  const rules = routing["rules"] as Record<string, unknown>[];
  const base = routing["baseNetPayPerCheck"] as number | undefined;
  const growth = (routing["yearlyGrowth"] ?? {}) as Record<
    number,
    { type: "pct" | "dollar"; value: number }
  >;
  const budgetMode = isExtraPaycheckBudgetMode(
    routing as { rules?: unknown[]; enabled?: boolean },
  );
  const months: (number | null)[] = [];
  for (let y = 2026; y <= 2028; y++)
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const r = rules.find(
        (x) =>
          (x["from"] as string) <= key &&
          (x["to"] === null || key <= (x["to"] as string)),
      );
      months.push(
        budgetMode || !r
          ? null
          : base !== undefined
            ? projectedNetPay(
                base,
                y,
                (routing["baseYear"] as number) ?? 2026,
                growth,
              )
            : ((r["netPaySnapshot"] as number | undefined) ?? 0),
      );
    }
  return { budgetMode, base, growth: routing["yearlyGrowth"], months };
}

/** Every routing's reads in a profile's salaries, by job id. */
export function profileReads(salaries: unknown) {
  const out: Record<string, unknown> = {};
  for (const [job, e] of Object.entries(salaries as Record<string, Routing>)) {
    const routing = e["extraPaycheckRouting"] as Routing | undefined;
    // A job the materializer never walks reads nothing.
    out[job] = routing && WALKED.has(job) ? routingReads(routing) : null;
  }
  return out;
}
