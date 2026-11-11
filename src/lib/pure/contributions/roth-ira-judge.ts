/**
 * The Roth IRA verdict and each person's most allowed directly at a MAGI
 * (Pub 590-A Worksheet 2-2), judged once for every reader.
 */
import {
  ROTH_IRA_REDUCED_LIMIT_FLOOR,
  ROTH_IRA_REDUCED_LIMIT_ROUNDING,
} from "@/lib/config/tax-params";
import { roundToCents, sumBy } from "@/lib/utils/math";

type RothIraVerdict = "direct" | "tooClose" | "backdoor";

type RothIraPersonInput = {
  personId: number;
  name: string;
  /** Wages (salary + bonus) — taxable compensation for the IRA limit. */
  compensation: number;
  /** The person's IRA limit for the year (catch-up by age included). */
  iraLimit: number;
  /** The most this person can put into an IRA this year from the IRS-limit
   *  cap pass (limit, compensation, the spouse's IRA money — IRC 219(c));
   *  absent = sized here from compensation. */
  iraRoom?: number | null;
};

type RothIraPersonResult = {
  personId: number;
  name: string;
  /** Most this person can put into a Roth IRA directly at this MAGI (Pub 590-A Worksheet 2-2). */
  maxDirect: number;
};

export type RothIraResult = {
  magi: number;
  phaseOutStart: number;
  phaseOutEnd: number;
  /** The safety margin below the phase-out start "direct" needs. */
  margin: number;
  /** phaseOutStart − magi (negative once inside or past the range). */
  distanceToStart: number;
  verdict: RothIraVerdict;
  people: RothIraPersonResult[];
};

/** Pub 590-A Worksheet 2-2: the reduced Roth IRA limit inside the
 *  phase-out. `base` is the smaller of the IRA limit and compensation —
 *  the worksheet reduces that, not the limit. */
export function rothIraAllowed(
  magi: number,
  phaseOut: { start: number; end: number },
  base: number,
): number {
  if (base <= 0) return 0;
  if (magi <= phaseOut.start) return base;
  if (magi >= phaseOut.end) return 0;
  const reduction =
    (base * (magi - phaseOut.start)) / (phaseOut.end - phaseOut.start);
  // Round UP to the next $10 (cents first, so float error can't add $10);
  // any amount above $0 and under $200 becomes $200.
  const step = ROTH_IRA_REDUCED_LIMIT_ROUNDING;
  const allowed = Math.ceil(roundToCents(base - reduction) / step) * step;
  return allowed > 0
    ? Math.min(base, Math.max(allowed, ROTH_IRA_REDUCED_LIMIT_FLOOR))
    : 0;
}

export function judgeRothIra(args: {
  magi: number;
  /** null when the tax data lacks the year's phase-out rows → no verdict. */
  phaseOut: { start: number; end: number } | null;
  /** Household setting; null = the phase-out range's width. */
  marginOverride: number | null;
  /** MFJ: a spouse's IRA can be funded from combined compensation (spousal IRA). */
  combinedCompensation: boolean;
  people: RothIraPersonInput[];
}): RothIraResult | null {
  const { magi, phaseOut } = args;
  if (!phaseOut || phaseOut.end <= phaseOut.start) return null;
  const margin = args.marginOverride ?? phaseOut.end - phaseOut.start;
  const verdict: RothIraVerdict =
    magi < phaseOut.start - margin
      ? "direct"
      : magi >= phaseOut.end
        ? "backdoor"
        : "tooClose";
  // IRA money can't exceed compensation; married filing jointly, a spouse may use the
  // couple's combined compensation less the other's (IRC 219(c)): higher earner first.
  const householdCompensation = sumBy(args.people, (p) =>
    Math.max(0, p.compensation),
  );
  const maxDirect = new Map<number, number>();
  let compensationLeft = householdCompensation;
  for (const p of [...args.people].sort(
    (a, b) => b.compensation - a.compensation,
  )) {
    const own = Math.max(0, p.compensation);
    const usable =
      p.iraRoom ?? (args.combinedCompensation ? compensationLeft : own);
    const allowed = rothIraAllowed(
      magi,
      phaseOut,
      Math.min(p.iraLimit, usable),
    );
    maxDirect.set(p.personId, allowed);
    compensationLeft = Math.max(0, compensationLeft - allowed);
  }
  return {
    magi,
    phaseOutStart: phaseOut.start,
    phaseOutEnd: phaseOut.end,
    margin,
    distanceToStart: phaseOut.start - magi,
    verdict,
    people: args.people.map((p) => ({
      personId: p.personId,
      name: p.name,
      maxDirect: maxDirect.get(p.personId)!,
    })),
  };
}
