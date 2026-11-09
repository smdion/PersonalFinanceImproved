import type { AccountCategory } from "@/lib/config/account-types";
import {
  getDisplayConfig,
  isAfterTaxTreatment,
  isHsaTreatment,
  isOverflowTarget,
  isPreTaxTreatment,
  isRetirementCategory,
  isTaxFree,
} from "@/lib/config/account-types";
import { DEFAULT_PAY_PERIODS_PER_YEAR } from "@/lib/constants";
import { computeAnnualContribution } from "@/lib/pure/contributions/contribution-amount";
import { capMessage } from "@/lib/pure/contributions/contribution-caps";
import { resolveIrsLimit } from "@/lib/pure/contributions/irs-limits";
import type { AccountViewMetrics } from "@/lib/pure/contributions/view-metrics";
import {
  contribRemainingFraction,
  monthsDoneYtd,
  periodsElapsedYtd,
} from "@/lib/pure/paycheck/pay-periods-in-year";
import { isPaidThroughPayroll } from "@/lib/pure/paycheck/bonus";
import { roundToCents } from "@/lib/utils/math";
import { toNumber } from "@/lib/utils/numbers";
import type { ContributionAccountRow } from "@/lib/pure/contributions/contribution-account-row";
import type {
  AccountTypeSnapshot,
  PersonSnapshot,
} from "@/lib/pure/contributions/summary.types";

export function jointAccountRows(
  jointContribs: ContributionAccountRow[],
  results: PersonSnapshot[],
  perfLabelMap: Map<number, string>,
  asOfDate: Date,
  liveThroughToday: Set<number>,
  perfActualMap: Map<number, { contributions: number; employerMatch: number }>,
  contributedThrough: Map<number, string>,
  householdAge: number,
  limitsRecord: Record<string, number>,
  jointAccountTypes: AccountTypeSnapshot[],
) {
  for (const c of jointContribs) {
    const val = toNumber(String(c.contributionValue));
    const periodsPerYear =
      results[0]?.periodsPerYear ?? DEFAULT_PAY_PERIODS_PER_YEAR;
    const annual = computeAnnualContribution(
      c.contributionMethod,
      val,
      0, // a joint account has no salary: a percent reads as $0
      periodsPerYear,
    );
    const matchAnnual =
      c.employerMatchType === "fixed_annual"
        ? toNumber(c.employerMatchValue)
        : 0;

    const linkedPerfLabel = c.performanceAccountId
      ? perfLabelMap.get(c.performanceAccountId)
      : null;

    const jDisplay = getDisplayConfig(c.accountType, c.subType);

    let displayCat: string = jDisplay.displayLabel;
    if (isOverflowTarget(c.accountType as AccountCategory)) {
      if (
        jDisplay.hasDiscountBar ||
        jDisplay.displayLabel.toLowerCase() !== c.accountType.toLowerCase()
      ) {
        displayCat = jDisplay.displayLabel;
      } else if (linkedPerfLabel) {
        displayCat = linkedPerfLabel;
      } else if (c.label) {
        displayCat = `${c.label} Brokerage`;
      } else {
        displayCat = isRetirementCategory(c.accountType as AccountCategory)
          ? "Retirement Brokerage"
          : "Long Term Brokerage";
      }
    }

    const jColorKey =
      c.subType &&
      jDisplay.displayLabel.toLowerCase() !== c.accountType.toLowerCase()
        ? c.subType.toLowerCase()
        : c.accountType;

    const jointViewMetrics: AccountViewMetrics = {
      employeeContrib: roundToCents(annual),
      employerMatch: roundToCents(matchAnnual),
      totalContrib: roundToCents(annual + matchAnnual),
      fundingPct: 0,
      fundingMissing: 0,
      pctOfSalaryToMax: null,
    };
    // Live actuals (portfolio permission): YTD is the money in so far;
    // Year-End adds the rest of the year on this contribution's own
    // schedule — the same rule as the per-person accounts.
    const jointActual =
      c.performanceAccountId != null &&
      liveThroughToday.has(c.performanceAccountId)
        ? perfActualMap.get(c.performanceAccountId)
        : undefined;
    const viewOf = (emp: number, match: number): AccountViewMetrics => ({
      ...jointViewMetrics,
      employeeContrib: roundToCents(emp),
      employerMatch: roundToCents(match),
      totalContrib: roundToCents(emp + match),
    });
    const jointRemaining = contribRemainingFraction(c.contributionMethod, {
      periodsPerYear,
      // A joint contribution has no job: no anchor payday to walk.
      periodsElapsed: periodsElapsedYtd(asOfDate, "", null, periodsPerYear),
      monthsElapsed: monthsDoneYtd(
        asOfDate,
        c.performanceAccountId != null
          ? contributedThrough.get(c.performanceAccountId)
          : null,
      ),
    });
    const jointCapMessage = capMessage(c);
    jointAccountTypes.push({
      accountType: displayCat,
      categoryKey: jColorKey,
      parentCategory: c.parentCategory,
      overBy: roundToCents(c.cap?.overBy ?? 0),
      capMessages: jointCapMessage ? [jointCapMessage] : [],
      hsaCoverageType: c.hsaCoverageType ?? null,
      limit: resolveIrsLimit(
        c.accountType,
        householdAge,
        c.hsaCoverageType ?? null,
        limitsRecord,
      ),
      employeeContrib: roundToCents(annual),
      employerMatch: roundToCents(matchAnnual),
      employerMatchAvailable: roundToCents(matchAnnual),
      totalContrib: roundToCents(annual + matchAnnual),
      views: jointActual
        ? {
            projected: jointViewMetrics,
            blended: viewOf(
              jointActual.contributions + annual * jointRemaining,
              jointActual.employerMatch + matchAnnual * jointRemaining,
            ),
            ytd: viewOf(jointActual.contributions, jointActual.employerMatch),
          }
        : {
            projected: jointViewMetrics,
            blended: jointViewMetrics,
            ytd: jointViewMetrics,
          },
      ytdDataStale: false,
      currentPctOfSalary: null,
      fullMatchPctOfSalary: null,
      performanceAccountIds:
        c.performanceAccountId != null ? [c.performanceAccountId] : [],
      tradContrib: isPreTaxTreatment(c.taxTreatment) ? roundToCents(annual) : 0,
      taxFreeContrib: isTaxFree(c.taxTreatment) ? roundToCents(annual) : 0,
      afterTaxContrib: isAfterTaxTreatment(c.taxTreatment)
        ? roundToCents(annual)
        : 0,
      hsaContrib: isHsaTreatment(c.taxTreatment) ? roundToCents(annual) : 0,
      // Same isPayrollDeducted resolution as the per-person rows.
      nonPayrollContrib: isPaidThroughPayroll(c) ? 0 : roundToCents(annual),
      payrollDeductedContrib: isPaidThroughPayroll(c)
        ? roundToCents(annual)
        : 0,
      bonusContrib: 0,
      isJoint: true,
      hasDiscountBar: jDisplay.hasDiscountBar,
      employerMatchLabel: jDisplay.employerMatchLabel,
      targetAnnual: c.targetAnnual ? Number(c.targetAnnual) : null,
      allocationPriority: c.allocationPriority,
    });
  }
}
