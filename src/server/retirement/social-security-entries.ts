/**
 * Builds the engine's per-person `socialSecurityEntries` array from a
 * household's `perPersonSettings`. ONE place for the PIA-adjustment + MFJ
 * spousal-benefit + "worker has filed" logic, so `build-engine-payload.ts`
 * (the real payload), the strategy optimizer's SS-start-age lever
 * (`projection/strategy.ts`), and the claiming-age sweep
 * (`projection/social-security.ts`) can't drift — the sweep in particular
 * needs the WHOLE household rebuilt per candidate age, not just the swept
 * person's own entry, so a spouse's top-up responds correctly.
 *
 * Only meaningful for genuinely multi-person households — a single-person
 * household routes Social Security through the scalar `socialSecurityAnnual`
 * field instead (populating `socialSecurityEntries` there would switch on
 * per-person RMD tracking the engine reserves for multi-person households;
 * see build-engine-payload.ts's own comment). Callers apply the
 * `length > 1` gate; this helper just does the map.
 */
import {
  computeAdjustedBenefit,
  computeSpousalBenefit,
} from "@/lib/calculators/social-security";
import { parseAnnualPia } from "@/lib/config/social-security";
import { toNumber } from "@/server/helpers/transforms";
import {
  SS_EARLIEST_CLAIMING_AGE_MONTHS,
  SS_LATEST_CLAIMING_AGE_MONTHS,
} from "@/lib/config/social-security";

const MIN_CLAIMING_AGE = SS_EARLIEST_CLAIMING_AGE_MONTHS / 12; // 62
const MAX_CLAIMING_AGE = SS_LATEST_CLAIMING_AGE_MONTHS / 12; // 70

export type SsPerson = {
  personId: number;
  name: string;
  birthYear: number;
  socialSecurityMonthly: string;
  socialSecurityPia?: string | null;
  ssStartAge: number;
};

export type SsEntry = {
  personId: number;
  personName: string;
  annualAmount: number;
  startAge: number;
  birthYear: number;
};

/** Per-person what-if override, keyed by `personId`. Used by the claiming-
 *  age sweep to ask "what if THIS person's own PIA/claiming age were X" —
 *  the caller-supplied `pia` is a real what-if axis the client already has
 *  from `perPersonSettings`, distinct from what's persisted. Both fields
 *  are independently optional; an override with only `startAge` keeps the
 *  person's stored PIA, and vice versa. */
export type SsEntryOverride = {
  pia?: number;
  startAge?: number;
};

/**
 * @param people          the household's per-person settings
 * @param filingStatus    used only to decide MFJ ⇒ spouses (MFJ + exactly
 *                        two people). Single/HOH/3+ never get spousal math.
 * @param ssStartAgeDelta shift every person's claiming age by this many
 *                        whole years (clamped to [62, 70]). 0 = use each
 *                        person's stored `ssStartAge` as-is. The strategy
 *                        optimizer's "delay SS" lever passes +N; the real
 *                        payload passes 0. Ignored for a person who has a
 *                        `startAge` override.
 * @param overridesByPerson per-person what-if overrides (claiming-age
 *                        sweep). Absent for the real payload and the
 *                        strategy lever, both of which use every person's
 *                        stored data unmodified (aside from the delta).
 */
export function buildSocialSecurityEntries(
  people: ReadonlyArray<SsPerson>,
  filingStatus: string | null | undefined,
  ssStartAgeDelta = 0,
  overridesByPerson?: ReadonlyMap<number, SsEntryOverride>,
): SsEntry[] {
  const shiftedStartAge = (p: SsPerson) => {
    const overrideStartAge = overridesByPerson?.get(p.personId)?.startAge;
    if (overrideStartAge !== undefined) {
      return Math.min(
        Math.max(overrideStartAge, MIN_CLAIMING_AGE),
        MAX_CLAIMING_AGE,
      );
    }
    return Math.min(
      Math.max(p.ssStartAge + ssStartAgeDelta, MIN_CLAIMING_AGE),
      MAX_CLAIMING_AGE,
    );
  };
  const ownPiaFor = (p: SsPerson) => {
    const overridePia = overridesByPerson?.get(p.personId)?.pia;
    return overridePia !== undefined
      ? overridePia
      : parseAnnualPia(p.socialSecurityPia);
  };

  const isMfjCouple = filingStatus === "MFJ" && people.length === 2;

  return people.map((ps, i) => {
    const startAge = shiftedStartAge(ps);
    const ownPia = ownPiaFor(ps);

    // This person's OWN benefit: PIA-adjusted for their claiming age if
    // they've opted into PIA, otherwise their flat monthly amount * 12
    // unchanged (the pre-PIA model, no claiming-age response).
    let annualAmount =
      ownPia != null
        ? computeAdjustedBenefit(ownPia, ps.birthYear, startAge * 12)
        : toNumber(ps.socialSecurityMonthly) * 12;

    // Spousal benefit (MFJ + 2 people ⇒ spouses — the data model has no
    // dedicated spouse-link field, so filing status stands in for it).
    // Requires the OTHER person to have a PIA on record AND to have
    // already filed by the time
    // this person claims — SSA pays no spousal benefit before the worker
    // files. The engine pays each person at their OWN age, so "has filed"
    // must compare calendar years each person actually claims
    // (`birthYear + startAge`), not the claiming ages themselves — spouses
    // with different birth years reach the same age in different years.
    // `computeSpousalBenefit`'s own `max()` / excess math means this is
    // safe to apply symmetrically: the genuinely higher earner just gets
    // their own benefit back.
    if (isMfjCouple) {
      const other = people[i === 0 ? 1 : 0]!;
      const otherPia = ownPiaFor(other);
      const otherStartAge = shiftedStartAge(other);
      const workerHasFiled =
        other.birthYear + otherStartAge <= ps.birthYear + startAge;
      if (otherPia != null && workerHasFiled) {
        annualAmount = computeSpousalBenefit(
          annualAmount,
          otherPia,
          ps.birthYear,
          startAge * 12,
          ownPia ?? undefined,
        );
      }
    }

    return {
      personId: ps.personId,
      personName: ps.name,
      annualAmount,
      startAge,
      birthYear: ps.birthYear,
    };
  });
}
