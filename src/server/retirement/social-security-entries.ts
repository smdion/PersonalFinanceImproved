/**
 * Builds the engine's per-person `socialSecurityEntries` array from a
 * household's `perPersonSettings`. ONE place for the PIA-adjustment + MFJ
 * spousal-benefit + "worker has filed" logic, so `build-engine-payload.ts`
 * (the real payload) and the strategy optimizer's SS-start-age lever
 * (`projection/strategy.ts`) can't drift.
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
import { SS_LATEST_CLAIMING_AGE_MONTHS } from "@/lib/config/social-security";

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

/**
 * @param people          the household's per-person settings
 * @param filingStatus    used only to decide MFJ ⇒ spouses (MFJ + exactly
 *                        two people). Single/HOH/3+ never get spousal math.
 * @param ssStartAgeDelta shift every person's claiming age by this many
 *                        whole years (clamped to ≤ 70). 0 = use each
 *                        person's stored `ssStartAge` as-is. The strategy
 *                        optimizer's "delay SS" lever passes +N; the real
 *                        payload passes 0.
 */
export function buildSocialSecurityEntries(
  people: ReadonlyArray<SsPerson>,
  filingStatus: string | null | undefined,
  ssStartAgeDelta = 0,
): SsEntry[] {
  const shiftedStartAge = (p: SsPerson) =>
    Math.min(p.ssStartAge + ssStartAgeDelta, MAX_CLAIMING_AGE);

  const isMfjCouple = filingStatus === "MFJ" && people.length === 2;

  return people.map((ps, i) => {
    const startAge = shiftedStartAge(ps);
    const ownPia = parseAnnualPia(ps.socialSecurityPia);

    // This person's OWN benefit: PIA-adjusted for their claiming age if
    // they've opted into PIA, otherwise their flat monthly amount * 12
    // unchanged (the pre-PIA model, no claiming-age response).
    let annualAmount =
      ownPia != null
        ? computeAdjustedBenefit(ownPia, ps.birthYear, startAge * 12)
        : toNumber(ps.socialSecurityMonthly) * 12;

    // Spousal benefit (MFJ + 2 people ⇒ spouses; product decision
    // 2026-09-07, no dedicated spouse-link field). Requires the OTHER
    // person to have a PIA on record AND to have already filed by the time
    // this person claims — SSA pays no spousal benefit before the worker
    // files. `computeSpousalBenefit`'s own `max()` / excess math means this
    // is safe to apply symmetrically: the genuinely higher earner just
    // gets their own benefit back.
    if (isMfjCouple) {
      const other = people[i === 0 ? 1 : 0]!;
      const otherPia = parseAnnualPia(other.socialSecurityPia);
      if (otherPia != null && shiftedStartAge(other) <= startAge) {
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
