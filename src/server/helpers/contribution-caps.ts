/**
 * The IRS-limit cap pass over a set of effective contribution rows — run
 * once per set, right after the profile (and any What-If sandbox) is
 * applied, before any yearly figure is computed. Each row keeps its
 * configured `contributionValue` (editors, saves and diffs read it) and
 * gains `cappedValue` (what every calculation reads, via computeValue) and
 * `cap` (the module's verdict: how much over, the most it can be, why).
 * The rule itself lives in lib/pure/contribution-caps.ts.
 */
import {
  capContributionsByLimitGroup,
  capMessage,
  type CapPassed,
} from "@/lib/pure/contribution-caps";
import { TRPCError } from "@trpc/server";
import { getAllPeople } from "./people";
import { accountDisplayName } from "@/lib/utils/format";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";
import {
  getLimitGroup,
  isPreTaxTreatment,
  isHsaTreatment,
} from "@/lib/config/account-types";
import { isPaidThroughPayroll } from "@/lib/calculators/paycheck";
import { sumBy } from "@/lib/utils/math";
import { computeGroupedEmployerMatch } from "./contribution-match";
import {
  applyContribActiveFields,
  contribRowAmounts,
  type ContribRow,
  type JobRef,
  type JobSalaryRef,
} from "./contribution";
import { getPrimaryPerson, type Db } from "./transforms";
import { asc, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { findActiveJob, type JobLike } from "@/lib/pure/profiles";
import {
  pickProfileSettingsRow,
  resolveRetirementProfileIdFrom,
} from "./retirement-profile";
import {
  loadEffectiveSalaryProfile,
  mergeSalaryProfileJobFields,
  thisYearJobPay,
  type SalaryActiveMap,
  type SalaryProfileActiveMap,
} from "./salary";

export type CappedRowFields = CapPassed;

export type CapPassContext = {
  activeJobs: readonly JobRef[];
  /** Each job's pay; `totalComp` = salary + bonus (W-2 taxable pay before
   *  pre-tax money) bounds an IRA. */
  jobSalaries: readonly (JobSalaryRef & { totalComp?: number })[];
  people: readonly { id: number; birthYear: number | null }[];
  limits: Record<string, number>;
  filingStatus: string;
  taxYear: number;
};

/** What the pass needs from the household — the same for every set of
 *  rows in a request (this tax year), whichever profile's pay applies. */
export type CapPassHousehold = Omit<
  CapPassContext,
  "activeJobs" | "jobSalaries"
>;

/** The fields of an effective contribution row the pass reads — DB rows,
 *  profile- and sandbox-resolved rows and engine input rows all fit. */
export type CapPassRow = {
  id: number;
  personId: number | null;
  jobId: number | null;
  accountType: string;
  subType?: string | null;
  label?: string | null;
  parentCategory?: string | null;
  contributionMethod: string | null;
  contributionValue: string | number | null;
  taxTreatment: string | null;
  employerMatchType: string | null;
  employerMatchValue: string | number | null;
  employerMaxMatchPct: string | number | null;
  isPayrollDeducted?: boolean | null;
  fromBonus?: boolean;
  hsaCoverageType?: string | null;
};

/** The aggregate's row shape, from a pass row. */
const asContribRow = (c: CapPassRow): ContribRow => ({
  id: c.id,
  personId: c.personId,
  jobId: c.jobId,
  accountType: c.accountType as ContribRow["accountType"],
  subType: c.subType ?? null,
  label: c.label ?? null,
  parentCategory: c.parentCategory ?? "",
  contributionMethod: c.contributionMethod ?? "percent_of_salary",
  contributionValue: c.contributionValue ?? 0,
  taxTreatment: c.taxTreatment ?? "pre_tax",
  employerMatchType: c.employerMatchType,
  employerMatchValue:
    c.employerMatchValue == null ? null : String(c.employerMatchValue),
  employerMaxMatchPct:
    c.employerMaxMatchPct == null ? null : String(c.employerMaxMatchPct),
  isPayrollDeducted: c.isPayrollDeducted,
  fromBonus: c.fromBonus,
});

export function capEffectiveContribs<R extends CapPassRow>(
  rows: readonly R[],
  ctx: CapPassContext,
): (R & CappedRowFields)[] {
  // Always from the configured values (a re-run never compounds).
  const configured = rows.map(({ ...r }) => {
    const fields = r as Partial<CappedRowFields>;
    delete fields.cappedValue;
    delete fields.cap;
    delete (fields as { capPassed?: true }).capPassed;
    return r as R;
  });
  const { annualById, salaryById } = contribRowAmounts(
    configured.map(asContribRow),
    ctx.activeJobs,
    ctx.jobSalaries,
  );
  const matchRows = (scaled: ReadonlySet<number>, factor: number) =>
    configured.map((c) => ({
      id: c.id,
      jobId: c.jobId,
      personId: c.personId,
      accountType: c.accountType,
      parentCategory: c.parentCategory ?? "",
      annual: annualById.get(c.id)! * (scaled.has(c.id) ? factor : 1),
      salary: salaryById.get(c.id)!,
      employerMatchType: c.employerMatchType,
      employerMatchValue: Number(c.employerMatchValue ?? 0),
      employerMaxMatchPct: Number(c.employerMaxMatchPct ?? 0),
      employerMatchTaxTreatment: "pre_tax" as const,
    }));
  const matchAt1 = computeGroupedEmployerMatch(matchRows(new Set(), 1));

  const { byRow } = capContributionsByLimitGroup(
    configured.map((c) => ({
      id: c.id,
      personId: c.personId,
      accountType: c.accountType,
      hsaCoverageType: c.hsaCoverageType ?? null,
      regularAnnual: annualById.get(c.id)!,
      bonusAnnual: 0,
      employerAnnual: matchAt1.get(c.id)!.matchAnnual,
      // Pre-tax and HSA payroll money is left out of W-2 wages.
      reducesCompensation:
        isPaidThroughPayroll(c) &&
        (isPreTaxTreatment(c.taxTreatment ?? "pre_tax") ||
          isHsaTreatment(c.taxTreatment ?? "pre_tax")),
    })),
    {
      taxYear: ctx.taxYear,
      filingStatus: ctx.filingStatus,
      limits: ctx.limits,
      people: ctx.people.map((p) => ({
        ...p,
        wages: sumBy(
          ctx.jobSalaries.filter((js) => js.job.personId === p.id),
          (js) => js.totalComp ?? js.salary,
        ),
      })),
      // A match figured on the contribution moves with the cut.
      employerAt: (rowIds, factor) => {
        const ids = new Set(rowIds);
        const m = computeGroupedEmployerMatch(matchRows(ids, factor));
        return sumBy(rowIds, (id) => m.get(id)!.matchAnnual);
      },
    },
  );

  // A row's own most: the person's room in the group less their other
  // rows there as configured — what the row can be set to on its own.
  const groupKey = (c: R) =>
    `${c.personId ?? "joint"}:${getLimitGroup(c.accountType)}`;
  const configuredByGroup = new Map<string, number>();
  for (const c of configured)
    if (getLimitGroup(c.accountType))
      configuredByGroup.set(
        groupKey(c),
        (configuredByGroup.get(groupKey(c)) ?? 0) + byRow.get(c.id)!.annual,
      );
  return configured.map((c) => {
    const cap = byRow.get(c.id)!;
    if (!getLimitGroup(c.accountType)) return { ...c, capPassed: true };
    const value = Number(c.contributionValue ?? 0);
    const factor = cap.annual > 0 ? cap.cappedAnnual / cap.annual : 1;
    const others = configuredByGroup.get(groupKey(c))! - cap.annual;
    const rowMost =
      cap.maxEmployee === null ? null : Math.max(0, cap.maxEmployee - others);
    return {
      ...c,
      capPassed: true,
      cap,
      cappedValue: value * factor,
      ...(rowMost !== null && cap.annual > 0
        ? { maxValue: (value * rowMost) / cap.annual, othersInGroup: others }
        : {}),
    };
  });
}

/**
 * The household's cap context for a request: who (birth years), the year's
 * limits, and the household's filing status — the active retirement
 * profile's, as the projection uses (a W-4 status is a withholding
 * choice, not the household's).
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
): Promise<CapPassHousehold> {
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
  return {
    people: people.map((p) => ({
      id: p.id,
      birthYear: Number(p.dateOfBirth.slice(0, 4)),
    })),
    limits:
      limits ??
      Object.fromEntries(limitRows.map((l) => [l.limitType, Number(l.value)])),
    filingStatus: settings?.filingStatus ?? "",
    taxYear,
  };
}

/**
 * Cap a request's effective rows: each person's active job paid this
 * year's pay (thisYearJobPay — the same pay the request's figures use).
 */
export function capForRequest<R extends CapPassRow>(
  rows: readonly R[],
  household: CapPassHousehold,
  jobs: readonly (JobRef & JobLike)[],
  salaryProfileActiveMap: SalaryProfileActiveMap,
  salaryActiveMap: SalaryActiveMap,
): (R & CappedRowFields)[] {
  const activeJobs = household.people.flatMap((p) => {
    const job = findActiveJob([...jobs], p.id);
    return job ? [job] : [];
  });
  return capEffectiveContribs(rows, {
    ...household,
    activeJobs,
    jobSalaries: activeJobs.map((job) => {
      const pay = thisYearJobPay(job, salaryProfileActiveMap, salaryActiveMap);
      return {
        job: { id: job.id, personId: job.personId },
        salary: pay.salary,
        bonusGross: pay.bonusGross,
        totalComp: pay.totalComp,
      };
    }),
  });
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
export type ContribSaveCheck = {
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

/**
 * Refuse a save that makes a contribution over its IRS limit, or more over
 * it — the household's rule: over the limit is an error to fix, never
 * modelled. Before and after go through the same cap pass; a save is
 * refused when a person's limit group it touches ends up further over than
 * it was (so lowering an over-limit row always saves, and an unrelated edit
 * leaves the row showing its error). Only the active Contribution Profile
 * is judged: any other one is checked where it's used (a switch year's ages
 * and pay). The message carries the most each row can be.
 */
export async function assertWithinIrsLimits(
  db: Db,
  check: ContribSaveCheck,
): Promise<void> {
  if (check.touched.length === 0) return;
  const [allContribs, allJobs, people, salaryMap, activeSetting] =
    await Promise.all([
      db.select().from(schema.contributionAccounts),
      db.select().from(schema.jobs),
      getAllPeople(db),
      loadEffectiveSalaryProfile(db, null),
      db
        .select({ value: schema.appSettings.value })
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, SK_ACTIVE_CONTRIB_PROFILE_ID)),
    ]);
  const activeId = Number(activeSetting[0]?.value ?? NaN);
  if (check.profileId !== null && check.profileId !== activeId) return;
  let profileFields: AccountFields = {};
  if (check.before === undefined || check.after === undefined) {
    const [active] = Number.isFinite(activeId)
      ? await db
          .select()
          .from(schema.contributionProfiles)
          .where(eq(schema.contributionProfiles.id, activeId))
      : [];
    profileFields =
      (
        active?.contributionActiveFields as
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
      household,
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
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const problems = after.flatMap((c) => {
    if (!check.touched.includes(c.id) || !c.cap) return [];
    if ((now.get(keyOf(c)) ?? 0) <= (was.get(keyOf(c)) ?? 0) + 0.01) return [];
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
  if (problems.length > 0)
    throw new TRPCError({ code: "BAD_REQUEST", message: problems.join(" ") });
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
