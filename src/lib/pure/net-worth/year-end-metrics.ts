import { toNumber } from "@/lib/utils/numbers";
import { calendarYear } from "@/lib/utils/date";
import { DEFAULT_WITHDRAWAL_RATE } from "@/lib/constants";
import { parseAppSettings } from "@/lib/pure/household/app-settings";
import { getPrimaryPerson } from "@/lib/pure/household/primary-person";
import {
  resolveRetirementProfileIdFrom,
  pickProfileSettingsRow,
} from "@/lib/pure/household/retirement-profile";
import { getActiveMortgageLoan } from "@/lib/pure/debts/mortgage-balance";
import { calculateNetWorth, wealthFormulaIncome } from "./net-worth";
import type { NetWorthInput } from "./net-worth.types";
import type { YearEndRow } from "./year-end-rows";

export function yearEndWealthMetrics(
  history: YearEndRow[],
  settings: { key: string; value: unknown }[],
  people: { id: number; isPrimaryUser: boolean; dateOfBirth: string }[],
  retirementSettingsRows: {
    profileId: number | null;
    personId: number;
    withdrawalRate: string | null;
  }[],
  retirementProfileRows: { id: number }[],
  mortgageLoans: { isActive: boolean; propertyValuePurchase: string | null }[],
  annualExpensesBudget: number,
) {
  const setting = parseAppSettings(settings);
  const useSalaryAverage = setting("use_salary_average_3_year", 0) === 1;

  // Birth years for average age
  const birthYears = people.map((p) => calendarYear(p.dateOfBirth));

  // Withdrawal rate from the active retirement profile's settings row, so
  // it agrees with what the projection uses.
  const primaryPerson = getPrimaryPerson(people);
  const activeRetProfileId = resolveRetirementProfileIdFrom(
    settings,
    retirementProfileRows,
  );
  const primaryRetSettings = pickProfileSettingsRow(
    retirementSettingsRows,
    activeRetProfileId,
    primaryPerson?.id ?? null,
  );
  const withdrawalRate = primaryRetSettings
    ? toNumber(primaryRetSettings.withdrawalRate)
    : DEFAULT_WITHDRAWAL_RATE;

  // Purchase price for cost basis
  const activeMortgageForCostBasis = getActiveMortgageLoan(mortgageLoans);
  const purchasePrice = activeMortgageForCostBasis
    ? toNumber(activeMortgageForCostBasis.propertyValuePurchase)
    : 0;

  // Sort by year for cumulative lifetime earnings
  history.sort((a, b) => a.year - b.year);
  let cumulativeEarnings = 0;

  for (const row of history) {
    // Average age for this year
    const avgAge =
      birthYears.length > 0
        ? birthYears.reduce((s, by) => s + (row.year - by), 0) /
          birthYears.length
        : 0;

    // One income definition for both the wealth formula and lifetime
    // earnings: gross pretax income (AGI only where gross wasn't recorded).
    const yearIncome = wealthFormulaIncome(row);

    // Optionally average over 3 most recent years
    let effectiveIncome = yearIncome;
    if (useSalaryAverage) {
      const recent = history
        .filter((h) => h.year <= row.year && wealthFormulaIncome(h) > 0)
        .sort((a, b) => b.year - a.year)
        .slice(0, 3);
      if (recent.length > 0) {
        effectiveIncome =
          recent.reduce((s, h) => s + wealthFormulaIncome(h), 0) /
          recent.length;
      }
    }

    // Cumulative lifetime earnings
    cumulativeEarnings += yearIncome;

    // Cost basis net worth
    const houseValueCostBasis =
      row.houseValue > 0 ? purchasePrice + row.homeImprovements : 0;
    const netWorthCostBasis =
      row.portfolioTotal +
      row.cash +
      houseValueCostBasis +
      row.otherAssets -
      row.mortgageBalance -
      row.otherLiabilities;

    // Call calculateNetWorth — single computation path for all metrics
    const nwInput: NetWorthInput = {
      portfolioTotal: row.portfolioTotal,
      cash: row.cash,
      homeValueEstimated: row.houseValue,
      homeValueConservative: houseValueCostBasis,
      otherAssets: row.otherAssets,
      mortgageBalance: row.mortgageBalance,
      otherLiabilities: row.otherLiabilities,
      averageAge: avgAge,
      effectiveIncome,
      lifetimeEarnings: cumulativeEarnings,
      annualExpenses: annualExpensesBudget,
      withdrawalRate,
      asOfDate: new Date(row.yearEndDate),
    };
    const result = calculateNetWorth(nwInput);

    // Write computed values back to the row
    row.wealthScoreMarket = result.wealthScoreMarket;
    row.wealthScoreCostBasis = result.wealthScoreCostBasis;
    row.aawScoreMarket = result.aawScoreMarket;
    row.aawScoreCostBasis = result.aawScoreCostBasis;
    row.fiProgress = result.fiProgress;
    row.fiTarget = result.fiTarget;
    row.netWorthMarket = result.netWorthMarket;
    row.netWorthCostBasis = netWorthCostBasis;
    row.houseValueCostBasis = houseValueCostBasis;
    row.averageAge = avgAge;
    row.effectiveIncome = effectiveIncome;
    row.lifetimeEarnings = cumulativeEarnings;
    row.annualExpenses = annualExpensesBudget;
    row.withdrawalRate = withdrawalRate;
    row.withdrawalRateIsDefault = !primaryRetSettings;
  }
}
