/**
 * IRS-limit caps on contributions — the one rule every yearly contribution
 * figure reads (PLAN-tax-accuracy step 5). A person's employee contributions
 * to one limit group in a tax year never exceed their limit for it; what
 * varies by account type comes from config (`irsLimitGroup`, `irsLimitKeys`,
 * `isHouseholdLimit`, `matchCountsTowardLimit`, `limitBoundedByCompensation`).
 * Pure.
 *
 * - Groups are per person per limit group: a 401(k) and a 403(b), or two
 *   plans at different employers, share one 402(g) limit.
 * - A household limit with a coverage variant (HSA): married, if either
 *   spouse has family coverage both spouses' rows share one family limit,
 *   each spouse's catch-up on top for their own rows only (Pub 969);
 *   otherwise each person has their own coverage's limit.
 * - Employer money counts toward the limit when the type says so; only
 *   employee money is cut.
 * - Within a person's share of a group, every row is cut by one factor, so
 *   a Roth / Traditional split (and regular / bonus split) holds.
 * - Compensation-bounded types (IRA) are also capped at taxable compensation
 *   — the couple's combined compensation for a spousal IRA (IRC 219(c)).
 * - A person with no birth year is capped at the most any age allows, and
 *   an HSA with no coverage type at the self-only limit (the lower
 *   bound), both flagged. A joint row (no owner) is held to the room
 *   the household's limits leave after everyone's own rows, and flagged.
 *   Not capped, flagged: a year without the limit row.
 *
 * Rows are this tax year's contributions only; prior-year IRA money stays
 * outside the pass.
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
import { irsLimitBaseKey, resolveIrsLimit } from "@/lib/pure/contributions";
import { ageInYear } from "@/lib/utils/date";
import { roundToCents, sumBy } from "@/lib/utils/math";

export type CapRow = {
  id: number;
  /** null = a joint row with no single owner. */
  personId: number | null;
  accountType: string;
  hsaCoverageType: string | null;
  /** Employee money from regular checks over the tax year. */
  regularAnnual: number;
  /** Employee money from bonus checks over the tax year. */
  bonusAnnual: number;
  /** Employer money over the tax year (counts toward the limit when the
   *  account type's `matchCountsTowardLimit`). */
  employerAnnual: number;
  /** Pre-tax payroll money — comes off the person's taxable compensation
   *  (W-2 box 1), which bounds an IRA. */
  reducesCompensation: boolean;
};

export type CapPerson = {
  id: number;
  /** null = unknown — capped at the most any age allows. */
  birthYear: number | null;
  /** Taxable pay for the year before pre-tax payroll money (salary, bonus,
   *  other taxable pay); the pass takes off the capped pre-tax rows itself.
   *  null = unknown (no compensation bound). */
  wages: number | null;
};

export type CapContext = {
  taxYear: number;
  filingStatus: string;
  /** Every IRS limit key for the year (base, catch-up, super catch-up,
   *  coverage variants) — for a projected year, the grown figures. */
  limits: Record<string, number>;
  people: readonly CapPerson[];
};

export type CapReason =
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

/** One person's share of a limit group. `ownRoom` is limit only their own
 *  rows may fill (a spouse's catch-up in a shared family group). */
type Participant = {
  personId: number;
  rowIdx: number[];
  employee: number;
  employer: number;
  ownRoom: number;
};

const sharedNeed = (p: Participant, employee = p.employee) =>
  Math.max(0, employee + p.employer - p.ownRoom);

/**
 * Employee money each participant keeps when the group shares `sharedLimit`.
 * Each participant's money first fills their own room; what's over is cut
 * from the employee money that uses the shared limit, proportionally.
 */
function capParticipants(
  participants: readonly Participant[],
  sharedLimit: number,
): Map<number, number> {
  const out = new Map(participants.map((p) => [p.personId, p.employee]));
  const excess = sumBy(participants, (p) => sharedNeed(p)) - sharedLimit;
  if (excess <= 0) return out;
  // Only employee money in the shared part can be cut; employer money that
  // alone fills the limit leaves the employee nothing.
  const cuttable = participants.map((p) => Math.min(p.employee, sharedNeed(p)));
  const total = sumBy(cuttable, (c) => c);
  if (total <= 0) return out;
  const share = Math.min(1, excess / total);
  participants.forEach((p, i) =>
    out.set(p.personId, p.employee - cuttable[i]! * share),
  );
  return out;
}

/** Family if any of the rows has it, else the first coverage given. */
function personCoverage(rows: readonly CapRow[]): string | null {
  if (rows.some((r) => r.hsaCoverageType === HSA_FAMILY_COVERAGE))
    return HSA_FAMILY_COVERAGE;
  return rows.find((r) => r.hsaCoverageType !== null)?.hsaCoverageType ?? null;
}

const includes = (list: readonly string[], s: string) => list.includes(s);

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

export type CapResult = {
  byRow: Map<number, CappedContribution>;
  /** Each limit group's household limit, every shared limit counted once:
   *  owners' limits (a shared family HSA's base once plus each spouse's
   *  catch-up), or the whole household's when the group has joint rows.
   *  People who can't be sized add nothing. */
  groupLimits: Map<string, number>;
};

export function capContributionsByLimitGroup(
  rows: readonly CapRow[],
  ctx: CapContext,
): CapResult {
  const employeeOf = (r: CapRow) =>
    Math.max(0, r.regularAnnual) + Math.max(0, r.bonusAnnual);
  const kept = rows.map(employeeOf);
  const limitOf: (number | null)[] = rows.map(() => null);
  const maxOf: (number | null)[] = rows.map(() => null);
  const reasonOf: (CapReason | null)[] = rows.map(() => null);
  const ageOf = ageMap(ctx);
  const groupLimits = new Map<string, number>();
  const married = includes(MARRIED_FILING_STATUSES, ctx.filingStatus);
  const flag = (idx: readonly number[], reason: CapReason) =>
    idx.forEach((i) => (reasonOf[i] ??= reason));

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
      [...byPerson].map(([pid, idx]) => [
        pid,
        coverageMatters ? personCoverage(idx.map((i) => rows[i]!)) : null,
      ]),
    );
    const jointCoverage = coverageMatters
      ? personCoverage(joint.map((i) => rows[i]!))
      : null;
    const sharedFamily =
      cfg.isHouseholdLimit &&
      coverageMatters &&
      married &&
      [...coverage.values(), jointCoverage].includes(HSA_FAMILY_COVERAGE);

    const sizeFor = (pid: number, cov: string | null) =>
      sizeLimit(type, ageOf.get(pid) ?? null, cov, ctx.limits);
    const employerOf = (idx: readonly number[]) =>
      cfg.matchCountsTowardLimit
        ? sumBy(idx, (i) => Math.max(0, rows[i]!.employerAnnual))
        : 0;
    const participant = (pid: number, idx: number[], ownRoom: number) => ({
      personId: pid,
      rowIdx: idx,
      employee: sumBy(idx, (i) => kept[i]!),
      employer: employerOf(idx),
      ownRoom,
    });
    const apply = (parts: readonly Participant[], sharedLimit: number) => {
      const keptBy = capParticipants(parts, sharedLimit);
      const capped = parts.map((p) => ({
        ...p,
        employee: keptBy.get(p.personId)!,
      }));
      const employerOver = sumBy(parts, (p) => sharedNeed(p, 0)) > sharedLimit;
      capped.forEach((p, k) => {
        const factor =
          parts[k]!.employee > 0 ? p.employee / parts[k]!.employee : 1;
        const othersNeed = sumBy(capped, (o) =>
          o.personId === p.personId ? 0 : sharedNeed(o),
        );
        const max = Math.max(
          0,
          sharedLimit - othersNeed + p.ownRoom - p.employer,
        );
        for (const i of p.rowIdx) {
          kept[i] = kept[i]! * factor;
          limitOf[i] = sharedLimit + p.ownRoom;
          maxOf[i] = max;
        }
        if (employerOver) flag(p.rowIdx, "employer-over-limit");
      });
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
      for (const [pid, idx] of byPerson) {
        const size = sizeFor(pid, coverage.get(pid) ?? null);
        if (typeof size === "string") {
          flag(idx, size);
          continue;
        }
        if (ageOf.get(pid) == null) flag(idx, "no-birth-date");
        if (coverageMatters && coverage.get(pid) == null)
          flag(idx, "no-coverage");
        apply([participant(pid, idx, 0)], size.base + size.catchup);
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
    if (householdSizes.some((z) => typeof z === "string")) continue;
    const household = householdOf(householdSizes as Size[], sharedFamily);
    groupLimits.set(group, household);
    const ownedIdx = [...byPerson.values()].flat();
    const room = Math.max(
      0,
      household -
        sumBy(ownedIdx, (i) => kept[i]!) -
        employerOf(ownedIdx) -
        employerOf(joint),
    );
    const total = sumBy(joint, (i) => kept[i]!);
    const factor = total > room ? room / total : 1;
    for (const i of joint) {
      kept[i] = kept[i]! * factor;
      limitOf[i] = household;
      maxOf[i] = room;
    }
  }

  // Compensation bound (IRA), on the capped pre-tax money above: each
  // person's own compensation, or the couple's combined for a spousal IRA.
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
  const holdTo = (idx: readonly number[], room: number) => {
    const total = sumBy(idx, (i) => kept[i]!);
    const factor = total > room ? room / total : 1;
    for (const i of idx) {
      kept[i] = kept[i]! * factor;
      if (factor < 1) reasonOf[i] = "over-compensation";
    }
    for (const i of idx) {
      const others = sumBy(idx, (j) =>
        rows[j]!.personId === rows[i]!.personId ? 0 : kept[j]!,
      );
      maxOf[i] = Math.min(maxOf[i] ?? Infinity, Math.max(0, room - others));
    }
  };
  const spousal = includes(SPOUSAL_IRA_FILING_STATUSES, ctx.filingStatus);
  for (const idx of bounded.values()) {
    if (spousal) {
      // Everyone's compensation counts, IRA or not — usually only the
      // spouse without pay contributes. Unknown for anyone = no bound.
      const comps = [...compensation.values()];
      if (comps.every((c) => c !== null))
        holdTo(
          idx,
          sumBy(comps, (c) => c!),
        );
      continue;
    }
    for (const pid of new Set(idx.map((i) => rows[i]!.personId!))) {
      const comp = compensation.get(pid) ?? null;
      if (comp !== null)
        holdTo(
          idx.filter((i) => rows[i]!.personId === pid),
          comp,
        );
    }
  }

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
