/**
 * IRS-limit caps on this tax year's contributions, per person per limit group (config-driven):
 * only employee money is cut, one factor across a person's rows; IRAs also cap at compensation.
 * Unknown age, HSA coverage or owner get bounded room, flagged; no limit row: flagged, uncapped.
 */
import {
  getAccountTypeConfig,
  getLimitGroup,
  type AccountCategory,
} from "@/lib/config/account-types";
import { HSA_FAMILY_COVERAGE } from "@/lib/config/enum-values";
import {
  MARRIED_FILING_STATUSES,
  SPOUSAL_IRA_FILING_STATUSES,
} from "@/lib/config/tax-params";
import {
  irsLimitBaseKey,
  resolveIrsLimit,
} from "@/lib/pure/contributions/irs-limits";
import { holdIraRowsToCompensation } from "@/lib/pure/contributions/ira-compensation";
import { ageInYear } from "@/lib/utils/date";
import { roundToCents, sumBy } from "@/lib/utils/math";
import type { CapContext, CapRow } from "./contribution-caps.types";
import { holdToAnnualAdditions } from "./annual-additions";

type CapReason =
  /** Cut to the IRS limit. */
  | "over-limit"
  /** Employer money alone fills the limit — no employee money fits. */
  | "employer-over-limit"
  /** Cut to taxable compensation (IRA). */
  | "over-compensation"
  /** Capped at the most any age allows: the owner's birth year is unknown. */
  | "no-birth-date"
  /** The limit depends on a coverage type the row doesn't have — sized at
   *  the base (self-only) limit, the lower bound, until one is chosen. */
  | "no-coverage"
  /** A joint row: no one's own limit applies — held to the room the
   *  household's limits leave after everyone's own rows; needs an owner. */
  | "no-owner"
  /** Not capped: the year's tax data lacks the limit. */
  | "no-limit-data";

export type CappedContribution = {
  /** The row's limit group; null when its type has no IRS limit. */
  group: string | null;
  /** Configured yearly employee money (regular + bonus). */
  annual: number;
  /** Capped regular-check money. */
  regularAnnual: number;
  /** Capped bonus-check money. */
  bonusAnnual: number;
  /** Capped yearly employee money — what every figure uses. */
  cappedAnnual: number;
  /** annual − cappedAnnual. */
  overBy: number;
  /** The limit the person's group was held to (incl. catch-up and employer
   *  money that counts), null when no cap applied. For a shared family HSA:
   *  the family limit plus this person's catch-up. */
  limit: number | null;
  /** The most employee money this person can put into this group for the
   *  year, given employer money and everyone else's capped contributions —
   *  the same on each of their rows in the group. null = no bound. */
  maxEmployee: number | null;
  /** Why the row was cut, bounded or left uncapped; null = within its limit
   *  or the type has no IRS limit. */
  reason: CapReason | null;
};

/** One person's share of a limit group. `ownRoom`: limit only their rows may fill (a
 *  spouse's catch-up in a shared family group); `employerAt(f)`: their counting employer
 *  money when employee money is `employee × f`. */
type Participant = {
  personId: number;
  rowIndex: number[];
  employee: number;
  employerAt: (factor: number) => number;
  ownRoom: number;
};

/** Money a participant puts against the shared limit at factor `f`. */
const sharedNeed = (p: Participant, f: number) =>
  Math.max(0, p.employee * f + p.employerAt(f) - p.ownRoom);

const BISECT_STEPS = 60;

/** Smallest x in [lo, hi] with ok(x), for ok false→true as x grows
 *  (returns hi when only hi is ok). */
function bisect(lo: number, hi: number, ok: (x: number) => boolean): number {
  for (let k = 0; k < BISECT_STEPS; k++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Each participant's employee-money factor under `sharedLimit`: own room fills first, then
 * the overage is cut by the smallest equal share that fits; employer money alone over the limit
 * leaves the employee nothing.
 */
function capParticipants(
  participants: readonly Participant[],
  sharedLimit: number,
): Map<number, number> {
  const total = (fs: readonly number[]) =>
    participants.reduce((sum, p, k) => sum + sharedNeed(p, fs[k]!), 0);
  const ones = participants.map(() => 1);
  if (total(ones) <= sharedLimit)
    return new Map(participants.map((p) => [p.personId, 1]));
  // Employee money in the shared part at the configured amounts.
  const cuttable = participants.map((p) =>
    Math.min(p.employee, sharedNeed(p, 1)),
  );
  const factorsAt = (share: number) =>
    participants.map((p, k) =>
      p.employee > 0 ? 1 - (cuttable[k]! * share) / p.employee : 1,
    );
  const share = bisect(0, 1, (x) => total(factorsAt(x)) <= sharedLimit);
  const fs = factorsAt(share);
  return new Map(participants.map((p, k) => [p.personId, fs[k]!]));
}

/** The most employee money `p` can put in when the shared part has `room`
 *  left for them (others' shares taken off). */
function maxEmployeeFor(p: Participant, room: number): number {
  const fits = (e: number) => {
    const f = p.employee > 0 ? e / p.employee : 0;
    const employer = p.employee > 0 ? p.employerAt(f) : p.employerAt(0);
    return Math.max(0, e + employer - p.ownRoom) <= room;
  };
  if (!fits(0)) return 0;
  let hi = Math.max(1, room + p.ownRoom);
  while (fits(hi)) hi *= 2;
  // Largest e that fits = just under the smallest that doesn't.
  let lo = 0;
  for (let k = 0; k < BISECT_STEPS; k++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Family if any of the coverages is, else the first one given. */
export function combinedCoverage(
  coverages: readonly (string | null)[],
): string | null {
  if (coverages.includes(HSA_FAMILY_COVERAGE)) return HSA_FAMILY_COVERAGE;
  return coverages.find((c) => c !== null) ?? null;
}

function personCoverage(rows: readonly CapRow[]): string | null {
  return combinedCoverage(rows.map((r) => r.hsaCoverageType));
}

const includes = (list: readonly string[], s: string) => list.includes(s);

/**
 * Whether a household limit with a coverage variant (HSA) is one shared limit: married with
 * either spouse on family coverage (Pub 969). Read by both the caps and Milestones.
 */
export function sharesHouseholdLimit(
  accountType: string,
  filingStatus: string,
  coverages: readonly (string | null)[],
): boolean {
  const cfg = getAccountTypeConfig(accountType as AccountCategory);
  return (
    cfg.isHouseholdLimit &&
    !!cfg.irsLimitKeys?.coverageVariant &&
    includes(MARRIED_FILING_STATUSES, filingStatus) &&
    coverages.includes(HSA_FAMILY_COVERAGE)
  );
}

type Size = { base: number; catchup: number };

/** A person's base limit and catch-up on top for a limited type, or why it
 *  can't be sized. Unknown age: the largest catch-up any age gets; unknown
 *  coverage: the base (self-only) limit (the caller flags it). */
function sizeLimit(
  type: string,
  age: number | null,
  cov: string | null,
  limits: Record<string, number>,
): Size | CapReason {
  const keys = getAccountTypeConfig(type as AccountCategory).irsLimitKeys!;
  const base = limits[irsLimitBaseKey(keys, cov)];
  if (base === undefined) return "no-limit-data";
  if (age === null) {
    const catchups = [keys.catchup, keys.superCatchup].map((k) =>
      k ? (limits[k] ?? 0) : 0,
    );
    return { base, catchup: Math.max(0, ...catchups) };
  }
  return { base, catchup: resolveIrsLimit(type, age, cov, limits) - base };
}

/** The household's limit from per-person sizes: a shared family limit
 *  counts its base once plus each spouse's catch-up. */
const householdOf = (sizes: readonly Size[], sharedFamily: boolean) =>
  sharedFamily
    ? (sizes[0]?.base ?? 0) + sumBy(sizes, (z) => z.catchup)
    : sumBy(sizes, (z) => z.base + z.catchup);

const ageMap = (ctx: CapContext) =>
  new Map(
    ctx.people.map((p) => [
      p.id,
      p.birthYear === null ? null : ageInYear(p.birthYear, ctx.taxYear),
    ]),
  );

type CapResult = {
  byRow: Map<number, CappedContribution>;
  /** Each group's household limit, shared limits counted once (a family HSA's base once
   *  plus each catch-up), or the whole household's with joint rows; unsizable people add 0. */
  groupLimits: Map<string, number>;
};

export function capContributionsByLimitGroup(
  rows: readonly CapRow[],
  ctx: CapContext,
): CapResult {
  const employeeOf = (r: CapRow) =>
    Math.max(0, r.regularAnnual) + Math.max(0, r.bonusAnnual);
  const kept = rows.map(employeeOf);
  /** Each row's factor on its configured employee money (employer money moves with it). */
  const factorOf = rows.map(() => 1);
  const limitOf: (number | null)[] = rows.map(() => null);
  const maxOf: (number | null)[] = rows.map(() => null);
  const reasonOf: (CapReason | null)[] = rows.map(() => null);
  const ageOf = ageMap(ctx);
  const groupLimits = new Map<string, number>();
  const flag = (index: readonly number[], reason: CapReason) =>
    index.forEach((i) => (reasonOf[i] ??= reason));

  // Rows by limit group: owned rows by person, joint rows apart.
  const groups = new Map<
    string,
    { byPerson: Map<number, number[]>; joint: number[] }
  >();
  rows.forEach((r, i) => {
    const group = getLimitGroup(r.accountType);
    if (!group) return;
    const g = groups.get(group) ?? {
      byPerson: new Map<number, number[]>(),
      joint: [] as number[],
    };
    groups.set(group, g);
    if (r.personId === null) {
      reasonOf[i] = "no-owner";
      g.joint.push(i);
      return;
    }
    g.byPerson.set(r.personId, [...(g.byPerson.get(r.personId) ?? []), i]);
  });

  for (const [group, { byPerson, joint }] of groups) {
    // Types sharing a limit group share these settings (config test).
    const type = rows[[...byPerson.values()][0]?.[0] ?? joint[0]!]!.accountType;
    const cfg = getAccountTypeConfig(type as AccountCategory);
    const coverageMatters = !!cfg.irsLimitKeys!.coverageVariant;
    const coverage = new Map(
      [...byPerson].map(([pid, index]) => [
        pid,
        coverageMatters ? personCoverage(index.map((i) => rows[i]!)) : null,
      ]),
    );
    const jointCoverage = coverageMatters
      ? personCoverage(joint.map((i) => rows[i]!))
      : null;
    const sharedFamily = sharesHouseholdLimit(type, ctx.filingStatus, [
      ...coverage.values(),
      jointCoverage,
    ]);

    const sizeFor = (pid: number, cov: string | null) =>
      sizeLimit(type, ageOf.get(pid) ?? null, cov, ctx.limits);
    /** Employer money that counts for these rows at `factor`. */
    const employerOf = (index: readonly number[], factor = 1) =>
      !cfg.matchCountsTowardLimit
        ? 0
        : ctx.employerAt
          ? Math.max(
              0,
              ctx.employerAt(
                index.map((i) => rows[i]!.id),
                factor,
              ),
            )
          : sumBy(index, (i) => Math.max(0, rows[i]!.employerAnnual));
    const participant = (
      pid: number,
      index: number[],
      ownRoom: number,
    ): Participant => ({
      personId: pid,
      rowIndex: index,
      employee: sumBy(index, (i) => kept[i]!),
      employerAt: (f) => employerOf(index, f),
      ownRoom,
    });
    const apply = (parts: readonly Participant[], sharedLimit: number) => {
      const factors = capParticipants(parts, sharedLimit);
      const employerOver = sumBy(parts, (p) => sharedNeed(p, 0)) > sharedLimit;
      for (const p of parts) {
        const othersNeed = sumBy(parts, (o) =>
          o.personId === p.personId
            ? 0
            : sharedNeed(o, factors.get(o.personId)!),
        );
        const max = maxEmployeeFor(p, sharedLimit - othersNeed);
        const factor = factors.get(p.personId)!;
        for (const i of p.rowIndex) {
          kept[i] = kept[i]! * factor;
          factorOf[i] = factor;
          limitOf[i] = sharedLimit + p.ownRoom;
          maxOf[i] = max;
        }
        if (employerOver) flag(p.rowIndex, "employer-over-limit");
      }
    };

    if (sharedFamily) {
      // Both spouses use the family limit; each one's catch-up is their own.
      const sized = [...byPerson].map(([pid, idx]) => ({
        pid,
        idx,
        size: sizeFor(pid, HSA_FAMILY_COVERAGE),
      }));
      const unsized = sized.find((s) => typeof s.size === "string");
      if (unsized) {
        // Only a missing limit row gets here (coverage is family).
        sized.forEach((s) => flag(s.idx, unsized.size as CapReason));
      } else if (sized.length > 0) {
        const sizes = sized.map((s) => s.size as Size);
        groupLimits.set(group, householdOf(sizes, true));
        sized.forEach((s) => {
          if (ageOf.get(s.pid) == null) flag(s.idx, "no-birth-date");
        });
        apply(
          sized.map((s, k) => participant(s.pid, s.idx, sizes[k]!.catchup)),
          sizes[0]!.base,
        );
      }
    } else {
      for (const [pid, index] of byPerson) {
        const size = sizeFor(pid, coverage.get(pid) ?? null);
        if (typeof size === "string") {
          flag(index, size);
          continue;
        }
        if (ageOf.get(pid) == null) flag(index, "no-birth-date");
        if (coverageMatters && coverage.get(pid) == null)
          flag(index, "no-coverage");
        apply([participant(pid, index, 0)], size.base + size.catchup);
        groupLimits.set(
          group,
          (groupLimits.get(group) ?? 0) + size.base + size.catchup,
        );
      }
    }

    // Joint rows: no one's own limit applies, so they're held to the room
    // the household's limits leave after everyone's own rows (and flagged
    // to choose an owner). Unsizable household = left as they are.
    if (joint.length === 0) continue;
    const householdSizes = ctx.people.map((p) =>
      sizeFor(
        p.id,
        sharedFamily
          ? HSA_FAMILY_COVERAGE
          : (coverage.get(p.id) ?? jointCoverage),
      ),
    );
    if (
      householdSizes.length === 0 ||
      householdSizes.some((z) => typeof z === "string")
    )
      continue;
    const household = householdOf(householdSizes as Size[], sharedFamily);
    groupLimits.set(group, household);
    const ownedRoom =
      household -
      sumBy(
        [...byPerson.values()],
        (index) =>
          sumBy(index, (i) => kept[i]!) +
          employerOf(index, factorOf[index[0]!]!),
      );
    const jointPart = participant(-1, joint, 0);
    const room = maxEmployeeFor(jointPart, Math.max(0, ownedRoom));
    const total = sumBy(joint, (i) => kept[i]!);
    const factor = total > room ? room / total : 1;
    for (const i of joint) {
      kept[i] = kept[i]! * factor;
      limitOf[i] = household;
      maxOf[i] = room;
    }
  }

  holdToAnnualAdditions(rows, ctx, { kept, factorOf, maxOf }); // 415(c), per employer
  // Compensation bound (IRA) on the capped pre-tax money: own pay, or the couple's for a spousal IRA.
  const compensation = new Map(
    ctx.people.map((p) => [
      p.id,
      p.wages === null
        ? null
        : Math.max(
            0,
            p.wages -
              sumBy(
                rows.flatMap((r, i) =>
                  r.personId === p.id && r.reducesCompensation ? [i] : [],
                ),
                (i) => kept[i]!,
              ),
          ),
    ]),
  );
  const bounded = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const group = getLimitGroup(r.accountType);
    if (!group || r.personId === null) return;
    if (
      !getAccountTypeConfig(r.accountType as AccountCategory)
        .limitBoundedByCompensation
    )
      return;
    bounded.set(group, [...(bounded.get(group) ?? []), i]);
  });
  /** Hold the rows within `room`; each person's max is room less the others. */
  const holdTo = (index: readonly number[], room: number) => {
    const total = sumBy(index, (i) => kept[i]!);
    const factor = total > room ? room / total : 1;
    for (const i of index) {
      kept[i] = kept[i]! * factor;
      if (factor < 1) reasonOf[i] = "over-compensation";
    }
    for (const i of index) {
      const others = sumBy(index, (j) =>
        rows[j]!.personId === rows[i]!.personId ? 0 : kept[j]!,
      );
      maxOf[i] = Math.min(maxOf[i] ?? Infinity, Math.max(0, room - others));
    }
  };
  const spousal = includes(SPOUSAL_IRA_FILING_STATUSES, ctx.filingStatus);
  holdIraRowsToCompensation(bounded, spousal, compensation, rows, holdTo);

  const out = new Map<number, CappedContribution>();
  rows.forEach((r, i) => {
    const annual = roundToCents(employeeOf(r));
    const cappedAnnual = roundToCents(kept[i]!);
    const factor = annual > 0 ? cappedAnnual / annual : 1;
    const bonusAnnual = roundToCents(Math.max(0, r.bonusAnnual) * factor);
    const overBy = roundToCents(annual - cappedAnnual);
    out.set(r.id, {
      group: getLimitGroup(r.accountType),
      annual,
      regularAnnual: roundToCents(cappedAnnual - bonusAnnual),
      bonusAnnual,
      cappedAnnual,
      overBy,
      limit: limitOf[i]!,
      maxEmployee: maxOf[i] === null ? null : roundToCents(maxOf[i]!),
      reason: reasonOf[i] ?? (overBy > 0 ? "over-limit" : null),
    });
  });
  return { byRow: out, groupLimits };
}

/**
 * Each limit group's household limit from who holds which account — the
 * same pass with no money in it (for a household-limit total, or a
 * projection that routes a household total rather than per-account specs).
 */
export function accountGroupLimits(
  accounts: readonly {
    personId: number | null;
    accountType: string;
    hsaCoverageType: string | null;
  }[],
  ctx: CapContext,
): Map<string, number> {
  return capContributionsByLimitGroup(
    accounts.map((a, i) => ({
      ...a,
      id: i,
      regularAnnual: 0,
      bonusAnnual: 0,
      employerAnnual: 0,
      reducesCompensation: false,
    })),
    ctx,
  ).groupLimits;
}

/**
 * Rows that went through the IRS-limit cap pass. The builders that turn
 * contribution rows into yearly figures take only these, so the compiler
 * finds any set of rows that skipped the pass.
 */
export type CapPassed = {
  readonly capPassed: true;
  /** The value calculations use: the configured value scaled to the IRS
   *  limit. Full precision — never rounded or stored. */
  cappedValue?: number;
  /** The module's verdict for a row of a limited type. */
  cap?: CappedContribution;
  /** The most this row can be set to on its own (the person's room less
   *  their other rows in the group, as configured), in its own terms. */
  maxValue?: number;
  /** The person's other rows in the group, yearly, as configured. */
  othersInGroup?: number;
};

/**
 * The value a contribution's yearly money is figured from: the capped value if set, else the
 * configured one. Editors, saves and diffs read `contributionValue` itself.
 */
export function computeValue(c: {
  contributionValue: string | number | null | undefined;
  cappedValue?: number;
}): number {
  return c.cappedValue ?? Number(c.contributionValue ?? 0);
}

/** Down to the cent / hundredth of a percent — the most that can be
 *  entered and still be within the limit. */
const floorTo2 = (v: number) => Math.floor(v * 100 + 1e-9) / 100;

/** The most a row can be set to, in its own method's terms. */
function capMaxLabel(method: string | null, cappedValue: number): string {
  const v = floorTo2(Math.max(0, cappedValue));
  const dollars = `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  switch (method ?? "percent_of_salary") {
    case "percent_of_salary":
      return `${v}% of pay`;
    case "fixed_per_period":
      return `${dollars} per check`;
    case "fixed_monthly":
      return `${dollars} a month`;
    default:
      return `${dollars} a year`;
  }
}

/** What's wrong with a row's contribution and how to fix it — the same
 *  words on the page and in a refused save. null = nothing to fix. */
export function capMessage(row: {
  contributionMethod: string | null;
  cap?: CappedContribution;
  maxValue?: number;
  othersInGroup?: number;
}): string | null {
  const cap = row.cap;
  if (!cap) return null;
  const at = (v: number) => `$${Math.ceil(v).toLocaleString("en-US")}`;
  if (cap.overBy >= 0.01) {
    if (row.maxValue === undefined || floorTo2(row.maxValue) <= 0)
      return (row.othersInGroup ?? 0) > 0
        ? `${at(cap.overBy)} over the IRS limit — the other contributions that share this limit already fill it: lower those first.`
        : `${at(cap.overBy)} over the IRS limit — set it to 0.`;
    const most = capMaxLabel(row.contributionMethod, row.maxValue);
    if (cap.reason === "over-compensation")
      return `${at(cap.overBy)} more than taxable pay allows — set it to at most ${most}.`;
    if (cap.reason === "employer-over-limit")
      return `Employer money alone fills the IRS limit — set it to ${most}.`;
    return `${at(cap.overBy)} over the IRS limit — set it to at most ${most}.`;
  }
  if (cap.reason === "no-owner")
    return "IRS limits are per person — choose who owns this account.";
  if (cap.reason === "no-coverage")
    return "Choose the HSA coverage (self-only or family) — sized at the self-only limit until then.";
  return null;
}
