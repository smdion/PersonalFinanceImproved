/**
 * Relocation Decision Calculator
 *
 * Compares current budget vs. a relocation (higher-COL) budget to determine:
 * - Expense differential and savings rate impact
 * - FI target (nest egg needed) under each scenario
 * - FI age under each scenario
 * - Recommended portfolio size before relocating
 * - Earliest safe age to relocate and still reach FI by retirement
 *
 * Supports year-specific expense adjustments and contribution rate overrides
 * so the user can model phased moves, cost cuts, or contribution ramp-ups
 * to shift the timeline.
 *
 * Contribution rate overrides are "sticky" — a rate set in year X applies
 * to year X and every year after until the next override.
 *
 * Large purchases (home, car, furniture, etc.) are modeled as one-time
 * portfolio withdrawals with optional financing, ongoing costs, and sale
 * proceeds. They affect the relocation scenario only.
 */
import type {
  RelocationContributionOverride,
  RelocationInput,
  RelocationLargePurchase,
  RelocationResult,
  RelocationYearProjection,
} from "./types";
import { roundToCents } from "../utils/math";

/**
 * Simple portfolio growth model for a single year.
 * Returns the balance at year-end after contributions and growth.
 */
function growOneYear(
  balance: number,
  annualContrib: number,
  returnRate: number,
): number {
  return (balance + annualContrib / 2) * (1 + returnRate) + annualContrib / 2;
}

/**
 * Standard amortization formula: fixed monthly payment for a loan.
 * Returns 0 if principal is 0 or term is 0.
 */
function calculateMonthlyPayment(
  principal: number,
  annualRate: number,
  termYears: number,
): number {
  if (principal <= 0 || termYears <= 0) return 0;
  if (annualRate <= 0) return principal / (termYears * 12);
  const r = annualRate / 12;
  const n = termYears * 12;
  return (principal * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1);
}

/** Pre-computed per-purchase data used during the year-by-year loop. */
type PurchasePrecomputed = {
  cashOutlay: number; // withdrawn from portfolio in purchase year
  saleProceeds: number; // added back to portfolio in purchase year
  monthlyPayment: number; // loan payment (0 if all-cash)
  paymentStartYear: number;
  paymentEndYear: number; // exclusive — last year with payments is paymentEndYear - 1
  ongoingMonthlyCost: number; // ongoing costs from purchase year onward
  purchaseYear: number;
};

function precomputePurchases(
  purchases: RelocationLargePurchase[],
): PurchasePrecomputed[] {
  return purchases.map((p) => {
    const downPct = p.downPaymentPercent ?? 1; // default = all-cash
    const cashOutlay = roundToCents(p.purchasePrice * downPct);
    const financedPrincipal = roundToCents(p.purchasePrice * (1 - downPct));
    const termYears = p.loanTermYears ?? 0;
    const monthlyPayment = roundToCents(
      calculateMonthlyPayment(financedPrincipal, p.loanRate ?? 0, termYears),
    );

    return {
      cashOutlay,
      saleProceeds: p.saleProceeds ?? 0,
      monthlyPayment,
      paymentStartYear: p.purchaseYear,
      paymentEndYear: p.purchaseYear + termYears,
      ongoingMonthlyCost: p.ongoingMonthlyCost ?? 0,
      purchaseYear: p.purchaseYear,
    };
  });
}

/** Get total monthly cost from purchases active in a given year. */
function purchaseMonthlyForYear(
  year: number,
  pcs: PurchasePrecomputed[],
): number {
  let total = 0;
  for (const pc of pcs) {
    if (year < pc.purchaseYear) continue;
    // Ongoing costs from purchase year onward
    total += pc.ongoingMonthlyCost;
    // Loan payments for years within the loan term
    if (year >= pc.paymentStartYear && year < pc.paymentEndYear) {
      total += pc.monthlyPayment;
    }
  }
  return roundToCents(total);
}

/** Net portfolio impact from purchases in a specific year (cash outlays - sale proceeds). */
function purchasePortfolioImpactForYear(
  year: number,
  pcs: PurchasePrecomputed[],
): number {
  let impact = 0;
  for (const pc of pcs) {
    if (pc.purchaseYear === year) {
      impact += -pc.cashOutlay + pc.saleProceeds;
    }
  }
  return roundToCents(impact);
}

/** Steady-state monthly cost: ongoing costs + loan payments for loans still active at the last purchase year. */
function steadyStateMonthly(pcs: PurchasePrecomputed[]): number {
  if (pcs.length === 0) return 0;
  // Use the max purchase year as the reference point for "steady state"
  const maxYear = Math.max(...pcs.map((pc) => pc.purchaseYear));
  return purchaseMonthlyForYear(maxYear, pcs);
}

/**
 * Build a sorted array of contribution rate overrides so we can efficiently
 * look up the active rate for any given year via binary search.
 * Each override applies from its year onward until the next one.
 */
function buildRateSchedule(
  overrides: RelocationContributionOverride[],
): { year: number; rate: number }[] {
  return [...overrides].sort((a, b) => a.year - b.year);
}

/**
 * Get the active contribution rate for a given year.
 * Returns null if no override applies (use default rate).
 */
function getActiveRate(
  year: number,
  schedule: { year: number; rate: number }[],
): number | null {
  let active: number | null = null;
  for (const entry of schedule) {
    if (entry.year <= year) {
      active = entry.rate;
    } else {
      break;
    }
  }
  return active;
}

export function calculateRelocation(input: RelocationInput): RelocationResult {
  const warnings: string[] = [];
  const {
    currentMonthlyExpenses,
    relocationMonthlyExpenses,
    yearAdjustments,
    contributionOverrides,
    largePurchases,
    currentAge,
    retirementAge,
    currentPortfolio,
    currentAnnualContributions,
    currentEmployerContributions,
    currentCombinedSalary,
    relocationAnnualContributions,
    relocationEmployerContributions,
    relocationCombinedSalary,
    currentSalaryGrowthRate,
    relocationSalaryGrowthRate,
    withdrawalRate,
    inflationRate,
    nominalReturnRate,
    socialSecurityAnnual: _socialSecurityAnnual,
    asOfDate,
  } = input;

  const currentAnnual = roundToCents(currentMonthlyExpenses * 12);
  const relocationAnnual = roundToCents(relocationMonthlyExpenses * 12);
  const annualDelta = roundToCents(relocationAnnual - currentAnnual);
  const monthlyDelta = roundToCents(
    relocationMonthlyExpenses - currentMonthlyExpenses,
  );
  const pctIncrease =
    currentAnnual > 0 ? roundToCents((annualDelta / currentAnnual) * 100) : 0;

  // Pre-compute large purchase data
  const purchaseData = precomputePurchases(largePurchases);

  // Steady-state ongoing monthly cost from purchases (for FI target adjustment)
  const ssMonthly = steadyStateMonthly(purchaseData);

  // Savings rates (simplified: available = salary - expenses)
  const currentSavingsRate =
    currentCombinedSalary > 0
      ? roundToCents(
          ((currentCombinedSalary - currentAnnual) / currentCombinedSalary) *
            100,
        ) / 100
      : 0;
  const relocationSavingsRate =
    relocationCombinedSalary > 0
      ? roundToCents(
          ((relocationCombinedSalary - relocationAnnual) /
            relocationCombinedSalary) *
            100,
        ) / 100
      : 0;
  const savingsRateDrop =
    roundToCents((currentSavingsRate - relocationSavingsRate) * 100) / 100;

  // FI targets: annual expenses / withdrawal rate
  // Relocation FI target includes ongoing purchase costs (they're permanent expenses in retirement)
  const currentFiTarget =
    withdrawalRate > 0 ? roundToCents(currentAnnual / withdrawalRate) : 0;
  const relocationFiTarget =
    withdrawalRate > 0
      ? roundToCents((relocationAnnual + ssMonthly * 12) / withdrawalRate)
      : 0;
  const additionalNestEgg = roundToCents(relocationFiTarget - currentFiTarget);

  // Build lookup maps
  const adjustmentMap = new Map<number, number>();
  for (const adj of yearAdjustments)
    adjustmentMap.set(adj.year, adj.monthlyExpenses);

  const rateSchedule = buildRateSchedule(contributionOverrides);

  // Per-scenario base contribution rates (total contributions as % of salary)
  const currentBaseContribRate =
    currentCombinedSalary > 0
      ? (currentAnnualContributions + currentEmployerContributions) /
        currentCombinedSalary
      : 0;
  const relocBaseContribRate =
    relocationCombinedSalary > 0
      ? (relocationAnnualContributions + relocationEmployerContributions) /
        relocationCombinedSalary
      : 0;

  // Project both scenarios year-by-year
  const yearsToProject = Math.max(0, retirementAge - currentAge);
  const projectionByYear: RelocationYearProjection[] = [];

  let currentBalance = currentPortfolio;
  let relocationBalance = currentPortfolio;
  let currentFiAge: number | null = null;
  let relocationFiAge: number | null = null;
  let curSalary = currentCombinedSalary;
  let relocSalary = relocationCombinedSalary;
  let totalPurchaseHit = 0;

  for (let y = 0; y < yearsToProject; y++) {
    const age = currentAge + y;
    const year = asOfDate.getFullYear() + y;

    // Salary growth — independent trajectories per scenario
    if (y > 0) {
      curSalary = roundToCents(curSalary * (1 + currentSalaryGrowthRate));
      relocSalary = roundToCents(
        relocSalary * (1 + relocationSalaryGrowthRate),
      );
    }

    // Resolve contribution rate override (sticky, applies to both scenarios)
    const overrideRate = getActiveRate(year, rateSchedule);
    const hasContribOverride = overrideRate !== null;

    // Current scenario contributions
    const currentRate = overrideRate ?? currentBaseContribRate;
    const currentContrib = roundToCents(curSalary * currentRate);
    currentBalance = roundToCents(
      growOneYear(currentBalance, currentContrib, nominalReturnRate),
    );

    // Relocation scenario: expenses may have year-specific adjustments
    const relocMonthly = adjustmentMap.has(year)
      ? adjustmentMap.get(year)!
      : relocationMonthlyExpenses;
    const relocAnnualThisYear = roundToCents(relocMonthly * 12);

    // Large purchase costs for this year
    const purchaseMonthly = purchaseMonthlyForYear(year, purchaseData);
    const purchaseAnnualCost = roundToCents(purchaseMonthly * 12);
    const purchaseImpact = purchasePortfolioImpactForYear(year, purchaseData);

    const totalRelocExpenses = roundToCents(
      relocAnnualThisYear + purchaseAnnualCost,
    );

    // Relocation scenario contributions — uses relocation profile's rate directly
    const relocRate = overrideRate ?? relocBaseContribRate;
    const relocContrib = roundToCents(relocSalary * relocRate);

    relocationBalance = roundToCents(
      growOneYear(relocationBalance, relocContrib, nominalReturnRate),
    );

    // Apply one-time purchase portfolio impact (cash outlay - sale proceeds)
    if (purchaseImpact !== 0) {
      relocationBalance = roundToCents(relocationBalance + purchaseImpact);
      totalPurchaseHit = roundToCents(totalPurchaseHit - purchaseImpact); // positive = cost
    }

    // Check FI crossover (inflation-adjusted targets)
    const inflatedCurrentFi = roundToCents(
      currentFiTarget * Math.pow(1 + inflationRate, y),
    );
    const inflatedRelocFi = roundToCents(
      relocationFiTarget * Math.pow(1 + inflationRate, y),
    );

    if (currentFiAge === null && currentBalance >= inflatedCurrentFi) {
      currentFiAge = age;
    }
    if (relocationFiAge === null && relocationBalance >= inflatedRelocFi) {
      relocationFiAge = age;
    }

    projectionByYear.push({
      year,
      age,
      currentBalance,
      relocationBalance,
      delta: roundToCents(relocationBalance - currentBalance),
      relocationExpenses: totalRelocExpenses,
      currentContribution: currentContrib,
      relocationContribution: relocContrib,
      hasAdjustment: adjustmentMap.has(year),
      hasContributionOverride: hasContribOverride,
      largePurchaseImpact: purchaseImpact,
      monthlyPaymentFromPurchases: purchaseMonthly,
    });
  }

  const fiAgeDelay =
    currentFiAge !== null && relocationFiAge !== null
      ? relocationFiAge - currentFiAge
      : null;

  // Recommended portfolio to relocate: find the earliest year where the relocation
  // scenario still reaches FI target by retirement.
  let recommendedPortfolio = 0;
  let earliestRelocateAge: number | null = null;

  if (yearsToProject > 0) {
    for (let startY = 0; startY < yearsToProject; startY++) {
      const startAge = currentAge + startY;
      const startingBalance =
        startY === 0
          ? currentPortfolio
          : projectionByYear[startY - 1]!.currentBalance;

      let simBalance = startingBalance;
      let simRelocSalary =
        relocationCombinedSalary *
        Math.pow(1 + relocationSalaryGrowthRate, startY);
      let reachesFi = false;

      for (let y2 = startY; y2 < yearsToProject; y2++) {
        const year2 = asOfDate.getFullYear() + y2;
        if (y2 > startY)
          simRelocSalary = roundToCents(
            simRelocSalary * (1 + relocationSalaryGrowthRate),
          );

        const overrideRate2 = getActiveRate(year2, rateSchedule);
        const rate2 = overrideRate2 ?? relocBaseContribRate;
        const simContrib = roundToCents(simRelocSalary * rate2);

        simBalance = roundToCents(
          growOneYear(simBalance, simContrib, nominalReturnRate),
        );

        // Apply one-time purchase impacts in simulation too
        const simPurchaseImpact = purchasePortfolioImpactForYear(
          year2,
          purchaseData,
        );
        if (simPurchaseImpact !== 0) {
          simBalance = roundToCents(simBalance + simPurchaseImpact);
        }

        const inflatedTarget = roundToCents(
          relocationFiTarget * Math.pow(1 + inflationRate, y2),
        );
        if (simBalance >= inflatedTarget) {
          reachesFi = true;
          break;
        }
      }

      if (reachesFi && earliestRelocateAge === null) {
        earliestRelocateAge = startAge;
        recommendedPortfolio = roundToCents(startingBalance);
        break;
      }
    }

    if (earliestRelocateAge === null) {
      warnings.push(
        "With the relocation budget, your portfolio may not reach the FI target by retirement age. Consider increasing contributions or extending the timeline.",
      );
      recommendedPortfolio = relocationFiTarget;
    }
  }

  return {
    currentAnnualExpenses: currentAnnual,
    relocationAnnualExpenses: relocationAnnual,
    annualExpenseDelta: annualDelta,
    monthlyExpenseDelta: monthlyDelta,
    percentExpenseIncrease: pctIncrease,
    currentSavingsRate,
    relocationSavingsRate,
    savingsRateDrop,
    currentFiTarget,
    relocationFiTarget,
    additionalNestEggNeeded: additionalNestEgg,
    currentFiAge,
    relocationFiAge,
    fiAgeDelay,
    recommendedPortfolioToRelocate: recommendedPortfolio,
    earliestRelocateAge,
    totalLargePurchasePortfolioHit: totalPurchaseHit,
    steadyStateMonthlyFromPurchases: ssMonthly,
    projectionByYear,
    warnings,
  };
}
