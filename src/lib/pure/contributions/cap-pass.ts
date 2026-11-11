/** The IRS-limit cap pass: a row keeps `contributionValue` and gains `cappedValue` (what every figure reads) and `cap`. */
import {
  type CapPassed,
  capContributionsByLimitGroup,
} from "./contribution-caps";
import {
  isPreTaxTreatment,
  isHsaTreatment,
  getLimitGroup,
} from "@/lib/config/account-types";
import { isPaidThroughPayroll } from "@/lib/pure/paycheck/bonus";
import { sumBy } from "@/lib/utils/math";
import { jobPay, planEmployer } from "./annual-additions";
import { computeGroupedEmployerMatch, storedMatchRate } from "./employer-match";
import {
  type JobRef,
  type JobSalaryRef,
  type ContributionRow,
  contributionRowAmounts,
} from "./contribution-rows";
import {
  type JobLike,
  filterActiveJobs,
  whatIfForJob,
} from "@/lib/pure/household/profiles";
import {
  type SalaryProfileActiveMap,
  type SalaryActiveMap,
  thisYearJobPay,
} from "@/lib/pure/household/compensation";

export type CappedRowFields = CapPassed;

export type CapPassContext = {
  activeJobs: readonly JobRef[];
  /** Each job's pay; `totalComp` = salary + bonus (W-2 pay before pre-tax money) bounds an IRA. */
  jobSalaries: readonly (JobSalaryRef & { totalComp?: number })[];
  people: readonly { id: number; birthYear: number | null }[];
  limits: Record<string, number>;
  filingStatus: string;
  taxYear: number;
};

/** What the pass needs from the household — the same for every set of
 *  rows in a request (this tax year), whichever profile's pay applies;
 *  CapRequestHousehold adds the request's date (capForRequest). */
export type CapPassHousehold = Omit<
  CapPassContext,
  "activeJobs" | "jobSalaries"
>;
export type CapRequestHousehold = CapPassHousehold & { asOf: Date };

/** The fields of an effective row the pass reads (DB, profile, sandbox, engine rows). */
export type CapPassRow = {
  id: number;
  personId: number | null;
  jobId: number | null;
  accountType: string;
  subType?: string | null;
  label?: string | null;
  parentCategory?: string | null;
  contributionMethod: ContributionRow["contributionMethod"] | null;
  contributionValue: string | number | null;
  taxTreatment: string | null;
  employerMatchType: ContributionRow["employerMatchType"];
  employerMatchValue: string | number | null;
  employerMatchRate?: string | number | null;
  employerMaxMatchPct: string | number | null;
  isPayrollDeducted?: boolean | null;
  fromBonus?: boolean;
  hsaCoverageType?: string | null;
};

/** The aggregate's row shape, from a pass row. */
const asContributionRow = (c: CapPassRow): ContributionRow => ({
  id: c.id,
  personId: c.personId,
  jobId: c.jobId,
  accountType: c.accountType as ContributionRow["accountType"],
  subType: c.subType ?? null,
  label: c.label ?? null,
  parentCategory: c.parentCategory ?? "",
  contributionMethod: c.contributionMethod ?? "percent_of_salary",
  contributionValue: c.contributionValue ?? 0,
  taxTreatment: c.taxTreatment ?? "pre_tax",
  employerMatchType: c.employerMatchType,
  employerMatchValue:
    c.employerMatchValue == null ? null : String(c.employerMatchValue),
  employerMatchRate: c.employerMatchRate,
  employerMaxMatchPct:
    c.employerMaxMatchPct == null ? null : String(c.employerMaxMatchPct),
  isPayrollDeducted: c.isPayrollDeducted,
  fromBonus: c.fromBonus,
});

/** Run once per row set: after the profile and any What-If sandbox apply, before any yearly figure. */
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
  const { annualById, salaryById } = contributionRowAmounts(
    configured.map(asContributionRow),
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
      employerMatchRate: storedMatchRate(c.employerMatchRate),
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
      employer: planEmployer(c.jobId, ctx.jobSalaries),
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
          jobPay,
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

/** Cap a request's effective rows: every job each person holds counts, paid this year's pay
 *  (IRC 219(f)(1); thisYearJobPay; a What-If salary is the current job's only, whatIfForJob). */
export function capForRequest<R extends CapPassRow>(
  rows: readonly R[],
  household: CapRequestHousehold,
  jobs: readonly (JobRef & JobLike)[],
  salaryProfileActiveMap: SalaryProfileActiveMap,
  salaryActiveMap: SalaryActiveMap,
): (R & CappedRowFields)[] {
  // Jobs held on the request's date in its tax year, else on Dec 31.
  const asOf =
    household.taxYear === household.asOf.getFullYear()
      ? household.asOf
      : new Date(household.taxYear, 11, 31);
  const activeJobs = filterActiveJobs(jobs, asOf).filter((j) =>
    household.people.some((p) => p.id === j.personId),
  );
  return capEffectiveContribs(rows, {
    ...household,
    activeJobs,
    jobSalaries: activeJobs.map((job) => {
      const whatIf = whatIfForJob(job, jobs, asOf, salaryActiveMap);
      const pay = thisYearJobPay(job, salaryProfileActiveMap, whatIf);
      const { salary, bonusGross, totalComp } = pay;
      return { job, salary, bonusGross, totalComp };
    }),
  });
}
