/**
 * "Changes by year" rows that switch to another Contribution and/or Salary
 * Profile from a given year. `loadSwitchProfiles` fetches the profiles the
 * rows name; `buildProfileSwitches` turns each row into the engine's
 * `ProfileSwitch` (that profile's contribution specs, match and rate) and
 * the salary override a switched Salary Profile adds for that year. A
 * switch is capped at the IRS limits at each later year's ages, so one
 * row can add further switches to the same profile (catch-up room).
 */
import {
  capEffectiveContribs,
  type CappedRowFields,
  type CapPassContext,
  type CapPassHousehold,
  type CapPassRow,
} from "@/server/helpers/contribution-caps";
import { inArray } from "drizzle-orm";
import type { db as _db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import {
  toNumber,
  contributionPay,
  getTotalCompensation,
  resolveCompensation,
  resolveProfile,
  buildProfileContribData,
} from "@/server/helpers";
import type {
  SalaryEntryMap,
  SalaryProfileEntry,
  SalaryProfileActiveMap,
} from "@/server/helpers";
import type { AccountCategory, ProfileSwitch } from "@/lib/calculators/types";
import { sumBy, safeDivide } from "@/lib/utils/math";
import { FALLBACK_CONTRIBUTION_RATE } from "@/lib/constants";
import type { fetchRetirementData } from "../build-engine-payload";
import { retirementContributions } from "./retirement-contributions";

type Db = typeof _db;
type RetirementData = Awaited<ReturnType<typeof fetchRetirementData>>;
type SalaryOverrideRow = RetirementData["salaryOverrideRows"][number];

export async function loadSwitchProfiles(
  db: Db,
  profileSwitchOverrides: readonly SalaryOverrideRow[],
) {
  // Pre-resolve contribution profiles for profile-switch overrides
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

  // Same pre-resolution for the salary axis of a profile switch.
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
    switchSalaryProfileRows.map((p) => [p.id, p]),
  );

  return { switchProfileMap, switchSalaryProfileMap };
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
  // Build live data refs for resolveProfile (DB rows before current profile
  // applied). No contributionMethod/contributionValue here — accounts carry
  // no value of their own; resolveProfile adds those from the switched
  // profile's own active fields, excluding accounts it has no value for.
  const liveContribRows = allContribsRaw.map((c) => ({
    ...c,
    accountType: c.accountType as AccountCategory,
    parentCategory: c.parentCategory ?? "",
    taxTreatment: c.taxTreatment ?? "pre_tax",
    employerMatchType: c.employerMatchType ?? null,
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
  // The active Salary Profile's own salaries — this is the reference baseline a profile switch's stored salary override gets
  // GROWN from ("Profile salary overrides are in today's dollars; grow to
  // the switch year" below). A job has no
  // salary/bonus of its own — the globally-ACTIVE Salary Profile
  // (salaryProfileActiveMap, already loaded above) is the only live source.
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

  /** Each person's effective annual raise rate, keyed by personId. Derived
   *  from `perPersonSettings` (built above), whose `salaryAnnualIncrease`
   *  already resolves each person's own `retirement_settings` rate —
   *  active-profile-scoped — falling back to the primary's when that row
   *  carries no distinct rate. Reading it back here (instead of re-deriving
   *  from `retSettings`) is what keeps this map and the per-person UI control
   *  in exact agreement about a person's raise rate — the divergence an
   *  earlier version of this feature would have introduced. retirementSettings is
   *  per-person, so growing person B's future salary by person A's rate
   *  (what a naive fan-out would do) silently produces the wrong number. */
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

    // Salary side: the referenced Salary Profile's values are in today's
    // dollars, so grow them to the switch year.
    //
    // Only THIS row's own personId is injected. retirement_salary_overrides
    // has per-(person, year) grain, so pushing every person in the profile
    // from every row double-injects whenever two people's rows for the same
    // year reference profiles with overlapping personIds. A household-wide
    // switch is expressed as one row per person, each contributing its own
    // person's value.
    //
    // Only an entry that targets this person's active job carries a number
    // to grow. Someone the switch profile says nothing about is still
    // following their live salary, which the engine is already projecting
    // forward from; injecting anything for them here would compound a
    // second, redundant salary path.
    // salaryProfile.salaries is jobId-keyed (a Salary Profile targets
    // specific jobs, not people) — find this person's active job to look
    // up their entry. Assumes one active job per person, same as
    // everywhere else in the app.
    const switchSalaryEntriesByJob = (salaryProfile?.salaries ??
      {}) as SalaryEntryMap;
    const ownJob = activeJobs.find((j) => j.personId === override.personId);
    // `ownEntry` here is intentionally read loosely (no completeness
    // requirement) — a retirement_salary_overrides row only ever cares
    // whether THIS entry pins a `salary`/bonus terms to grow, the same
    // narrow presence rule this override mechanism has always used
    // (predates Stage B). A real Salary Profile entry saved through the
    // app is always complete-or-absent (salaryEntrySchema is `.strict()`),
    // but nothing here depends on that for the salary-injection math below
    // — see ownEntryNormalized further down for where completeness of the
    // OTHER 11 fields actually matters.
    const ownEntry = ownJob
      ? switchSalaryEntriesByJob[String(ownJob.id)]
      : undefined;
    // A profile entry pinning only bonus terms (no `salary`) is not a
    // salary to grow — same presence rule as before. Only the SALARY
    // field's presence decides whether this row injects anything.
    const ownBaseSalary = ownEntry?.salary;
    // Baseline this override replaces (salaryByPerson) is TOTAL comp
    // (totalCompFullFormula, salary + bonus) — growing bare `.salary` here
    // would silently drop the switched profile's bonus from projections.
    // Bonus fields may be absent even when salary is pinned (entries here
    // aren't guaranteed complete the way resolveCompensation's normal
    // callers assume), so missing bonus terms mean "no bonus," not NaN.
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

    // The switched profile's percent-of-salary contributions must be
    // computed against the SWITCHED job's compensation, not the globally
    // active Salary Profile's (liveJobSalaries) — otherwise a salary-profile
    // switch never reaches contribution math at all. Overlay only the
    // switched-to entry for this person's own job onto the live map; every
    // other job keeps following its live salary, same rule as the salary
    // override above.
    //
    // The 11 non-comp fields (pay schedule, W-4, bonus date/flags) fall
    // back to the LIVE Salary Profile's own entry for this job when the
    // switched-to entry doesn't set its own — a switch-year override that
    // only pins income shouldn't silently reset pay schedule/W-4. If a
    // field can't be resolved from EITHER side, this overlay is dropped
    // entirely rather than filling the gap with a hardcoded literal
    // ("biweekly"/"MFJ"/etc.) — a relocation comparison built on a
    // fabricated tax/schedule config is exactly the silent-wrong-number
    // failure mode this profile model exists to prevent (RULES.md's "no
    // hardcoded fallbacks"). Dropping the overlay falls through to using
    // this job's LIVE entry entirely for contribution math, a safe
    // degradation rather than a fabrication.
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
    ] as const satisfies readonly (keyof SalaryProfileEntry)[];
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
    const ownEntryNormalized: SalaryProfileEntry | undefined =
      ownBaseSalary !== undefined &&
      ownTotalComp !== undefined &&
      allNonCompFieldsResolved
        ? ({
            salary: ownBaseSalary,
            bonusPercent: ownEntry?.bonusPercent ?? 0,
            bonusMultiplier: ownEntry?.bonusMultiplier ?? 1,
            monthsInBonusYear: ownEntry?.monthsInBonusYear ?? 12,
            // Never carry a current-year pin into projection/contribution
            // math — see SalaryProfileEntry.bonusOverride's docblock.
            bonusOverride: null,
            ...nonCompFields,
          } as SalaryProfileEntry)
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

    // The switched profile's percent-of-salary contributions are computed
    // against the switched SALARY (when this row also pins one) — that's
    // what the coupled salary+contribution profile used to do, preserved now
    // that the two are separate entities.
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
 * A profile's rows capped at the IRS limits at each year's ages from
 * `fromYear` through `lastYear` (catch-up room from 50, the larger one at
 * 60–63): the first year always, then each year whose ages cap the rows
 * differently from the year before. Limits and pay stay today's — the
 * engine grows both and caps the growth itself (capSpecs).
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

  // Contribution rate ceiling for the switched profile:
  // - Both comp AND contribs > 0: compute the real ratio
  // - Comp > 0 but contribs = 0: the profile is INTENTIONALLY zero (e.g. a
  //   "Coast FIRE" profile — user is saying "stop contributing"). Use 0
  //   so the engine's rate path produces zero contributions. Before: this
  //   silently fell back to 0.25 which defeated the profile's intent.
  // - No comp (missing data): keep the fallback to avoid surprising behavior
  //   on broken profiles.
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
