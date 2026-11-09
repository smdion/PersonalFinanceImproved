import {
  type AccountCategory,
  categoriesWithIrsLimit,
  getAccountTypeConfig,
  getDefaultAccumulationOrder,
  isPortfolioParent,
  isRetirementParent,
} from "@/lib/config/account-types";
import {
  capMessage,
  combinedCoverage,
} from "@/lib/pure/contributions/contribution-caps";
import { computeViewAwareAccountMetrics } from "@/lib/pure/contributions/view-metrics";
import { roundToCents, sumBy } from "@/lib/utils/math";
import type { ContributionAccountRow } from "@/lib/pure/contributions/contribution-account-row";
import type {
  AccountTypeSnapshot,
  PerContribData,
} from "@/lib/pure/contributions/summary.types";

export function newCategoryMap() {
  const categoryMap = new Map<
    string,
    {
      employee: number;
      match: number;
      matchAvailable: number;
      trad: number;
      taxFree: number;
      afterTax: number;
      hsa: number;
      nonPayroll: number;
      payrollDeducted: number;
      isJoint: boolean;
      parentCategory: string;
      hasDiscountBar: boolean;
      employerMatchLabel: string;
      categoryKey: string;
      targetAnnual: number | null;
      allocationPriority: number;
      priorYearAmount: number;
      priorYearContribs: { id: number; amount: number }[];
      ytdContributions: number;
      ytdEmployerMatch: number;
      blendedEmployee: number;
      blendedMatch: number;
      ytdDataStale: boolean;
      performanceAccountIds: Set<number>;
      /** Sum of this account's percent-of-pay elections; null once any of its contributions is a fixed amount. */
      electedPercent: number | null;
      /** What the bonus check takes for it (bonusCheckContribution). */
      bonus: number;
      fullMatchShareOfPay: number | null;
    }
  >();

  return { categoryMap };
}

export function accountTypeSnapshots(
  rawContribs: ContributionAccountRow[],
  resolveContribLimit: (
    accountType: string,
    hsaCoverageType: string | null,
  ) => number,
  categoryMap: ReturnType<typeof newCategoryMap>["categoryMap"],
  salary: number,
  inPriorYearWindow: boolean,
  resolveContribPriorYearLimit: (
    accountType: string,
    hsaCoverageType: string | null,
  ) => number,
) {
  const coverageFor = (rawCat: string) =>
    combinedCoverage(
      rawContribs
        .filter((c) => c.accountType === rawCat)
        .map((c) => c.hsaCoverageType ?? null),
    );
  const getLimitForCategory = (rawCat: string): number =>
    resolveContribLimit(rawCat, coverageFor(rawCat));

  const accountTypes: AccountTypeSnapshot[] = [];
  for (const [cat, data] of Array.from(categoryMap)) {
    const limit = getLimitForCategory(data.categoryKey);
    const employeeContrib = roundToCents(data.employee);
    const employerMatch = roundToCents(data.match);
    const bonusAdd = roundToCents(data.bonus);
    const totalEmployee = employeeContrib + bonusAdd;
    const cfg = categoriesWithIrsLimit().includes(
      data.categoryKey as AccountCategory,
    )
      ? getAccountTypeConfig(data.categoryKey as AccountCategory)
      : null;
    // The payroll election as set up ("15% of pay"), not dollars ÷
    // salary — that ratio mixed in bonus-check money and differed
    // from what the household actually elects.
    const currentPctOfSalary = data.electedPercent;

    const ytdActualForCategory =
      data.ytdContributions > 0 || data.ytdEmployerMatch > 0
        ? {
            contributions: data.ytdContributions,
            employerMatch: data.ytdEmployerMatch,
          }
        : null;
    const blendedEmployee = roundToCents(data.blendedEmployee);
    const blendedMatch = roundToCents(data.blendedMatch);
    const views = computeViewAwareAccountMetrics({
      projected: {
        employeeContrib: totalEmployee,
        employerMatch,
      },
      blended: {
        employeeContrib: blendedEmployee,
        employerMatch: blendedMatch,
      },
      ytdActual: ytdActualForCategory,
      limit,
      salary,
      matchCountsTowardLimit: cfg?.matchCountsTowardLimit ?? false,
    });

    // Prior-year contribution data (only during IRS window for eligible types)
    let priorYearSnapshot: AccountTypeSnapshot["priorYear"];
    if (inPriorYearWindow && cfg?.supportsPriorYearContrib) {
      const pyLimit = resolveContribPriorYearLimit(
        data.categoryKey,
        coverageFor(data.categoryKey),
      );
      if (pyLimit > 0) {
        priorYearSnapshot = {
          amount: roundToCents(data.priorYearAmount),
          limit: pyLimit,
          remaining: Math.max(0, pyLimit - roundToCents(data.priorYearAmount)),
          contribs: data.priorYearContribs,
        };
      }
    }

    const typeRows = rawContribs.filter(
      (c) => c.accountType === data.categoryKey,
    );
    accountTypes.push({
      accountType: cat,
      categoryKey: data.categoryKey,
      performanceAccountIds: [...data.performanceAccountIds],
      parentCategory: data.parentCategory,
      limit,
      hsaCoverageType: combinedCoverage(
        typeRows.map((c) => c.hsaCoverageType ?? null),
      ),
      overBy: roundToCents(sumBy(typeRows, (c) => c.cap?.overBy ?? 0)),
      capMessages: typeRows.flatMap((c) => {
        const m = capMessage(c);
        return m ? [m] : [];
      }),
      employeeContrib: totalEmployee,
      employerMatch,
      employerMatchAvailable: Math.max(
        employerMatch,
        roundToCents(data.matchAvailable),
      ),
      totalContrib: totalEmployee + employerMatch,
      views,
      ytdDataStale: data.ytdDataStale,
      currentPctOfSalary,
      fullMatchPctOfSalary:
        data.fullMatchShareOfPay === null
          ? null
          : roundToCents(data.fullMatchShareOfPay * 100),
      tradContrib: roundToCents(data.trad),
      taxFreeContrib: roundToCents(data.taxFree),
      afterTaxContrib: roundToCents(data.afterTax),
      hsaContrib: roundToCents(data.hsa),
      nonPayrollContrib: roundToCents(data.nonPayroll),
      payrollDeductedContrib: roundToCents(data.payrollDeducted),
      bonusContrib: bonusAdd,
      isJoint: data.isJoint,
      hasDiscountBar: data.hasDiscountBar,
      employerMatchLabel: data.employerMatchLabel,
      targetAnnual: data.targetAnnual,
      allocationPriority: data.allocationPriority,
      priorYear: priorYearSnapshot,
    });
  }

  // Sort: config-defined accumulation order (using categoryKey for lookup), then others
  const order = getDefaultAccumulationOrder() as string[];
  accountTypes.sort((a, b) => {
    const ai = order.indexOf(a.categoryKey);
    const bi = order.indexOf(b.categoryKey);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return { accountTypes };
}

export function contributionTotals(
  accountTypes: AccountTypeSnapshot[],
  perContribData: PerContribData[],
  rawContribs: ContributionAccountRow[],
  categoryMap: ReturnType<typeof newCategoryMap>["categoryMap"],
) {
  const retirement = accountTypes.filter((a) =>
    isRetirementParent(a.parentCategory),
  );
  const portfolio = accountTypes.filter((a) =>
    isPortfolioParent(a.parentCategory),
  );
  const retirementWithoutMatch = roundToCents(
    retirement.reduce((s, a) => s + a.employeeContrib, 0),
  );
  const retirementWithMatch = roundToCents(
    retirement.reduce((s, a) => s + a.totalContrib, 0),
  );
  const portfolioWithoutMatch = roundToCents(
    portfolio.reduce((s, a) => s + a.employeeContrib, 0),
  );
  const portfolioWithMatch = roundToCents(
    portfolio.reduce((s, a) => s + a.totalContrib, 0),
  );

  // YTD actuals from performance data — sum by parent category
  const ytdActualRetirement = roundToCents(
    perContribData
      .filter((_pcd, index) =>
        isRetirementParent(rawContribs[index]?.parentCategory ?? ""),
      )
      .reduce((s, pcd) => s + (pcd.ytdActual?.contributions ?? 0), 0),
  );
  const ytdActualPortfolio = roundToCents(
    perContribData
      .filter((_pcd, index) =>
        isPortfolioParent(rawContribs[index]?.parentCategory ?? ""),
      )
      .reduce((s, pcd) => s + (pcd.ytdActual?.contributions ?? 0), 0),
  );
  const ytdActualRetirementMatch = roundToCents(
    perContribData
      .filter((_pcd, index) =>
        isRetirementParent(rawContribs[index]?.parentCategory ?? ""),
      )
      .reduce((s, pcd) => s + (pcd.ytdActual?.employerMatch ?? 0), 0),
  );
  const ytdActualPortfolioMatch = roundToCents(
    perContribData
      .filter((_pcd, index) =>
        isPortfolioParent(rawContribs[index]?.parentCategory ?? ""),
      )
      .reduce((s, pcd) => s + (pcd.ytdActual?.employerMatch ?? 0), 0),
  );

  // Blended totals: sum per-category blended amounts (method-aware remaining fractions)
  const catEntries = Array.from(categoryMap.entries());
  const retCats = catEntries.filter(([, d]) =>
    isRetirementParent(d.parentCategory),
  );
  const portCats = catEntries.filter(([, d]) =>
    isPortfolioParent(d.parentCategory),
  );
  const blendedRetWithoutMatch = roundToCents(
    retCats.reduce((s, [, d]) => s + d.blendedEmployee, 0),
  );
  const blendedRetWithMatch = roundToCents(
    retCats.reduce((s, [, d]) => s + d.blendedEmployee + d.blendedMatch, 0),
  );
  const blendedPortWithoutMatch = roundToCents(
    portCats.reduce((s, [, d]) => s + d.blendedEmployee, 0),
  );
  const blendedPortWithMatch = roundToCents(
    portCats.reduce((s, [, d]) => s + d.blendedEmployee + d.blendedMatch, 0),
  );

  return {
    retirementWithoutMatch,
    retirementWithMatch,
    portfolioWithoutMatch,
    portfolioWithMatch,
    ytdActualRetirement,
    ytdActualPortfolio,
    ytdActualRetirementMatch,
    ytdActualPortfolioMatch,
    blendedRetWithoutMatch,
    blendedRetWithMatch,
    blendedPortWithoutMatch,
    blendedPortWithMatch,
  };
}
