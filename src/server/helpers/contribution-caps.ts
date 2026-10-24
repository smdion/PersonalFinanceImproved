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
import { toNumber } from "./transforms";

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

export function capEffectiveContribs<
  R extends ContribRow & { hsaCoverageType?: string | null },
>(rows: readonly R[], ctx: CapPassContext): (R & CappedRowFields)[] {
  // Always from the configured values (a re-run never compounds).
  const configured = rows.map(({ ...r }) => {
    delete (r as CappedRowFields).cappedValue;
    delete (r as CappedRowFields).cap;
    return r as R;
  });
  const { annualById, salaryById } = contribRowAmounts(
    configured,
    ctx.activeJobs,
    ctx.jobSalaries,
  );
  const matchRows = (scaled: ReadonlySet<number>, factor: number) =>
    configured.map((c) => ({
      id: c.id,
      jobId: c.jobId,
      personId: c.personId,
      accountType: c.accountType,
      parentCategory: c.parentCategory,
      annual: annualById.get(c.id)! * (scaled.has(c.id) ? factor : 1),
      salary: salaryById.get(c.id)!,
      employerMatchType: c.employerMatchType,
      employerMatchValue: toNumber(c.employerMatchValue),
      employerMaxMatchPct: toNumber(c.employerMaxMatchPct),
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
        (isPreTaxTreatment(c.taxTreatment) || isHsaTreatment(c.taxTreatment)),
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
