/**
 * The engine's per-person `socialSecurityEntries` from `perPersonSettings`: the one place for PIA
 * adjustment, MFJ spousal benefit and "worker has filed", rebuilt per sweep age for the whole
 * household. Multi-person households only; callers apply the `length > 1` gate.
 */
import {
  computeAdjustedBenefit,
  computeSpousalBenefit,
} from "@/lib/pure/retirement/social-security";
import { fraBirthYear, parseAnnualPia } from "@/lib/config/social-security";
import {
  parseReturnFilingStatus,
  spousePair,
} from "@/lib/config/filing-status";
import { toNumber } from "@/lib/utils/numbers";
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
  /** Stored `YYYY-MM-DD`: the FRA table reads `fraBirthYear(dateOfBirth)` (a January 1 birth
   *  is the prior year's), the claim year reads `birthYear`. */
  dateOfBirth: string;
  socialSecurityMonthly: string;
  socialSecurityPia?: string | null;
  ssStartAge: number;
};

type SsEntry = {
  personId: number;
  personName: string;
  annualAmount: number;
  startAge: number;
  birthYear: number;
  /** From the worker's filing year, own plus the spousal excess (the engine's entry field). */
  fromSpouseFiling?: { year: number; annualAmount: number };
};

/** Per-person what-if override keyed by `personId` (claiming-age sweep). Each field is optional;
 *  an unset one keeps the person's stored value. */
export type SsEntryOverride = {
  pia?: number;
  startAge?: number;
};

/**
 * @param filingStatus    spouses only for a two-person return with exactly two people
 * @param ssStartAgeDelta whole years added to each stored claiming age, clamped to [62, 70];
 *                        ignored for a person with a `startAge` override
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

  const status = parseReturnFilingStatus(filingStatus);
  const spouses = spousePair(status, people);

  return people.map((ps) => {
    const startAge = shiftedStartAge(ps);
    const ownPia = ownPiaFor(ps);

    // This person's OWN benefit: PIA-adjusted for their claiming age if
    // they've opted into PIA, otherwise their flat monthly amount * 12
    // unchanged (the pre-PIA model, no claiming-age response).
    let annualAmount =
      ownPia != null
        ? computeAdjustedBenefit(
            ownPia,
            fraBirthYear(ps.dateOfBirth),
            startAge * 12,
          )
        : toNumber(ps.socialSecurityMonthly) * 12;

    // Spousal benefit (MFJ + 2 people stand in for a spouse link): needs the other person's PIA.
    // The excess starts the year the worker files (402(b)(1); deemed filing, 402(r)), reduced
    // for this person's age then (402(q)). Symmetric: the higher earner's excess is $0.
    let fromSpouseFiling: SsEntry["fromSpouseFiling"];
    if (spouses) {
      const other = spouses[0] === ps ? spouses[1] : spouses[0];
      const otherPia = ownPiaFor(other);
      const workerFilingYear = other.birthYear + shiftedStartAge(other);
      const excessStartsLater = workerFilingYear > ps.birthYear + startAge;
      if (otherPia != null) {
        const withExcess = computeSpousalBenefit(
          annualAmount,
          otherPia,
          fraBirthYear(ps.dateOfBirth),
          startAge * 12,
          ownPia ?? undefined,
          excessStartsLater
            ? (workerFilingYear - ps.birthYear) * 12
            : startAge * 12,
        );
        if (!excessStartsLater) annualAmount = withExcess;
        else if (withExcess > annualAmount)
          fromSpouseFiling = {
            year: workerFilingYear,
            annualAmount: withExcess,
          };
      }
    }

    return {
      personId: ps.personId,
      personName: ps.name,
      annualAmount,
      startAge,
      birthYear: ps.birthYear,
      ...(fromSpouseFiling ? { fromSpouseFiling } : {}),
    };
  });
}
