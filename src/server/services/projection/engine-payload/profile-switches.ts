/**
 * "Changes by year" rows switching Contribution and/or Salary Profile from a year: the engine's
 * `ProfileSwitch` per row plus the salary override a switched Salary Profile adds. Capped at the
 * IRS limits at each later year's ages, so one row can add further switches (catch-up room).
 */
import {
  capEffectiveContribs,
  type CappedRowFields,
  type CapPassContext,
  type CapPassHousehold,
  type CapPassRow,
} from "@/lib/pure/contributions/cap-pass";
import { inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { checkSalaryEntries } from "@/lib/db/stored-salary-entries";
import {
  contributionPay,
  getTotalCompensation,
  resolveCompensation,
} from "@/lib/pure/household/compensation";
import { resolveProfile } from "@/server/services/contributions/profile";
import { buildProfileContribData } from "@/lib/pure/contributions/profile-contrib-data";
import { toNumber } from "@/lib/utils/numbers";
import type { SalaryProfileActiveMap } from "@/lib/pure/household/compensation";
import type { SalaryEntry } from "@/lib/db/salary-entry-defaults";
import type { AccountCategory } from "@/lib/config/account-types";
import type { ProfileSwitch } from "@/lib/pure/engine/types";
import { sumBy, safeDivide } from "@/lib/utils/math";
import { FALLBACK_CONTRIBUTION_RATE } from "@/lib/constants";
import type { fetchRetirementData } from "./load";
import { retirementContributions } from "./retirement-contributions";
import { missingSwitchProfileWarnings } from "./missing-switch-profiles";
import type { Db } from "@/lib/db";

type RetirementData = Awaited<ReturnType<typeof fetchRetirementData>>;
type SalaryOverrideRow = RetirementData["salaryOverrideRows"][number];

export async function loadSwitchProfiles(
  db: Db,
  profileSwitchOverrides: readonly SalaryOverrideRow[],
) {
  const profileSwitchProfileIds = Array.from(
    new Set(
      profileSwitchOverrides
        .map((o) => o.contributionProfileId!)
        .filter(Boolean),
    ),
  );
  const switchProfileRows =
    profileSwitchProfileIds.length > 0
      ? await db
          .select()
          .from(schema.contributionProfiles)
          .where(
            inArray(schema.contributionProfiles.id, profileSwitchProfileIds),
          )
      : [];
  const switchProfileMap = new Map(switchProfileRows.map((p) => [p.id, p]));

  const switchSalaryProfileIds = Array.from(
    new Set(
      profileSwitchOverrides.map((o) => o.salaryProfileId!).filter(Boolean),
    ),
  );
  const switchSalaryProfileRows =
    switchSalaryProfileIds.length > 0
      ? await db
          .select()
          .from(schema.salaryProfiles)
          .where(inArray(schema.salaryProfiles.id, switchSalaryProfileIds))
      : [];
  const switchSalaryProfileMap = new Map(
    switchSalaryProfileRows.map((p) => [p.id, checkSalaryEntries(p)]),
  );

  return {
    switchProfileMap,
    switchSalaryProfileMap,
    switchWarnings: missingSwitchProfileWarnings(
      profileSwitchOverrides,
      switchProfileMap,
      switchSalaryProfileMap,
    ),
  };
}

export function buildProfileSwitches<
  TJob extends Parameters<typeof buildProfileContribData>[1][number] & {
    personId: number;
  },
>({
  profileSwitchOverrides,
  switchProfileMap,
  switchSalaryProfileMap,
  allContribsRaw,
  activeJobs,
  salaryProfileActiveMap,
  perPersonSettings,
  primaryRaiseRate,
  currentYear,
  hasMultiplePeople,
  profileContribCtx,
  capHousehold,
  lastAccumulationYear,
}: {
  profileSwitchOverrides: readonly SalaryOverrideRow[];
  switchProfileMap: Awaited<
    ReturnType<typeof loadSwitchProfiles>
  >["switchProfileMap"];
  switchSalaryProfileMap: Awaited<
    ReturnType<typeof loadSwitchProfiles>
  >["switchSalaryProfileMap"];
  allContribsRaw: RetirementData["allContribsRaw"];
  activeJobs: TJob[];
  salaryProfileActiveMap: SalaryProfileActiveMap;
  perPersonSettings: readonly {
    personId: number;
    salaryAnnualIncrease: string | null;
  }[];
  primaryRaiseRate: number;
  currentYear: number;
  hasMultiplePeople: boolean;
  profileContribCtx: Parameters<typeof buildProfileContribData>[3];
  /** The household's cap context — each switch's rows are capped like the
   *  active profile's, on that profile's pay. */
  capHousehold: CapPassHousehold;
  /** The last working year (lastWorkingYear) — a switch's later
   *  catch-up room is looked for up to here. */
  lastAccumulationYear: number;
}) {
  const perPersonSalaryAdds: {
    personId: number;
    year: number;
    value: number;
  }[] = [];
  const householdSalaryAdds: {
    year: number;
    value: number;
    notes: string | undefined;
  }[] = [];
  // Live data refs for resolveProfile, with no contributionMethod/Value:
  // resolveProfile adds those from the switched profile's active fields,
  // excluding accounts it has no value for.
  const liveContribRows = allContribsRaw.map((c) => ({
    ...c,
    accountType: c.accountType as AccountCategory,
    parentCategory: c.parentCategory,
    taxTreatment: c.taxTreatment,
    employerMatchType: c.employerMatchType,
    employerMatchValue: c.employerMatchValue
      ? String(c.employerMatchValue)
      : null,
    employerMaxMatchPct: c.employerMaxMatchPct
      ? String(c.employerMaxMatchPct)
      : null,
    id: c.id,
    personId: c.personId,
    jobId: c.jobId,
    subType: c.subType,
    label: c.label ?? null,
  }));
  // The active Salary Profile's salaries (the only live source): the baseline
  // a switch's stored salary override is grown from below.
  const liveJobSalaries = activeJobs.map((j) => {
    const comp = resolveCompensation(salaryProfileActiveMap, j.id);
    return {
      job: { id: j.id, personId: j.personId },
      ...contributionPay(comp.salary, comp.terms),
      baseSalary: comp.salary,
      totalComp: getTotalCompensation(comp.salary, comp.terms),
    };
  });

  const profileSwitches: ProfileSwitch[] = [];

  /** Each person's raise rate, keyed by personId, read from `perPersonSettings`
   *  so it matches the per-person UI control exactly; each person grows by their
   *  own rate (falling back to the primary's). */
  const raiseRateByPerson = new Map(
    perPersonSettings.map((ps) => [
      ps.personId,
      toNumber(ps.salaryAnnualIncrease),
    ]),
  );

  for (const override of profileSwitchOverrides) {
    const contribProfileRaw = override.contributionProfileId
      ? switchProfileMap.get(override.contributionProfileId)
      : undefined;
    const contribProfile = contribProfileRaw ?? null;
    const salaryProfile = override.salaryProfileId
      ? (switchSalaryProfileMap.get(override.salaryProfileId) ?? null)
      : null;
    if (!contribProfile && !salaryProfile) continue;

    // Salary side: the Salary Profile's values are today's dollars, grown to the
    // switch year. Only THIS row's person, via their active job's entry, is
    // injected: overrides are per (person, year); others keep their live salary.
    const switchSalaryEntriesByJob = salaryProfile?.salaries ?? {};
    const ownJob = activeJobs.find((j) => j.personId === override.personId);
    // Read loosely: the salary math needs only `salary`/bonus terms;
    // ownEntryNormalized below is where the other fields' completeness counts.
    const ownEntry = ownJob
      ? switchSalaryEntriesByJob[String(ownJob.id)]
      : undefined;
    // A profile entry pinning only bonus terms (no `salary`) is not a
    // salary to grow — same presence rule as before. Only the SALARY
    // field's presence decides whether this row injects anything.
    const ownBaseSalary = ownEntry?.salary;
    // The baseline this replaces is TOTAL comp (salary + bonus), so grow total
    // comp; entries may lack bonus fields here, which means no bonus, not NaN.
    const ownTotalComp =
      ownBaseSalary !== undefined
        ? getTotalCompensation(ownBaseSalary, {
            bonusPercent:
              ownEntry?.bonusPercent != null
                ? String(ownEntry.bonusPercent)
                : null,
            bonusMultiplier:
              ownEntry?.bonusMultiplier != null
                ? String(ownEntry.bonusMultiplier)
                : null,
            monthsInBonusYear: ownEntry?.monthsInBonusYear ?? null,
          })
        : undefined;
    if (salaryProfile && ownBaseSalary !== undefined) {
      const yearsFromNow = override.projectionYear - currentYear;
      const personRaiseRate =
        raiseRateByPerson.get(override.personId) ?? primaryRaiseRate;
      const grownSalary =
        ownTotalComp! * Math.pow(1 + personRaiseRate, yearsFromNow);
      perPersonSalaryAdds.push({
        personId: override.personId,
        year: override.projectionYear,
        value: grownSalary,
      });
      // Also add to household-level overrides for single-person fallback
      if (!hasMultiplePeople) {
        householdSalaryAdds.push({
          year: override.projectionYear,
          value: grownSalary,
          notes: `Profile: ${salaryProfile.name}`,
        });
      }
    }

    // Contribution side. A salary-only switch has nothing to build here.
    if (!contribProfile) continue;

    // Percent-of-salary contributions use the SWITCHED comp for this person's job only.
    // Non-comp fields (schedule, W-4, bonus date/flags) fall back to the live entry; if
    // neither side has one, the overlay is dropped (live entry used), never hardcoded.
    const liveOwnEntry = ownJob
      ? salaryProfileActiveMap.get(ownJob.id)
      : undefined;
    const NON_COMP_FIELDS = [
      "payPeriod",
      "payWeek",
      "anchorPayDate",
      "budgetPeriodsPerMonth",
      "w4FilingStatus",
      "w4Box2cChecked",
      "additionalFedWithholding",
      "bonusMonth",
      "bonusDayOfMonth",
    ] as const satisfies readonly (keyof SalaryEntry)[];
    const nonCompFields: Record<string, unknown> = {};
    let allNonCompFieldsResolved = true;
    for (const field of NON_COMP_FIELDS) {
      const value = ownEntry?.[field] ?? liveOwnEntry?.[field];
      if (value === undefined) {
        allNonCompFieldsResolved = false;
        break;
      }
      nonCompFields[field] = value;
    }
    const ownEntryNormalized: SalaryEntry | undefined =
      ownBaseSalary !== undefined &&
      ownTotalComp !== undefined &&
      allNonCompFieldsResolved
        ? ({
            salary: ownBaseSalary,
            bonusPercent: ownEntry?.bonusPercent ?? 0,
            bonusMultiplier: ownEntry?.bonusMultiplier ?? 1,
            monthsInBonusYear: ownEntry?.monthsInBonusYear ?? 12,
            // Never carry a current-year pin into projection/contribution
            // math — see SalaryEntry.bonusOverride's docblock.
            bonusOverride: null,
            ...nonCompFields,
          } as SalaryEntry)
        : undefined;
    const switchedSalaryProfileActiveMap =
      ownJob && ownEntryNormalized !== undefined
        ? new Map(salaryProfileActiveMap).set(ownJob.id, ownEntryNormalized)
        : salaryProfileActiveMap;
    const switchJobSalaries = salaryProfile
      ? activeJobs.map((j) => {
          const comp = resolveCompensation(
            switchedSalaryProfileActiveMap,
            j.id,
          );
          return {
            job: { id: j.id, personId: j.personId },
            ...contributionPay(comp.salary, comp.terms),
            baseSalary: comp.salary,
            totalComp: getTotalCompensation(comp.salary, comp.terms),
          };
        })
      : liveJobSalaries;

    // Percent-of-salary contributions are computed against the switched SALARY
    // when this row also sets one.
    const resolved = resolveProfile(
      contribProfile,
      liveContribRows,
      activeJobs,
      switchJobSalaries,
      switchedSalaryProfileActiveMap,
    );

    // The switch runs until the next Contribution Profile switch (whoever
    // its row is for) or the last working year. A switch in the past or
    // this year is capped at this year's ages.
    const nextSwitchYear = Math.min(
      ...profileSwitchOverrides
        .filter(
          (o) =>
            o.contributionProfileId &&
            switchProfileMap.has(o.contributionProfileId) &&
            o.projectionYear > override.projectionYear,
        )
        .map((o) => o.projectionYear),
    );
    const steps = capAgeSteps(
      resolved.activeContribs.map((c) => ({
        ...c,
        accountType: c.accountType as AccountCategory,
      })),
      {
        ...capHousehold,
        activeJobs: resolved.activeJobs,
        jobSalaries: resolved.jobSalaries,
      },
      Math.max(override.projectionYear, currentYear),
      Math.min(nextSwitchYear - 1, lastAccumulationYear),
    );
    steps.forEach((step, i) =>
      profileSwitches.push(
        profileSwitchFrom(
          i === 0 ? override.projectionYear : step.year,
          step.capped,
          resolved,
          profileContribCtx,
        ),
      ),
    );
  }

  // Sort profile switches by year
  profileSwitches.sort((a, b) => a.year - b.year);
  return { profileSwitches, perPersonSalaryAdds, householdSalaryAdds };
}

/**
 * A profile's rows capped at the IRS limits at each year's ages, `fromYear` through `lastYear`:
 * the first year, then each year whose ages cap them differently. Limits and pay stay today's;
 * the engine grows both and caps the growth itself (capSpecs).
 */
export function capAgeSteps<R extends CapPassRow>(
  rows: readonly R[],
  ctx: CapPassContext,
  fromYear: number,
  lastYear: number,
): { year: number; capped: (R & CappedRowFields)[] }[] {
  const steps: { year: number; capped: (R & CappedRowFields)[] }[] = [];
  let previous: string | null = null;
  for (let year = fromYear; previous === null || year <= lastYear; year++) {
    const capped = capEffectiveContribs(rows, { ...ctx, taxYear: year });
    const cut = JSON.stringify(capped.map((c) => c.cappedValue ?? null));
    if (cut === previous) continue;
    previous = cut;
    steps.push({ year, capped });
  }
  return steps;
}

/** The engine's switch to a profile's capped rows from `year`: its specs,
 *  match and retirement contribution rate on that profile's pay. */
export function profileSwitchFrom(
  year: number,
  capped: Parameters<typeof buildProfileContribData>[0],
  resolved: {
    activeJobs: Parameters<typeof buildProfileContribData>[1];
    jobSalaries: Parameters<typeof buildProfileContribData>[2] &
      readonly { totalComp: number }[];
  },
  profileContribCtx: Parameters<typeof buildProfileContribData>[3],
): ProfileSwitch {
  const data = buildProfileContribData(
    capped,
    resolved.activeJobs,
    resolved.jobSalaries,
    profileContribCtx,
  );

  // Compute per-profile contribution rate ceiling (retirement
  // contributions only — see retirementContributions)
  const switchedTotalComp = sumBy(resolved.jobSalaries, (js) => js.totalComp);
  const switchedContribRate = safeDivide(
    retirementContributions(data.contributionSpecs),
    switchedTotalComp,
    0,
  );

  // Rate ceiling for the switched profile: the real ratio when comp and
  // contribs > 0; 0 when comp > 0 but contribs = 0 (an intentionally zero
  // profile); the fallback only when comp is missing.
  const rateForSwitch =
    switchedContribRate > 0
      ? switchedContribRate
      : switchedTotalComp > 0
        ? 0
        : FALLBACK_CONTRIBUTION_RATE;

  return {
    year,
    contributionSpecs: data.contributionSpecs,
    employerMatchRateByCategory: data.employerMatchRateByCategory,
    baseYearContributions: data.baseYearContributions,
    baseYearEmployerMatch: data.baseYearEmployerMatch,
    employerMatchByParentCat: data.employerMatchByParentCat,
    contributionRate: rateForSwitch,
    retirementOnly: data.retirementOnly,
  };
}

/** A profile's age steps as of `year`: the latest step by then, moved to
 *  start at `year` (undefined before the first). */
export function ageStepAt(
  steps: readonly ProfileSwitch[],
  year: number,
): ProfileSwitch | undefined {
  const step = steps.filter((s) => s.year <= year).at(-1);
  return step ? { ...step, year } : undefined;
}
