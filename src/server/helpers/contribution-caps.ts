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
  type CappedContribution,
} from "@/lib/pure/contribution-caps";
import {
  getLimitGroup,
  isPreTaxTreatment,
  isHsaTreatment,
} from "@/lib/config/account-types";
import { isPaidThroughPayroll } from "@/lib/calculators/paycheck";
import { sumBy } from "@/lib/utils/math";
import { computeGroupedEmployerMatch } from "./contribution-match";
import {
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
  thisYearJobPay,
  type SalaryActiveMap,
  type SalaryProfileActiveMap,
} from "./salary";

export type CappedRowFields = {
  /** The value calculations use: the configured value scaled to the IRS
   *  limit. Full precision — never rounded or stored. */
  cappedValue?: number;
  cap?: CappedContribution;
};

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
    delete (r as CappedRowFields).cappedValue;
    delete (r as CappedRowFields).cap;
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

  return configured.map((c) => {
    const cap = byRow.get(c.id)!;
    if (!getLimitGroup(c.accountType)) return c;
    const factor = cap.annual > 0 ? cap.cappedAnnual / cap.annual : 1;
    return {
      ...c,
      cap,
      cappedValue: Number(c.contributionValue ?? 0) * factor,
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
