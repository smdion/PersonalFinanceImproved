import { loadCapHousehold } from "@/server/services/contributions/caps";
import { capForRequest } from "@/lib/pure/contributions/cap-request";
import { getAllPeople } from "@/server/data/people";
import { eq, and, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@/lib/db/schema";
import { readContributionActiveFields } from "@/lib/db/stored-active-fields";
import { calculatePaycheck } from "@/lib/pure/paycheck/per-check";
import {
  mergeSalaryProfileJobFields,
  resolveCompensation,
  contributionPay,
} from "@/lib/pure/household/compensation";
import { buildPaycheckInputForJob } from "@/lib/pure/paycheck/paycheck-input";
import { loadEffectiveSalaryProfile } from "@/server/services/profiles/salary-profile";
import {
  fetchContributionProfile,
  applyContribActiveFields,
  applyDeductionActiveFields,
} from "@/server/services/contributions/profile";
import { buildContribAccounts } from "@/lib/pure/contributions/paycheck-accounts";
import { toNumber } from "@/lib/utils/numbers";
import { getPeriodsPerYear } from "@/lib/config/pay-periods";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";
import { buildBracketInput } from "@/lib/pure/paycheck/withholding";
import type { DeductionLine } from "@/lib/pure/paycheck/paycheck.types";
import type { PayPeriod } from "@/lib/config/enum-values";
import { resolveTaxParams } from "@/lib/pure/tax/resolve-tax-params";
import { ficaCapContext } from "@/lib/pure/contributions/irs-limits";
import {
  deductionLine,
  earningLines,
} from "@/lib/pure/paycheck/paycheck-lines";
import type { DbOrTx } from "@/lib/db";

/**
 * Net pay per check for a job from live data, persisted as a recorded fact (no What-If sandbox):
 * salary/schedule/W-4 from the active Salary Profile, deductions from the active Contribution
 * Profile. Also returns the resolved payPeriod/anchorPayDate. Throws if the job has no salary entry.
 */
export async function computeJobNetPayPerCheck(
  db: DbOrTx,
  jobId: number,
  asOfDate: Date,
): Promise<{
  netPayPerCheck: number;
  payPeriod: PayPeriod;
  anchorPayDate: string | null;
}> {
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId));
  if (!job)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Job not found",
    });

  const [
    allBracketRows,
    rawJobDeductions,
    rawJobContribs,
    rawPersonalContribs,
    allLimitRows,
    activeContribSetting,
    allTaxParams,
    [jobPerson],
  ] = await Promise.all([
    db.select().from(schema.taxBrackets),
    db
      .select()
      .from(schema.paycheckDeductions)
      .where(eq(schema.paycheckDeductions.jobId, jobId)),
    db
      .select()
      .from(schema.contributionAccounts)
      .where(
        and(
          eq(schema.contributionAccounts.jobId, jobId),
          eq(schema.contributionAccounts.isActive, true),
        ),
      ),
    db
      .select()
      .from(schema.contributionAccounts)
      .where(
        and(
          isNull(schema.contributionAccounts.jobId),
          eq(schema.contributionAccounts.personId, job.personId),
          eq(schema.contributionAccounts.isActive, true),
        ),
      ),
    db.select().from(schema.contributionLimits),
    db
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, SK_ACTIVE_CONTRIB_PROFILE_ID)),
    db.select().from(schema.taxParams),
    db
      .select({ dateOfBirth: schema.people.dateOfBirth })
      .from(schema.people)
      .where(eq(schema.people.id, job.personId)),
  ]);

  // Same resolver as the retirement engine and paycheck. Always the current
  // year (newest enacted); `onMissing: "nearest"` covers a year with no rows yet.
  const resolvedTax = resolveTaxParams(
    {
      vintage: allTaxParams,
      contributionLimits: allLimitRows,
      withholdingBrackets: allBracketRows,
      ltcgBrackets: [],
      irmaaBrackets: [],
      fpl: [],
    },
    undefined,
    { onMissing: "nearest" },
  );
  const allBrackets = allBracketRows.filter(
    (b) => b.taxYear === resolvedTax.resolvedYear,
  );

  // Accounts carry no contribution value: the active Contribution Profile's.
  const activeContribProfileId = Number(activeContribSetting[0]?.value ?? NaN);
  const contribProfile = Number.isFinite(activeContribProfileId)
    ? await fetchContributionProfile(db, activeContribProfileId)
    : null;
  const contribActiveFieldsRoot = contribProfile
    ? readContributionActiveFields(
        contribProfile.contributionActiveFields,
        contribProfile.id,
      )
    : { contributionAccounts: {}, deductions: {} };
  const accountActiveFields = contribActiveFieldsRoot.contributionAccounts;
  const jobContribs = applyContribActiveFields(
    rawJobContribs,
    accountActiveFields,
  );
  const personalContribs = applyContribActiveFields(
    rawPersonalContribs,
    accountActiveFields,
  );
  const jobDeductions = applyDeductionActiveFields(
    rawJobDeductions,
    contribActiveFieldsRoot.deductions,
  );

  // Job tax-inputs (filing status, withholding, schedule) come from the
  // job's entry in the globally-ACTIVE Salary Profile — same "recorded
  // fact" resolution as salary itself, no field-level carve-out.
  const salaryProfileActiveMap = await loadEffectiveSalaryProfile(db, null);
  const salaryEntry = salaryProfileActiveMap.get(job.id);
  if (!salaryEntry) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Job ${jobId} has no entry in the active Salary Profile — add one before saving extra-paycheck routing.`,
    });
  }
  const resolvedJob = mergeSalaryProfileJobFields(
    [job],
    salaryProfileActiveMap,
  )[0]!;

  const limitsRecord: Record<string, number> = resolvedTax.limits;
  const limitsMap = new Map<string, number>(Object.entries(limitsRecord));

  const bracketRow = allBrackets.find(
    (b) =>
      b.filingStatus === salaryEntry.w4FilingStatus &&
      b.w4Checkbox === salaryEntry.w4Box2cChecked,
  );
  if (!bracketRow)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `No tax bracket data found for the filing status set by the active Salary Profile for job ${jobId}.`,
    });

  const comp = resolveCompensation(salaryProfileActiveMap, job.id);
  const currentSalary = comp.salary;
  const bonusTerms = comp.terms;
  const periodsPerYear = getPeriodsPerYear(salaryEntry.payPeriod);
  const taxBrackets = buildBracketInput(bracketRow, limitsMap, allBrackets);

  const deductions: DeductionLine[] = jobDeductions.map((d) =>
    deductionLine(d, toNumber(String(d.amountPerPeriod))),
  );
  const earnings = earningLines(
    await db
      .select()
      .from(schema.paycheckEarnings)
      .where(eq(schema.paycheckEarnings.jobId, job.id)),
    salaryEntry.otherEarnings,
  );

  // A person's IRS limit spans all their accounts: cap the household's
  // rows, then take this job's and this person's.
  const capped = new Map(
    capForRequest(
      applyContribActiveFields(
        await db
          .select()
          .from(schema.contributionAccounts)
          .where(eq(schema.contributionAccounts.isActive, true)),
        accountActiveFields,
      ),
      await loadCapHousehold(
        db,
        await getAllPeople(db),
        limitsRecord,
        asOfDate,
        resolvedTax.resolvedYear,
      ),
      mergeSalaryProfileJobFields(
        await db.select().from(schema.jobs),
        salaryProfileActiveMap,
      ),
      salaryProfileActiveMap,
      new Map(),
    ).map((c) => [c.id, c]),
  );
  const cappedRows = <T extends { id: number }>(rows: T[]) =>
    rows.map((c) => capped.get(c.id)!);
  const contribAccounts = buildContribAccounts(
    cappedRows(jobContribs),
    cappedRows(personalContribs.filter((c) => c.ownership !== "joint")),
    currentSalary,
    periodsPerYear,
    ficaCapContext(
      limitsRecord,
      jobPerson?.dateOfBirth ?? null,
      resolvedTax.resolvedYear,
    ),
    contributionPay(currentSalary, bonusTerms).bonusGross,
  );

  // No bonusOverride: this value is persisted as a recorded fact. resolvedJob
  // (Salary-Profile-merged) keeps pay schedule and W-4 in step with what this
  // function resolved contributions/deductions against.
  const paycheckInput = buildPaycheckInputForJob(resolvedJob, {
    salary: currentSalary,
    bonusTerms,
    bonusOverride: null,
    contributionAccounts: contribAccounts,
    deductions,
    earnings,
    taxBrackets,
    limitsMap,
    limitsRecord,
    asOfDate,
  });

  const paycheck = calculatePaycheck(paycheckInput);
  return {
    netPayPerCheck: Math.round(paycheck.netPay * 100) / 100,
    payPeriod: salaryEntry.payPeriod,
    anchorPayDate: salaryEntry.anchorPayDate,
  };
}
