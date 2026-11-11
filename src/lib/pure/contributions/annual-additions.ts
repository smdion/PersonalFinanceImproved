/** The annual-additions limit (IRC 415(c)), applied per employer: a plan row's employer. */
import {
  categoriesWithIrsLimit,
  getAccountTypeConfig,
  getLimitGroup,
} from "@/lib/config/account-types";
import { resolveIrsLimit } from "./irs-limits";
import { ageInYear } from "@/lib/utils/date";
import { sumBy } from "@/lib/utils/math";
import { isAlreadyIn } from "./already-in";
import type {
  CapContext,
  CapRow,
  PlanEmployer,
} from "./contribution-caps.types";

type JobPay = {
  job: { id: number };
  salary: number;
  totalComp?: number;
  /** The job ended before the date: its plan's money is already in. */
  ended?: true;
};

/** A job's gross pay for the year: salary + bonus when known, else salary. */
export const jobPay = (js: JobPay) => js.totalComp ?? js.salary;

/** The employer of a row at `jobId` (none for a row with no job), with that job's pay and whether
 *  it ended before the date. */
export function planEmployer(
  jobId: number | null,
  jobSalaries: readonly JobPay[],
): PlanEmployer | undefined {
  if (jobId === null) return undefined;
  const js = jobSalaries.find((s) => s.job.id === jobId);
  return {
    key: jobId,
    pay: js ? jobPay(js) : null,
    ...(js?.ended ? { ended: true as const } : {}),
  };
}

/** The 415(c) keys of a plan type (its annual-additions limit), or undefined when it has none. */
function additionsKeys(type: string) {
  const category = categoriesWithIrsLimit().find((c) => c === type);
  const keys = category && getAccountTypeConfig(category).irsLimitKeys;
  return keys?.totalAdditions
    ? { ...keys, totalAdditions: keys.totalAdditions }
    : undefined;
}

/** The person's catch-up for a plan type at their Dec 31 age; unknown age: the largest any age gets. */
function catchupFor(
  type: string,
  birthYear: number | null,
  ctx: CapContext,
): number {
  const keys = additionsKeys(type)!;
  if (birthYear !== null)
    return (
      resolveIrsLimit(
        type,
        ageInYear(birthYear, ctx.taxYear),
        null,
        ctx.limits,
      ) - ctx.limits[keys.base]!
    );
  const amounts = [keys.catchup, keys.superCatchup].flatMap((k) =>
    k && ctx.limits[k] !== undefined ? [ctx.limits[k]] : [],
  );
  return Math.max(0, ...amounts);
}

/** The cap pass's running figures by row index: employee money kept, its factor on the configured
 *  amount, and the person's most in the row's limit group (null = no bound). */
type PassState = {
  kept: number[];
  factorOf: number[];
  maxOf: (number | null)[];
};

const BISECT_STEPS = 60;

/** Largest d in [0, hi] with fits(d), for fits true→false as d grows (fits(0) holds). */
function largestFit(hi: number, fits: (d: number) => boolean): number {
  if (fits(hi)) return hi;
  let lo = 0;
  for (let k = 0; k < BISECT_STEPS; k++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** 415(c) per person per employer, after 402(g): deferrals + employer money within min(limit, pay);
 *  the rest is catch-up up to what's left of it and pay less other deferrals (414(v)(3)(A),
 *  (v)(2)(A)(ii)). Only employee money is cut; an ended job's plan goes first and is never cut. */
export function holdToAnnualAdditions(
  rows: readonly CapRow[],
  ctx: CapContext,
  state: PassState,
): void {
  const plans = new Map<string, number[]>();
  rows.forEach((r, i) => {
    if (!additionsKeys(r.accountType) || r.personId === null || !r.employer)
      return;
    const at = `${r.personId}:${r.employer.key}`;
    plans.set(at, [...(plans.get(at) ?? []), i]);
  });
  const catchupLeft = new Map<number, number>();
  // A plan is one employer's rows (one job), so its first row says whether it ended.
  const endedFirst = [...plans.values()].sort(
    (a, b) =>
      Number(isAlreadyIn(rows[b[0]!]!)) - Number(isAlreadyIn(rows[a[0]!]!)),
  );
  for (const index of endedFirst) {
    const first = rows[index[0]!]!;
    const keys = additionsKeys(first.accountType)!;
    const limit = ctx.limits[keys.totalAdditions];
    if (limit === undefined || ctx.limits[keys.base] === undefined) continue;
    const pid = first.personId!;
    const pay = first.employer!.pay;
    const bound = pay === null ? limit : Math.min(limit, Math.max(0, pay));
    const birthYear = ctx.people.find((p) => p.id === pid)?.birthYear ?? null;
    const catchup =
      catchupLeft.get(pid) ?? catchupFor(first.accountType, birthYear, ctx);
    const kept = sumBy(index, (i) => state.kept[i]!);
    const f0 = state.factorOf[index[0]!]!;
    const ids = index.map((i) => rows[i]!.id);
    // Employer money when the deferrals here are `d` (a match moves with them).
    const employer = (d: number) =>
      ctx.employerAt
        ? Math.max(0, ctx.employerAt(ids, kept > 0 ? (f0 * d) / kept : f0))
        : sumBy(index, (i) => Math.max(0, rows[i]!.employerAnnual));
    const catchupAt = (d: number) =>
      d - Math.min(d, Math.max(0, bound - employer(d)));
    const fits = (d: number) =>
      catchupAt(d) <= Math.min(catchup, (pay ?? Infinity) - (d - catchupAt(d)));
    const already = isAlreadyIn(first);
    const most = already
      ? Math.max(kept, 0)
      : largestFit(bound + catchup, fits);
    catchupLeft.set(
      pid,
      Math.max(0, catchup - catchupAt(Math.min(kept, most))),
    );
    // The person's configured money in the same limit group at their other employers (as
    // configured, so the result doesn't depend on which employer this pass reaches first).
    const elsewhere = rows.reduce(
      (sum, r, j) =>
        r.personId === pid &&
        !index.includes(j) &&
        getLimitGroup(r.accountType) === getLimitGroup(first.accountType)
          ? sum + Math.max(0, r.regularAnnual) + Math.max(0, r.bonusAnnual)
          : sum,
      0,
    );
    for (const i of index) {
      if (kept > most) {
        state.kept[i] = (state.kept[i]! * most) / kept;
        state.factorOf[i] = (state.factorOf[i]! * most) / kept;
      }
      state.maxOf[i] = Math.min(state.maxOf[i] ?? Infinity, most + elsewhere);
    }
  }
}
