import { capMessage } from "@/lib/pure/contributions/contribution-caps";
import { TRPCError } from "@trpc/server";
import { getAllPeople } from "@/server/data/people";
import { thisYearFilingStatus } from "@/server/services/tax/filing-status";
import type { FilingStatusSource } from "@/lib/pure/tax/filing-status";
import { accountDisplayName } from "@/lib/utils/account-name";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";
import { getLimitGroup } from "@/lib/config/account-types";
import { applyContribActiveFields } from "./profile";
import type {
  JobRef,
  JobSalaryRef,
} from "@/lib/pure/contributions/contribution-rows";
import { getPrimaryPerson } from "@/lib/pure/household/primary-person";
import { asc, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import {
  pickProfileSettingsRow,
  resolveRetirementProfileIdFrom,
} from "@/lib/pure/household/retirement-profile";
import { householdRetirementYear } from "@/server/services/profiles/retirement-year";
import {
  type SalaryProfileActiveMap,
  mergeSalaryProfileJobFields,
} from "@/lib/pure/household/compensation";
import { loadEffectiveSalaryProfile } from "@/server/services/profiles/salary-profile";
import type { Db } from "@/lib/db";
import {
  capEffectiveContribs,
  capForRequest,
  type CapPassHousehold,
  type CapPassRow,
  type CappedRowFields,
} from "@/lib/pure/contributions/cap-pass";

/**
 * The household's cap context for a request: who (birth years), the year's
 * limits, and this year's filing status (lib/pure/tax/filing-status.ts — a W-4
 * status is a withholding choice, only a last stand-in). The paycheck's
 * household tax and Roth IRA view read it from here too, so there is one
 * answer.
 */
export async function loadCapHousehold(
  db: Db,
  people: readonly {
    id: number;
    dateOfBirth: string;
    isPrimaryUser: boolean;
  }[],
  /** The year's limits; null = load the tax year's contribution limits. */
  limits: Record<string, number> | null,
  taxYear: number,
  /** The request's Salary Profile (What-If included) for a W-4 stand-in. */
  salaryProfileActiveMap?: SalaryProfileActiveMap,
): Promise<
  CapPassHousehold & { filingStatusSource: FilingStatusSource | null }
> {
  const [appSettings, retSettings, retProfiles, limitRows] = await Promise.all([
    db.select().from(schema.appSettings),
    db.select().from(schema.retirementSettings),
    db
      .select()
      .from(schema.retirementProfiles)
      .orderBy(asc(schema.retirementProfiles.id)),
    limits
      ? Promise.resolve([])
      : db
          .select()
          .from(schema.contributionLimits)
          .where(eq(schema.contributionLimits.taxYear, taxYear)),
  ]);
  const settings = pickProfileSettingsRow(
    retSettings,
    resolveRetirementProfileIdFrom(appSettings, retProfiles),
    getPrimaryPerson([...people])?.id ?? null,
  );
  // This year's return (server/services/tax/filing-status.ts); unknown —
  // married rules off, never assumed.
  const thisYear = await thisYearFilingStatus(db, {
    appSettings,
    profileStatus: settings?.filingStatus,
    people,
    salaryProfileActiveMap,
  });
  return {
    people: people.map((p) => ({
      id: p.id,
      birthYear: Number(p.dateOfBirth.slice(0, 4)),
    })),
    limits:
      limits ??
      Object.fromEntries(limitRows.map((l) => [l.limitType, Number(l.value)])),
    filingStatus: thisYear.status ?? "",
    filingStatusSource: thisYear.source,
    taxYear,
  };
}

/** A resolved profile's rows capped on that profile's own jobs and pay
 *  (resolveProfile's output). */
export function capResolvedProfile<
  R extends CapPassRow,
  J extends JobRef,
  S extends JobSalaryRef & { totalComp?: number },
>(
  resolved: { activeContribs: R[]; activeJobs: J[]; jobSalaries: S[] },
  household: CapPassHousehold,
): (R & CappedRowFields)[] {
  return capEffectiveContribs(resolved.activeContribs, {
    ...household,
    activeJobs: resolved.activeJobs,
    jobSalaries: resolved.jobSalaries,
  });
}

type AccountFields = Record<string, Record<string, unknown>>;

export type ContribRowPatch = Partial<
  typeof schema.contributionAccounts.$inferSelect
>;

/** What a contribution save changes, before and after. */
type ContribSaveCheck = {
  /** The Contribution Profile the fields belong to; null = an account edit,
   *  judged under the active profile. */
  profileId: number | null;
  /** The profile's account fields before and after (absent: unchanged). */
  before?: AccountFields;
  after?: AccountFields;
  /** Account rows as they'd be after the save (account edits). */
  rowsAfter?: ReadonlyMap<number, ContribRowPatch>;
  /** The accounts the save sets something on. */
  touched: readonly number[];
};

/** The active Contribution Profile's id (NaN when none is set). */
async function activeContribProfileId(db: Db): Promise<number> {
  const [row] = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, SK_ACTIVE_CONTRIB_PROFILE_ID));
  return Number(row?.value ?? NaN);
}

/**
 * What a save leaves over its IRS limit, one line per touched row: before
 * and after go through the same cap pass on this year's limits and pay,
 * at the ages of the year asked for (this year unless a switch is judged
 * later), and a row counts when a person's limit group it touches ends up
 * further over than it was (so lowering an over-limit row always saves,
 * and an unrelated edit leaves the row showing its error). Each line
 * carries the most the row can be. Loads once; the judge runs per year.
 */
async function irsLimitJudge(
  db: Db,
  check: ContribSaveCheck,
  judgedProfileId: number,
): Promise<(agesAsOf: number) => string[]> {
  const [allContribs, allJobs, people, salaryMap] = await Promise.all([
    db.select().from(schema.contributionAccounts),
    db.select().from(schema.jobs),
    getAllPeople(db),
    loadEffectiveSalaryProfile(db, null),
  ]);
  let profileFields: AccountFields = {};
  if (check.before === undefined || check.after === undefined) {
    const [judged] = Number.isFinite(judgedProfileId)
      ? await db
          .select()
          .from(schema.contributionProfiles)
          .where(eq(schema.contributionProfiles.id, judgedProfileId))
      : [];
    profileFields =
      (
        judged?.contributionActiveFields as
          { contributionAccounts?: AccountFields } | undefined
      )?.contributionAccounts ?? {};
  }
  const taxYear = new Date().getFullYear();
  const household = await loadCapHousehold(db, people, null, taxYear);
  if (Object.keys(household.limits).length === 0)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `The ${taxYear} IRS contribution limits aren't in the tax data yet, so this contribution can't be checked against them.`,
    });
  const jobs = mergeSalaryProfileJobFields(allJobs, salaryMap);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  return (agesAsOf) => {
    const passFor = (
      fields: AccountFields,
      rowsAfter?: ReadonlyMap<number, ContribRowPatch>,
    ) =>
      capForRequest(
        applyContribActiveFields(
          allContribs
            .map((c) => ({ ...c, ...rowsAfter?.get(c.id) }))
            .filter((c) => c.isActive),
          fields,
        ),
        { ...household, taxYear: agesAsOf },
        jobs,
        salaryMap,
        new Map(),
      );
    const before = passFor(check.before ?? profileFields);
    const after = passFor(check.after ?? profileFields, check.rowsAfter);
    const keyOf = (c: (typeof after)[number]) =>
      `${c.personId ?? "joint"}:${getLimitGroup(c.accountType)}`;
    const overBy = (rows: typeof after) => {
      const m = new Map<string, number>();
      for (const c of rows)
        if (c.cap) m.set(keyOf(c), (m.get(keyOf(c)) ?? 0) + c.cap.overBy);
      return m;
    };
    const was = overBy(before);
    const now = overBy(after);
    return after.flatMap((c) => {
      if (!check.touched.includes(c.id) || !c.cap) return [];
      if ((now.get(keyOf(c)) ?? 0) <= (was.get(keyOf(c)) ?? 0) + 0.01)
        return [];
      const owner = c.personId != null ? nameOf.get(c.personId) : undefined;
      const name = accountDisplayName(
        {
          accountType: c.accountType,
          subType: c.subType,
          label: c.label,
          ownershipType: c.ownership,
        },
        owner,
      );
      return [`${name}: ${capMessage(c)}`];
    });
  };
}

/**
 * Refuse a save that makes a contribution over its IRS limit, or more over
 * it — the household's rule: over the limit is an error to fix, never
 * modelled (irsLimitJudge). Only the active Contribution Profile is
 * refused; one used as a future switch gets a warning instead
 * (switchProfileLimitWarning).
 */
export async function assertWithinIrsLimits(
  db: Db,
  check: ContribSaveCheck,
): Promise<void> {
  if (check.touched.length === 0) return;
  const activeId = await activeContribProfileId(db);
  if (check.profileId !== null && check.profileId !== activeId) return;
  const problems = (await irsLimitJudge(db, check, activeId))(
    new Date().getFullYear(),
  );
  if (problems.length > 0)
    throw new TRPCError({ code: "BAD_REQUEST", message: problems.join(" ") });
}

/**
 * A save to a Contribution Profile that isn't active but is a switch in
 * the Retirement settings ("Changes by year"): what it leaves over the IRS
 * limits in the years it's in effect, as a warning — it still saves. Each
 * year is judged at that year's ages on today's limits and pay, as the
 * projection caps it (buildProfileSwitches). A switch is in effect from its
 * year until the next Contribution Profile switch, through the last
 * working year. Null when the profile is active, not used as a switch, or
 * within the limits every year.
 */
export async function switchProfileLimitWarning(
  db: Db,
  check: ContribSaveCheck & { profileId: number },
): Promise<string | null> {
  if (check.touched.length === 0) return null;
  if (check.profileId === (await activeContribProfileId(db))) return null;
  const thisYear = new Date().getFullYear();
  const [switchRows, profiles, retirementYear] = await Promise.all([
    db
      .select({
        year: schema.retirementSalaryOverrides.projectionYear,
        profileId: schema.retirementSalaryOverrides.contributionProfileId,
      })
      .from(schema.retirementSalaryOverrides),
    db
      .select({ id: schema.contributionProfiles.id })
      .from(schema.contributionProfiles),
    householdRetirementYear(db),
  ]);
  const lastWorkingYear =
    retirementYear !== null ? retirementYear - 1 : thisYear;
  // Rows naming a profile that still exists (as the projection reads them).
  const profileIds = new Set(profiles.map((p) => p.id));
  const contribSwitches = switchRows.filter(
    (r) => r.profileId != null && profileIds.has(r.profileId),
  );
  const years = new Set<number>();
  for (const row of contribSwitches) {
    if (row.profileId !== check.profileId) continue;
    const next = Math.min(
      ...contribSwitches.filter((o) => o.year > row.year).map((o) => o.year),
    );
    for (
      let y = Math.max(row.year, thisYear);
      y <= Math.min(next - 1, lastWorkingYear);
      y++
    )
      years.add(y);
  }
  if (years.size === 0) return null;
  const judge = await irsLimitJudge(db, check, check.profileId);
  const over = [...years]
    .sort((a, b) => a - b)
    .map((y) => ({ year: y, problems: judge(y) }))
    .filter((o) => o.problems.length > 0);
  if (over.length === 0) return null;
  const first = over[0]!;
  // The years over, as runs: "2038–2049, 2054".
  const runs: [number, number][] = [];
  for (const { year } of over) {
    const run = runs[runs.length - 1];
    if (run && run[1] === year - 1) run[1] = year;
    else runs.push([year, year]);
  }
  const when = runs
    .map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`))
    .join(", ");
  return `Over the IRS limits in ${when} at those years' ages (judged on today's limits and pay) — the projection cuts it to the limit then. ${first.year}: ${first.problems.join(" ")}`;
}

/** A ContribSaveCheck for helpers that can't import this module (it
 *  imports theirs) — they take it as a required argument. */
export type ContribSaveChecker = (
  db: Db,
  check: ContribSaveCheck,
) => Promise<void>;

/** The account ids a contribution-fields change sets a value on (value,
 *  method or active flag differ from before). */
export function touchedContribAccounts(
  before: Record<string, Record<string, unknown>> | undefined,
  after: Record<string, Record<string, unknown>>,
): number[] {
  const keys = ["contributionValue", "contributionMethod", "isActive"];
  return Object.keys(after)
    .filter((id) =>
      keys.some((k) => String(before?.[id]?.[k]) !== String(after[id]?.[k])),
    )
    .map(Number);
}
