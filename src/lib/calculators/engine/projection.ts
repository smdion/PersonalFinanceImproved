/**
 * Contribution / Distribution Engine
 *
 * Unified calculator that projects both accumulation (pre-retirement) and
 * decumulation (post-retirement) in a single pass, with full control over:
 *
 * - Routing mode (bracket_filling, waterfall, or percentage)
 * - Account allocation and priority order
 * - Roth/Traditional tax splits per account
 * - Artificial caps per account and per tax type
 * - Withdrawal order and tax preferences
 *
 * All settings support per-year sticky-forward overrides.
 * See types.ts for detailed documentation of each type.
 */
import type {
  ProjectionInput,
  ProjectionResult,
  AccumulationSlot,
  DecumulationSlot,
  EngineAccumulationYear,
  EngineDecumulationYear,
  EngineYearProjection,
  AccountCategory,
  TaxBuckets,
  AccountBalances,
  IndividualAccountYearBalance,
} from "../types";
import { roundToCents, sumBy } from "../../utils/math";
import {
  getRothFraction as configGetRothFraction,
  getAllCategories,
  getAccountTypeConfig,
  isOverflowTarget,
  categoriesWithIrsLimit,
  getLimitGroup,
  categoriesWithTaxPreference,
  getDefaultDecumulationOrder,
  getBasis,
  addTraditional,
  addRoth,
  addBalance,
  addBasis,
  setBasis,
} from "../../config/account-types";
import {
  OVERFLOW_TOLERANCE,
  MONTHS_PER_YEAR,
  MIN_RETURN_RATE,
  MAX_INFLATION_RATE,
  MIN_INFLATION_RATE,
  MAX_BROKERAGE_RAMP_YEARS,
} from "../../constants";
import { getRmdStartAge } from "../../config/rmd-tables";
import { getLtcgRate, computeLtcgTax } from "../../config/tax-tables";
import { computeNiit } from "../../config/niit";
import {
  resolveAccumulationConfig,
  resolveDecumulationConfig,
} from "./override-resolution";
import {
  routeWaterfall,
  routePercentage,
  routeFromSpecs,
} from "./contribution-routing";
import {
  accountBalancesFromTaxBuckets,
  cloneAccountBalances,
} from "./balance-utils";
import {
  estimateEffectiveTaxRate,
  incomeCapForMarginalRate,
  computeTaxableSS,
  estimateWithdrawalTaxCost,
} from "./tax-estimation";
import {
  routeWithdrawals,
  routeWithdrawalsPercentage,
  routeWithdrawalsBracketFilling,
} from "./withdrawal-routing";
import { enforceRmd } from "./rmd-enforcement";
import {
  performRothConversion,
  checkIrmaa,
  checkAca,
} from "./post-withdrawal-optimizer";
import {
  applySpendingStrategy,
  initialCrossYearState,
} from "./spending-strategy";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import { getStrategyDefaults } from "@/lib/config/withdrawal-strategies";
import { applyGrowth } from "./growth-application";
import {
  makeIndKey,
  buildSpecToAccountMapping,
  distributeContributions,
  distributeGoalWithdrawal,
  distributeWithdrawals,
  applyIndividualGrowth,
  buildIndividualYearBalances,
  clampIndividualBalances,
} from "./individual-account-tracking";
import {
  deductWithdrawals,
  clampBalances,
  reinvestRmdExcess,
  trackDepletions,
  cleanupDust,
} from "./balance-deduction";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const ACCOUNT_CATEGORIES: AccountCategory[] = getAllCategories();
const OVERFLOW_CATEGORY: AccountCategory =
  ACCOUNT_CATEGORIES.find(isOverflowTarget)!;

const TAX_ADVANTAGED = new Set<AccountCategory>(categoriesWithIrsLimit());

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

/**
 * Validate and clamp engine inputs. Pushes warnings for any clamped values.
 * Returns sanitized copies of fields that may need clamping.
 */
function validateEngineInputs(
  input: ProjectionInput,
  warnings: string[],
): {
  salaryGrowthRate: number;
  inflationRate: number;
  postRetirementInflationRate: number;
} {
  let { salaryGrowthRate, inflationRate } = input;
  let postRetirementInflationRate =
    input.postRetirementInflationRate ?? inflationRate;

  if (salaryGrowthRate < -1) {
    warnings.push(
      `Salary growth rate clamped from ${(salaryGrowthRate * 100).toFixed(1)}% to -100%`,
    );
    salaryGrowthRate = -1;
  }

  if (inflationRate > MAX_INFLATION_RATE) {
    warnings.push(
      `Inflation rate clamped from ${(inflationRate * 100).toFixed(1)}% to ${(MAX_INFLATION_RATE * 100).toFixed(0)}%`,
    );
    inflationRate = MAX_INFLATION_RATE;
  } else if (inflationRate < MIN_INFLATION_RATE) {
    warnings.push(
      `Inflation rate clamped from ${(inflationRate * 100).toFixed(1)}% to ${(MIN_INFLATION_RATE * 100).toFixed(0)}%`,
    );
    inflationRate = MIN_INFLATION_RATE;
  }

  if (postRetirementInflationRate > MAX_INFLATION_RATE) {
    warnings.push(
      `Post-retirement raise rate clamped to ${(MAX_INFLATION_RATE * 100).toFixed(0)}%`,
    );
    postRetirementInflationRate = MAX_INFLATION_RATE;
  } else if (postRetirementInflationRate < MIN_INFLATION_RATE) {
    warnings.push(
      `Post-retirement raise rate clamped to ${(MIN_INFLATION_RATE * 100).toFixed(0)}%`,
    );
    postRetirementInflationRate = MIN_INFLATION_RATE;
  }

  if (input.returnRates.length === 0) {
    warnings.push("No return rates configured — investment growth will be 0%");
  }

  if (
    input.contributionSpecs &&
    input.contributionSpecs.length > 0 &&
    input.contributionSpecs.every((s) => s.baseAnnual === 0 && s.value === 0)
  ) {
    warnings.push("All contribution accounts have $0 contributions configured");
  }

  return { salaryGrowthRate, inflationRate, postRetirementInflationRate };
}

export function calculateProjection(input: ProjectionInput): ProjectionResult {
  const warnings: string[] = [];
  const validated = validateEngineInputs(input, warnings);

  // Warn if percentage mode is selected but no withdrawal splits are configured
  if (
    input.decumulationDefaults.withdrawalRoutingMode === "percentage" &&
    !input.decumulationDefaults.withdrawalSplits
  ) {
    warnings.push(
      "Percentage withdrawal mode selected but no withdrawal splits configured — withdrawals will be $0. Configure splits in Retirement settings.",
    );
  }

  // Date/age boundary validation
  if (input.retirementAge <= input.currentAge) {
    warnings.push(
      `Retirement age (${input.retirementAge}) is at or before current age (${input.currentAge}) — entire projection will be in decumulation.`,
    );
  }
  if (input.retirementAge > input.projectionEndAge) {
    warnings.push(
      `Retirement age (${input.retirementAge}) is beyond projection end age (${input.projectionEndAge}) — retirement phase will never be reached.`,
    );
  }

  const {
    accumulationDefaults: inputAccumulationDefaults,
    decumulationDefaults,
    accumulationOverrides,
    decumulationOverrides,
    currentAge,
    retirementAge,
    projectionEndAge,
    currentSalary,
    salaryCap,
    salaryOverrides,
    baseLimits,
    limitGrowthRate,
    catchupLimits,
    employerMatchRateByCategory,
    employerMatchByParentCat,
    contributionSpecs: inputContributionSpecs,
    baseYearContributions,
    baseYearEmployerMatch,
    brokerageGoals,
    brokerageContributionRamp,
    startingBalances,
    annualExpenses,
    returnRates,
    socialSecurityAnnual,
    ssStartAge,
    birthYear,
    filingStatus,
    enableIrmaaAwareness,
    enableAcaAwareness,
    householdSize,
    perPersonBirthYears,
    asOfDate,
  } = input;
  // Use validated/clamped versions of rates that may need safeguarding
  const {
    salaryGrowthRate,
    inflationRate,
    postRetirementInflationRate: validatedPostRetirementInflation,
  } = validated;

  // Mutable copy of accumulation defaults — profile switches may update contributionRate
  const accumulationDefaults = { ...inputAccumulationDefaults };

  // Clone contribution specs so salaryFraction updates don't mutate caller's input
  let contributionSpecs = inputContributionSpecs?.map((s) => ({ ...s }));

  // Mutable active references for profile switching
  let activeEmployerMatchRateByCategory = employerMatchRateByCategory;
  let activeBaseYearContributions = baseYearContributions;
  let activeBaseYearEmployerMatch = baseYearEmployerMatch;
  let activeEmployerMatchByParentCat = employerMatchByParentCat;

  // Pre-sort profile switches
  const sortedProfileSwitches = [...(input.profileSwitches ?? [])].sort(
    (a, b) => a.year - b.year,
  );

  // Sort overrides by year
  const sortedAccOverrides = [...accumulationOverrides].sort(
    (a, b) => a.year - b.year,
  );
  const sortedDecOverrides = [...decumulationOverrides].sort(
    (a, b) => a.year - b.year,
  );

  // Build salary override map (household-level fallback)
  const salaryOverrideMap = new Map<number, number>();
  for (const o of salaryOverrides) salaryOverrideMap.set(o.year, o.value);

  // Build per-person salary override map: year → personId → value
  const perPersonSalaryOverrides = new Map<number, Map<number, number>>();
  if (input.perPersonSalaryOverrides) {
    for (const o of input.perPersonSalaryOverrides) {
      if (!perPersonSalaryOverrides.has(o.year))
        perPersonSalaryOverrides.set(o.year, new Map());
      perPersonSalaryOverrides.get(o.year)!.set(o.personId, o.value);
    }
  }
  const hasPerPersonSalary =
    input.salaryByPerson && Object.keys(input.salaryByPerson).length > 0;

  // Build budget override map (monthly budget → annual; sticky-forward)
  const budgetOverrideMap = new Map<number, number>();
  for (const o of input.budgetOverrides)
    budgetOverrideMap.set(o.year, o.value * MONTHS_PER_YEAR);

  // Build brokerage goals by year (sorted by priority within each year)
  type BrokerageGoal = {
    id: number;
    name: string;
    targetAmount: number;
    targetYear: number;
    priority: number;
  };
  const brokerageGoalsByYear = new Map<number, BrokerageGoal[]>();
  if (brokerageGoals) {
    for (const g of brokerageGoals) {
      if (!brokerageGoalsByYear.has(g.targetYear))
        brokerageGoalsByYear.set(g.targetYear, []);
      brokerageGoalsByYear.get(g.targetYear)!.push(g);
    }
    brokerageGoalsByYear.forEach((goals) => {
      goals.sort((a, b) => a.priority - b.priority);
    });
  }

  // Build return rate map (age → rate)
  const returnRateMap = new Map<number, number>();
  for (const r of returnRates) {
    // Extract age from label like "Age 39"
    const ageMatch = r.label.match(/(\d+)/);
    if (ageMatch) returnRateMap.set(Number(ageMatch[1]), r.rate);
  }

  const yearsToProject = Math.max(0, projectionEndAge - currentAge);
  const projectionByYear: EngineYearProjection[] = [];
  let firstOverflowYear: number | null = null;
  let firstOverflowAge: number | null = null;
  let firstOverflowAmount: number | null = null;
  let portfolioDepletionYear: number | null = null;
  let portfolioDepletionAge: number | null = null;

  // First-year pro-rating: fraction of the year remaining (e.g. March → 10/12)
  const monthsRemaining = 12 - asOfDate.getMonth();
  const firstYearFraction = monthsRemaining / MONTHS_PER_YEAR;

  // Running balances — AccountBalances is the source of truth;
  // TaxBuckets is derived for backward compatibility.
  const acctBal: AccountBalances = input.startingAccountBalances
    ? cloneAccountBalances(input.startingAccountBalances)
    : accountBalancesFromTaxBuckets(startingBalances);
  const balances: TaxBuckets = { ...startingBalances };

  // Track per-account depletions (first year each hits zero during decumulation)
  const accountDepletions: ProjectionResult["accountDepletions"] = [];
  const depletionTracked = new Set<string>();

  // RMD tracking: prior year-end Traditional balance (used to compute RMD for current year)
  // Initialized from starting balances — sum of all Traditional (pre-tax) across accounts.
  let priorYearEndTradBalance = balances.preTax;
  const rmdStartAge = birthYear != null ? getRmdStartAge(birthYear) : null;

  // Spending strategy tracking — all strategies go through the generic dispatcher
  const activeStrategy: WithdrawalStrategyType =
    decumulationDefaults.withdrawalStrategy ?? "fixed";
  const activeStrategyParams: Record<string, number | boolean> = {
    ...getStrategyDefaults(activeStrategy),
    ...(decumulationDefaults.strategyParams?.[activeStrategy] ?? {}),
  };
  const spendingState = initialCrossYearState();

  // Roth conversion target override is now handled by resolveDecumulationConfig()
  // via config.rothConversionTarget (sticky-forward).

  // IRMAA 2-year lookback: track MAGI per decumulation year so year N uses year N-2 MAGI.
  // Index 0 = first decumulation year. Falls back to current-year MAGI if lookback unavailable.
  const magiHistory: number[] = [];

  // Individual account tracking — extracted to individual-account-tracking.ts
  const indAccts = input.individualAccounts ?? [];
  const hasIndividualAccounts = indAccts.length > 0;
  const indKey = makeIndKey();
  const indBal = new Map<string, number>();
  for (const ia of indAccts) indBal.set(indKey(ia), ia.startingBalance);
  const indParentCat = new Map<string, string>();
  for (const ia of indAccts) {
    if (ia.parentCategory) indParentCat.set(indKey(ia), ia.parentCategory);
  }
  const { specToAccount, accountsWithSpecs } =
    hasIndividualAccounts && contributionSpecs
      ? buildSpecToAccountMapping(
          contributionSpecs,
          indAccts,
          indKey,
          indParentCat,
        )
      : {
          specToAccount: new Map<string, string>(),
          accountsWithSpecs: new Set<string>(),
        };

  let projectedSalary = currentSalary;
  let projectedExpenses = annualExpenses;

  // Per-person salary tracking (when salaryByPerson is provided)
  const projectedSalaryByPerson = new Map<number, number>();
  if (hasPerPersonSalary) {
    for (const [pid, sal] of Object.entries(input.salaryByPerson!)) {
      projectedSalaryByPerson.set(Number(pid), sal);
    }
  }

  for (let y = 0; y < yearsToProject; y++) {
    const age = currentAge + y;
    const year = asOfDate.getFullYear() + y;
    const isAccumulation = age < retirementAge;

    // Get return rate for this age (fall back to last available)
    let returnRate = returnRateMap.get(age);
    if (returnRate === undefined) {
      // Use closest available rate
      let closestAge = 0;
      returnRateMap.forEach((_rate, rateAge) => {
        if (rateAge <= age) closestAge = rateAge;
      });
      returnRate = returnRateMap.get(closestAge);
      if (returnRate === undefined) {
        throw new Error(
          `No return rate configured for age ${age}. Add return rates in retirement settings.`,
        );
      }
    }
    returnRate = Math.max(MIN_RETURN_RATE, returnRate);

    // Check for contribution profile switch at this year (sticky-forward).
    // If multiple switches share the same year, last one wins (sorted ascending).
    // Note: a switch at year 0 replaces baseYearContributions used by the
    // useRealContribs path — the year-0 pro-rated amounts will reflect the
    // switched profile's base amounts, not actual paycheck data.
    for (const ps of sortedProfileSwitches) {
      if (ps.year > year) break;
      if (ps.year === year) {
        // Switch contribution structure only — salary continues unaffected.
        // A profile switch changes which accounts receive contributions and
        // how much, but the household salary trajectory stays the same.
        contributionSpecs = ps.contributionSpecs.map((s) => ({ ...s }));
        activeEmployerMatchRateByCategory = ps.employerMatchRateByCategory;
        activeBaseYearContributions = ps.baseYearContributions;
        activeBaseYearEmployerMatch = ps.baseYearEmployerMatch;
        activeEmployerMatchByParentCat = ps.employerMatchByParentCat;
        // Update contribution rate ceiling for the new profile
        accumulationDefaults.contributionRate = ps.contributionRate;
        // Rebuild spec-to-account mapping for the new specs
        if (hasIndividualAccounts && contributionSpecs) {
          const rebuilt = buildSpecToAccountMapping(
            contributionSpecs,
            indAccts,
            indKey,
            indParentCat,
          );
          specToAccount.clear();
          rebuilt.specToAccount.forEach((v, k) => specToAccount.set(k, v));
          accountsWithSpecs.clear();
          rebuilt.accountsWithSpecs.forEach((v) => accountsWithSpecs.add(v));
        }
      }
    }

    // Salary projection (only during accumulation)
    if (isAccumulation) {
      if (hasPerPersonSalary) {
        // Per-person salary tracking: grow each person independently, apply per-person overrides
        const yearOverrides = perPersonSalaryOverrides.get(year);
        const personIds = Array.from(projectedSalaryByPerson.keys());
        for (const pid of personIds) {
          const prevSal = projectedSalaryByPerson.get(pid)!;
          if (yearOverrides?.has(pid)) {
            projectedSalaryByPerson.set(
              pid,
              Math.max(0, yearOverrides.get(pid)!),
            );
          } else if (y > 0 && salaryGrowthRate > 0) {
            let newSal = prevSal * (1 + salaryGrowthRate);
            if (salaryCap !== null) newSal = Math.min(newSal, salaryCap);
            projectedSalaryByPerson.set(pid, newSal);
          }
        }
        // Recompute combined salary from per-person totals
        projectedSalary = 0;
        personIds.forEach((pid) => {
          projectedSalary += projectedSalaryByPerson.get(pid) ?? 0;
        });
        // Also update salaryFraction on each spec to reflect current proportions
        if (contributionSpecs && projectedSalary > 0) {
          for (const spec of contributionSpecs) {
            if (spec.method === "percent_of_salary" && spec.personId != null) {
              const personSal = projectedSalaryByPerson.get(spec.personId) ?? 0;
              spec.salaryFraction = personSal / projectedSalary;
            }
          }
        }
      } else {
        // Household-level salary tracking (original behavior)
        if (salaryOverrideMap.has(year)) {
          projectedSalary = Math.max(0, salaryOverrideMap.get(year)!);
        } else if (y > 0 && salaryGrowthRate > 0) {
          projectedSalary = Math.max(
            0,
            projectedSalary * (1 + salaryGrowthRate),
          );
          if (salaryCap !== null) {
            projectedSalary = Math.min(projectedSalary, salaryCap);
          }
        }
      }
    }

    // Reset expenses to decumulation budget at retirement boundary.
    // Budget values are in today's dollars — inflate to retirement-year nominal dollars
    // using CPI (inflationRate), NOT the post-retirement raise rate.
    // Year-over-year growth after this point uses the raise rate (postRetirementInflation).
    if (
      !isAccumulation &&
      age === retirementAge &&
      input.decumulationAnnualExpenses != null
    ) {
      projectedExpenses =
        input.decumulationAnnualExpenses * Math.pow(1 + inflationRate, y);
    }

    // Apply budget override (sticky-forward) or inflate expenses
    // Use post-retirement raise rate for expense growth after retirement
    const effectiveInflation = isAccumulation
      ? inflationRate
      : validatedPostRetirementInflation;
    if (budgetOverrideMap.has(year)) {
      projectedExpenses = budgetOverrideMap.get(year)!;
    } else if (
      y > 0 &&
      !(age === retirementAge && input.decumulationAnnualExpenses != null)
    ) {
      projectedExpenses = projectedExpenses * (1 + effectiveInflation);
    }

    // --- Spending Strategy Dispatch ---
    const preTotalBalance =
      balances.preTax + balances.taxFree + balances.hsa + balances.afterTax;
    let strategyAction: string | null = null;

    if (!isAccumulation && activeStrategy !== "fixed") {
      const result = applySpendingStrategy(
        activeStrategy,
        activeStrategyParams,
        {
          projectedExpenses,
          portfolioBalance: preTotalBalance,
          effectiveInflation,
          hasBudgetOverride: budgetOverrideMap.has(year),
          yearIndex: y,
          age,
          crossYearState: spendingState,
        },
      );
      projectedExpenses = result.projectedExpenses;
      strategyAction = result.action;
      Object.assign(spendingState, result.updatedState);
    }

    const totalBalance = preTotalBalance;

    if (isAccumulation) {
      // --- ACCUMULATION PHASE ---
      const config = resolveAccumulationConfig(
        year,
        accumulationDefaults,
        sortedAccOverrides,
      );

      // IRS limits grow annually
      const lgf = Math.pow(1 + limitGrowthRate, y);
      const yearLimits: Record<AccountCategory, number> = Object.fromEntries(
        getAllCategories().map((cat) => {
          if (!getAccountTypeConfig(cat).hasIrsLimit) return [cat, 0];
          // Categories in a shared limit group use the group leader's base limit
          const limitKey = getLimitGroup(cat) ?? cat;
          return [
            cat,
            roundToCents((baseLimits[limitKey as AccountCategory] ?? 0) * lgf),
          ];
        }),
      ) as Record<AccountCategory, number>;

      // Add age-based catchup limits (grown at the same rate as base limits)
      if (catchupLimits) {
        const projectedAge = currentAge + y;
        for (const cat of categoriesWithIrsLimit()) {
          const cfg = getAccountTypeConfig(cat);
          const group = getLimitGroup(cat) ?? cat;
          const superRange = cfg.superCatchupAgeRange;
          // Super-catchup replaces regular catchup if in the age range
          if (
            superRange &&
            projectedAge >= superRange[0] &&
            projectedAge <= superRange[1]
          ) {
            const superKey = `${group}_super`;
            yearLimits[cat] += roundToCents(
              (catchupLimits[superKey] ?? 0) * lgf,
            );
          } else if (
            cfg.catchupAge !== null &&
            projectedAge >= cfg.catchupAge
          ) {
            yearLimits[cat] += roundToCents((catchupLimits[group] ?? 0) * lgf);
          }
        }
      }

      // Year 0 with real contribution data: use actual per-account amounts
      // instead of salary × rate which can create artificial overflow
      const useRealContribs =
        y === 0 && activeBaseYearContributions && activeBaseYearEmployerMatch;

      // Pro-rate year 0 contributions/match based on months remaining in the year
      const proRate = y === 0 ? firstYearFraction : 1;

      let targetContribution: number;
      if (useRealContribs) {
        targetContribution = roundToCents(
          Object.values(activeBaseYearContributions!).reduce((s, v) => s + v, 0) *
            proRate,
        );
      } else if (contributionSpecs && contributionSpecs.length > 0) {
        // Sum projected per-account contributions (before IRS capping)
        const lgf = Math.pow(1 + limitGrowthRate, y);
        targetContribution = roundToCents(
          contributionSpecs.reduce((sum, spec) => {
            if (spec.method === "percent_of_salary") {
              return sum + projectedSalary * spec.salaryFraction * spec.value;
            }
            return sum + spec.baseAnnual * lgf;
          }, 0) * proRate,
        );
      } else {
        targetContribution = roundToCents(
          projectedSalary * Math.max(0, config.contributionRate) * proRate,
        );
      }

      // Apply contributionRate as a ceiling on targetContribution (waterfall/percentage fallback path).
      // The per-account specs path applies its own ceiling after routeFromSpecs returns.
      // Skip year 0 real contribs since those are actual paycheck data.
      if (
        !useRealContribs &&
        !(contributionSpecs && contributionSpecs.length > 0)
      ) {
        const rateCeiling = roundToCents(
          projectedSalary * Math.max(0, config.contributionRate) * proRate,
        );
        if (targetContribution > rateCeiling) {
          targetContribution = rateCeiling;
        }
      }

      // Employer match (grows with salary in future years; pro-rated for year 0)
      const yearEmployerMatch: Record<AccountCategory, number> =
        Object.fromEntries(
          getAllCategories().map((cat) => [
            cat,
            useRealContribs
              ? roundToCents((activeBaseYearEmployerMatch![cat] ?? 0) * proRate)
              : roundToCents(
                  projectedSalary *
                    Math.max(0, activeEmployerMatchRateByCategory[cat] ?? 0) *
                    proRate,
                ),
          ]),
        ) as Record<AccountCategory, number>;

      let slots: AccumulationSlot[];
      let routeWarnings: string[];
      let specOverflow = 0; // overflow from per-account routing (only IRS cap spillover)
      let rateCeilingScale: number | null = null; // set when rate ceiling scales down contributions

      if (useRealContribs) {
        // Build slots from per-account annual projections, pro-rated for partial year 0
        const categories: AccountCategory[] = getAllCategories();
        slots = categories
          .filter(
            (cat) =>
              activeBaseYearContributions![cat] > 0 || yearEmployerMatch[cat] > 0,
          )
          .map((cat) => {
            const employeeContrib = roundToCents(
              activeBaseYearContributions![cat] * proRate,
            );
            const irsLimit = yearLimits[cat];
            const rothFrac = configGetRothFraction(cat, config.taxSplits);
            const rothContrib = roundToCents(employeeContrib * rothFrac);
            const tradContrib = roundToCents(employeeContrib - rothContrib);
            return {
              category: cat,
              irsLimit,
              effectiveLimit: isOverflowTarget(cat) ? 0 : irsLimit,
              employerMatch: yearEmployerMatch[cat],
              employeeContrib,
              rothContrib,
              traditionalContrib: tradContrib,
              remainingSpace: isOverflowTarget(cat)
                ? 0
                : roundToCents(Math.max(0, irsLimit - employeeContrib)),
              cappedByAccount: false,
              cappedByTaxType: false,
              overflowAmount: 0,
            };
          });
        routeWarnings = [];
      } else if (contributionSpecs && contributionSpecs.length > 0) {
        // Per-account routing from DB specs — respects each account's method
        const limitGrowthFactor = Math.pow(1 + limitGrowthRate, y);
        const routed = routeFromSpecs(
          contributionSpecs,
          projectedSalary,
          currentSalary,
          yearLimits,
          yearEmployerMatch,
          limitGrowthFactor,
          config,
        );
        slots = routed.slots;
        routeWarnings = routed.warnings;
        specOverflow = routed.totalOverflow;

        // Pro-rate year 0 spec-based employee contributions (routeFromSpecs computes full-year amounts)
        if (proRate < 1) {
          for (const slot of slots) {
            slot.employeeContrib = roundToCents(slot.employeeContrib * proRate);
            slot.rothContrib = roundToCents(slot.rothContrib * proRate);
            slot.traditionalContrib = roundToCents(
              slot.traditionalContrib * proRate,
            );
            slot.remainingSpace = isOverflowTarget(slot.category)
              ? 0
              : roundToCents(
                  Math.max(0, slot.effectiveLimit - slot.employeeContrib),
                );
          }
          // Recompute overflow — pro-rating may reduce or eliminate it
          specOverflow = roundToCents(specOverflow * proRate);
        }

        // Apply contributionRate ceiling to per-account spec output.
        // The rate ceiling is authoritative — overrides always take effect.
        const specTotal = roundToCents(sumBy(slots, (s) => s.employeeContrib));
        const rateCeiling = roundToCents(
          projectedSalary * Math.max(0, config.contributionRate) * proRate,
        );
        if (specTotal > rateCeiling && rateCeiling > 0) {
          const scale = rateCeiling / specTotal;
          rateCeilingScale = scale;
          for (const slot of slots) {
            const newEmployee = roundToCents(slot.employeeContrib * scale);
            const newRoth = roundToCents(slot.rothContrib * scale);
            const newTrad = roundToCents(slot.traditionalContrib * scale);
            slot.employeeContrib = newEmployee;
            slot.rothContrib = newRoth;
            slot.traditionalContrib = newTrad;
            slot.remainingSpace = isOverflowTarget(slot.category)
              ? 0
              : roundToCents(Math.max(0, slot.effectiveLimit - newEmployee));
          }
          // Recompute overflow — scaling down may eliminate it
          specOverflow = 0;
        }
      } else {
        // Fallback: Route contributions based on mode (blended rate)
        const routed =
          config.routingMode === "waterfall"
            ? routeWaterfall(
                targetContribution,
                config,
                yearLimits,
                yearEmployerMatch,
              )
            : routePercentage(
                targetContribution,
                config,
                yearLimits,
                yearEmployerMatch,
              );
        slots = routed.slots;
        routeWarnings = routed.warnings;
      }

      const totalEmployee = roundToCents(
        sumBy(slots, (s) => s.employeeContrib),
      );
      const totalEmployer = roundToCents(sumBy(slots, (s) => s.employerMatch));
      const totalRoth = roundToCents(sumBy(slots, (s) => s.rothContrib));
      const totalTraditional = roundToCents(
        sumBy(slots, (s) => s.traditionalContrib),
      );
      // Overflow = only the amount that spilled from tax-advantaged IRS caps to brokerage.
      // Year 0: no overflow (brokerage is intentional).
      // Per-account specs: use specOverflow (only IRS cap spillover, not intentional brokerage).
      // Fallback waterfall/percentage: subtract intentional brokerage (scaled from base year).
      let overflowToBrokerage: number;
      if (useRealContribs) {
        overflowToBrokerage = 0;
      } else if (contributionSpecs && contributionSpecs.length > 0) {
        overflowToBrokerage =
          specOverflow < OVERFLOW_TOLERANCE ? 0 : specOverflow;
      } else {
        const brokerageContrib =
          slots.find((s) => isOverflowTarget(s.category))?.employeeContrib ?? 0;
        // Base year brokerage is intentional; scale proportionally with salary
        const baseIntentional = activeBaseYearContributions?.brokerage ?? 0;
        const salaryScale =
          currentSalary > 0 ? projectedSalary / currentSalary : 1;
        const intentional = roundToCents(baseIntentional * salaryScale);
        const raw = Math.max(0, roundToCents(brokerageContrib - intentional));
        overflowToBrokerage = raw < OVERFLOW_TOLERANCE ? 0 : raw;
      }
      const totalTaxAdvSpace = roundToCents(
        slots
          .filter((s) => TAX_ADVANTAGED.has(s.category))
          .reduce((s, sl) => s + sl.irsLimit, 0),
      );

      // Track first overflow
      if (overflowToBrokerage > 0 && firstOverflowYear === null) {
        firstOverflowYear = year;
        firstOverflowAge = age;
        firstOverflowAmount = overflowToBrokerage;
      }

      // Update balances: contributions + employer match
      // Route contributions to correct tax buckets AND per-account balances
      for (const slot of slots) {
        const bs = getAccountTypeConfig(slot.category).balanceStructure;
        if (bs === "roth_traditional") {
          balances.preTax += slot.traditionalContrib + slot.employerMatch;
          balances.taxFree += slot.rothContrib;
          addTraditional(
            acctBal[slot.category],
            slot.traditionalContrib + slot.employerMatch,
          );
          addRoth(acctBal[slot.category], slot.rothContrib);
        } else if (bs === "single_bucket") {
          balances.hsa += slot.employeeContrib + slot.employerMatch;
          addBalance(
            acctBal[slot.category],
            slot.employeeContrib + slot.employerMatch,
          );
        } else {
          // basis_tracking (brokerage) — track both balance and cost basis
          const brokerageContrib = slot.employeeContrib + slot.employerMatch;
          balances.afterTax += brokerageContrib;
          balances.afterTaxBasis += brokerageContrib;
          addBalance(acctBal[slot.category], brokerageContrib);
          addBasis(acctBal[slot.category], brokerageContrib);
        }
      }

      // Apply brokerage contribution ramp (additional $X × year index, starting year 1)
      const rampYear = Math.min(y, MAX_BROKERAGE_RAMP_YEARS);
      const rampAmount =
        (brokerageContributionRamp ?? 0) > 0 && y > 0
          ? roundToCents(brokerageContributionRamp! * rampYear)
          : 0;
      if (rampAmount > 0) {
        balances.afterTax += rampAmount;
        balances.afterTaxBasis += rampAmount;
        addBalance(acctBal[OVERFLOW_CATEGORY], rampAmount);
        addBasis(acctBal[OVERFLOW_CATEGORY], rampAmount);
      }

      // Route contributions, match, overflow, and ramp to individual accounts
      // Extracted to individual-account-tracking.ts
      let indContribs = new Map<string, number>();
      let indMatch = new Map<string, number>();
      let indIntentional = new Map<string, number>();
      let indOverflow = new Map<string, number>();
      let indRamp = new Map<string, number>();
      if (hasIndividualAccounts && contributionSpecs) {
        const distResult = distributeContributions({
          slots,
          contributionSpecs,
          indAccts,
          indKey,
          indBal,
          indParentCat,
          specToAccount,
          accountsWithSpecs,
          projectedSalary,
          currentSalary,
          limitGrowthRate,
          yearIndex: y,
          proRate,
          overflowToBrokerage,
          rampAmount,
          employerMatchByParentCat: activeEmployerMatchByParentCat,
        });
        indContribs = distResult.indContribs;
        indMatch = distResult.indMatch;
        indIntentional = distResult.indIntentional;
        indOverflow = distResult.indOverflow;
        indRamp = distResult.indRamp;
      }

      // Apply growth to each bucket (pro-rated for year 0)
      // Extracted to growth-application.ts — applies return rate to all balance structures.
      const effectiveReturn =
        y === 0 ? Math.pow(1 + returnRate, firstYearFraction) - 1 : returnRate;
      applyGrowth({ effectiveReturn, balances, acctBal });
      // Per-individual-account growth — extracted to individual-account-tracking.ts
      const indGrowth = hasIndividualAccounts
        ? applyIndividualGrowth(indAccts, indKey, indBal, effectiveReturn)
        : new Map<string, number>();

      // Process brokerage goal withdrawals during accumulation
      const yearGoals = brokerageGoalsByYear.get(year) ?? [];
      const goalWithdrawals: EngineAccumulationYear["brokerageGoalWithdrawals"] =
        [];
      for (const goal of yearGoals) {
        const drawAmount = roundToCents(
          Math.min(goal.targetAmount, balances.afterTax),
        );
        if (drawAmount <= 0) {
          goalWithdrawals.push({
            goalId: goal.id,
            name: goal.name,
            amount: 0,
            basisPortion: 0,
            gainsPortion: 0,
            taxCost: 0,
          });
          routeWarnings.push(
            `Brokerage goal "${goal.name}" unfunded — insufficient balance`,
          );
          continue;
        }
        const basisRatio =
          balances.afterTax > 0
            ? Math.min(1, balances.afterTaxBasis / balances.afterTax)
            : 0;
        const basisPortion = roundToCents(drawAmount * basisRatio);
        const gainsPortion = roundToCents(drawAmount - basisPortion);
        const taxCost = roundToCents(
          gainsPortion *
            (decumulationDefaults.distributionTaxRates?.brokerage ?? 0.15),
        );
        balances.afterTax = roundToCents(balances.afterTax - drawAmount);
        balances.afterTaxBasis = roundToCents(
          Math.max(0, balances.afterTaxBasis - basisPortion),
        );
        addBalance(acctBal[OVERFLOW_CATEGORY], -drawAmount);
        setBasis(
          acctBal[OVERFLOW_CATEGORY],
          roundToCents(
            Math.max(0, getBasis(acctBal[OVERFLOW_CATEGORY]) - basisPortion),
          ),
        );
        // Distribute brokerage goal withdrawal — extracted to individual-account-tracking.ts
        if (hasIndividualAccounts) {
          distributeGoalWithdrawal(drawAmount, indAccts, indKey, indBal);
        }
        goalWithdrawals.push({
          goalId: goal.id,
          name: goal.name,
          amount: drawAmount,
          basisPortion,
          gainsPortion,
          taxCost,
        });
      }

      // Build individual account year balances — extracted to individual-account-tracking.ts
      const indYearBalances: IndividualAccountYearBalance[] =
        hasIndividualAccounts
          ? buildIndividualYearBalances(
              indAccts,
              indKey,
              indBal,
              indParentCat,
              "accumulation",
              {
                contribs: indContribs,
                match: indMatch,
                growth: indGrowth,
                intentional: indIntentional,
                overflow: indOverflow,
                ramp: indRamp,
              },
            )
          : [];

      const endBalance = roundToCents(
        balances.preTax + balances.taxFree + balances.hsa + balances.afterTax,
      );

      // Divergence check: last accumulation year
      if (age === retirementAge - 1) {
        const rothTotal = getAllCategories().reduce((s, cat) => {
          const b = acctBal[cat];
          return s + (b.structure === "roth_traditional" ? b.roth : 0);
        }, 0);
        if (Math.abs(rothTotal - balances.taxFree) > 1) {
          routeWarnings.push(
            `[DIAG] Roth divergence at end of accumulation (age ${age}): acctBal.roth=${rothTotal.toFixed(0)}, balances.taxFree=${balances.taxFree.toFixed(0)}, delta=${(balances.taxFree - rothTotal).toFixed(0)}`,
          );
        }
      }

      const yearProjection: EngineAccumulationYear = {
        year,
        age,
        phase: "accumulation",
        projectedSalary: roundToCents(projectedSalary),
        projectedSalaryByPerson: hasPerPersonSalary
          ? Object.fromEntries(
              Array.from(projectedSalaryByPerson.entries()).map(
                ([pid, sal]) => [pid, roundToCents(sal)],
              ),
            )
          : undefined,
        projectedExpenses: roundToCents(projectedExpenses),
        hasSalaryOverride:
          salaryOverrideMap.has(year) || perPersonSalaryOverrides.has(year),
        hasBudgetOverride: budgetOverrideMap.has(year),
        proRateFraction:
          y === 0 && firstYearFraction < 1 ? firstYearFraction : null,
        targetContribution,
        config,
        slots,
        totalEmployee,
        totalEmployer,
        totalRoth,
        totalTraditional,
        rateCeilingScale,
        overflowToBrokerage,
        brokerageRampContribution: rampAmount,
        totalTaxAdvSpace,
        brokerageGoalWithdrawals: goalWithdrawals,
        endBalance,
        balanceByTaxType: { ...balances },
        balanceByAccount: cloneAccountBalances(acctBal),
        individualAccountBalances: indYearBalances,
        returnRate: effectiveReturn,
        annualizedReturnRate:
          y === 0 && firstYearFraction < 1
            ? Math.pow(1 + effectiveReturn, 1 / firstYearFraction) - 1
            : returnRate,
        warnings: routeWarnings,
      };

      // Update RMD tracking at end of accumulation year
      priorYearEndTradBalance = balances.preTax;

      projectionByYear.push(yearProjection);
    } else {
      // --- DECUMULATION PHASE ---
      const config = resolveDecumulationConfig(
        year,
        decumulationDefaults,
        sortedDecOverrides,
      );

      // Reconciliation check: acctBal Roth total should match balances.taxFree
      const acctBalRothTotal = getAllCategories().reduce((s, cat) => {
        const b = acctBal[cat];
        return s + (b.structure === "roth_traditional" ? b.roth : 0);
      }, 0);
      const rothDivergence =
        Math.abs(acctBalRothTotal - balances.taxFree) > 1
          ? `[DIAG] Roth divergence: acctBal.roth=${acctBalRothTotal.toFixed(0)}, balances.taxFree=${balances.taxFree.toFixed(0)}, delta=${(balances.taxFree - acctBalRothTotal).toFixed(0)}`
          : null;

      // Social Security income reduces withdrawal need
      const ssIncome = age >= ssStartAge ? socialSecurityAnnual : 0;
      const afterTaxNeed = roundToCents(
        Math.max(0, projectedExpenses - ssIncome),
      );

      // Tax gross-up: estimate tax from expected withdrawal routing, then
      // increase withdrawal so after-tax proceeds cover the expense need.
      const taxRates = decumulationDefaults.distributionTaxRates;
      const estTraditionalPortion =
        totalBalance > 0 ? balances.preTax / totalBalance : 0;

      // SS convergence + gross-up estimation (extracted to tax-estimation module)
      const taxEst = estimateWithdrawalTaxCost({
        afterTaxNeed,
        ssIncome,
        filingStatus,
        config,
        taxRates,
        balances,
        acctBal,
        totalBalance,
        estTraditionalPortion,
      });
      let { taxableSS } = taxEst;
      let { grossUpFactor } = taxEst;
      const { targetWithdrawal } = taxEst;

      // Build per-account, per-tax-type balances for withdrawal routing
      // Uses real per-account balances tracked through accumulation
      const acctBalances = acctBal;
      const preWithdrawalAcctBal = cloneAccountBalances(acctBal);

      // Route withdrawals based on configured mode.
      // bracket_filling: tax-optimal — fills traditional up to bracket cap, Roth for rest
      // waterfall: sequential drain in priority order (legacy behavior)
      // percentage: fixed % split across accounts
      //
      // For waterfall/percentage, Roth bracket optimization can still overlay
      // via rothBracketTarget (sets a traditional tax-type cap).
      let routeResult: {
        slots: DecumulationSlot[];
        warnings: string[];
        traditionalCap?: number;
        unmetNeed?: number;
      };

      if (config.withdrawalRoutingMode === "bracket_filling") {
        routeResult = routeWithdrawalsBracketFilling(
          targetWithdrawal,
          config,
          acctBalances,
          {
            taxBrackets: taxRates.taxBrackets,
            rothBracketTarget: taxRates.rothBracketTarget,
            taxableSS,
          },
        );
      } else if (config.withdrawalRoutingMode === "percentage") {
        routeResult = routeWithdrawalsPercentage(
          targetWithdrawal,
          config,
          acctBalances,
        );
      } else {
        // Waterfall mode — apply Roth bracket optimization overlay if configured
        const routeConfig = { ...config };
        if (
          taxRates.rothBracketTarget != null &&
          taxRates.taxBrackets &&
          taxRates.taxBrackets.length > 0
        ) {
          const incomeCap = incomeCapForMarginalRate(
            taxRates.rothBracketTarget,
            taxRates.taxBrackets,
          );
          const rothOptTraditionalCap = roundToCents(
            Math.max(0, incomeCap - taxableSS),
          );
          if (rothOptTraditionalCap < Infinity) {
            const existingTradCap =
              routeConfig.withdrawalTaxTypeCaps.traditional;
            routeConfig.withdrawalTaxTypeCaps = {
              ...routeConfig.withdrawalTaxTypeCaps,
              traditional:
                existingTradCap !== null
                  ? Math.min(rothOptTraditionalCap, existingTradCap)
                  : rothOptTraditionalCap,
            };
            // Set Roth-split categories to traditional preference for bracket optimization,
            // but only where the user hasn't set an explicit preference (null = no preference).
            const tradOverrides = Object.fromEntries(
              categoriesWithTaxPreference()
                .filter(
                  (cat) => routeConfig.withdrawalTaxPreference[cat] === null,
                )
                .map((cat) => [cat, "traditional" as const]),
            );
            routeConfig.withdrawalTaxPreference = {
              ...routeConfig.withdrawalTaxPreference,
              ...tradOverrides,
            };
            routeConfig.withdrawalOrder = getDefaultDecumulationOrder();
          }
        }
        routeResult = routeWithdrawals(
          targetWithdrawal,
          routeConfig,
          acctBalances,
        );
      }

      const { slots, warnings: routeWarnings } = routeResult;
      if (rothDivergence) routeWarnings.push(rothDivergence);

      let totalWithdrawal = roundToCents(sumBy(slots, (s) => s.withdrawal));
      const totalRothWithdrawal = roundToCents(
        sumBy(slots, (s) => s.rothWithdrawal),
      );
      let totalTraditionalWithdrawal = roundToCents(
        sumBy(slots, (s) => s.traditionalWithdrawal),
      );

      // --- RMD enforcement (Phase 1) ---
      // Extracted to rmd-enforcement.ts — enforces minimum Traditional withdrawals per IRS rules.
      const rmdResult = enforceRmd({
        age,
        rmdStartAge,
        priorYearEndTradBalance,
        slots,
        totalTraditionalWithdrawal,
        totalWithdrawal,
        acctBal,
      });
      const { rmdAmount, rmdOverrodeRouting } = rmdResult;
      totalTraditionalWithdrawal = rmdResult.totalTraditionalWithdrawal;
      totalWithdrawal = rmdResult.totalWithdrawal;
      routeWarnings.push(...rmdResult.warnings);

      // Recompute taxableSS with actual Traditional withdrawal (post-RMD) for final tax cost
      if (filingStatus && ssIncome > 0) {
        taxableSS = computeTaxableSS(
          ssIncome,
          totalTraditionalWithdrawal,
          filingStatus,
        );
      }

      // Calculate tax cost per withdrawal type using bracket-estimated traditional rate
      const hsaWithdrawal =
        slots.find(
          (s) =>
            getAccountTypeConfig(s.category).balanceStructure ===
            "single_bucket",
        )?.withdrawal ?? 0;
      const brokerageSlot = slots.find((s) => isOverflowTarget(s.category));
      const brokerageWithdrawal = brokerageSlot?.withdrawal ?? 0;
      // Re-estimate traditional rate on actual withdrawal amount (more accurate than pre-routing estimate)
      const actualTaxableIncome = totalTraditionalWithdrawal + taxableSS;
      const actualTraditionalRate =
        taxRates.taxBrackets && taxRates.taxBrackets.length > 0
          ? estimateEffectiveTaxRate(
              actualTaxableIncome,
              taxRates.taxBrackets,
              taxRates.taxMultiplier,
            )
          : taxRates.traditionalFallbackRate;

      // Basis-aware brokerage tax: only gains portion is taxable
      let brokerageTaxCost = 0;
      let brokerageBasisPortion = 0;
      let brokerageGainsPortion = 0;
      if (brokerageWithdrawal > 0 && balances.afterTax > 0) {
        const basisRatio = Math.min(
          1,
          balances.afterTaxBasis / balances.afterTax,
        );
        brokerageBasisPortion = roundToCents(brokerageWithdrawal * basisRatio);
        brokerageGainsPortion = roundToCents(
          brokerageWithdrawal - brokerageBasisPortion,
        );
        // Progressive LTCG tax: stack gains on top of ordinary income across 0%/15%/20% brackets
        brokerageTaxCost = filingStatus
          ? roundToCents(computeLtcgTax(actualTaxableIncome, brokerageGainsPortion, filingStatus))
          : roundToCents(brokerageGainsPortion * taxRates.brokerage);
        // Annotate the slot with basis/gains breakdown
        if (brokerageSlot) {
          brokerageSlot.basisPortion = brokerageBasisPortion;
          brokerageSlot.gainsPortion = brokerageGainsPortion;
        }
      }

      let taxCost = roundToCents(
        totalTraditionalWithdrawal * actualTraditionalRate +
          totalRothWithdrawal * taxRates.roth +
          hsaWithdrawal * taxRates.hsa +
          brokerageTaxCost,
      );

      // Recompute grossUpFactor post-RMD for accurate diagnostics (#45).
      // Pre-RMD estimate may understate tax when RMD forces additional Traditional withdrawals.
      if (rmdOverrodeRouting && afterTaxNeed > 0) {
        const postRmdEffRate = taxCost / (afterTaxNeed + taxCost);
        grossUpFactor =
          postRmdEffRate < 1 ? 1 / (1 - postRmdEffRate) : grossUpFactor;
      }

      // Deduct withdrawals from tax buckets and per-account balances — extracted to balance-deduction.ts
      deductWithdrawals({ slots, balances, acctBal, brokerageBasisPortion });

      // Distribute withdrawals to individual accounts — extracted to individual-account-tracking.ts
      const decIndWithdrawal = hasIndividualAccounts
        ? distributeWithdrawals(slots, indAccts, indKey, indBal)
        : new Map<string, number>();

      // Ensure no negative balances — extracted to balance-deduction.ts
      clampBalances(balances, acctBal);

      // Reinvest RMD excess into brokerage (#39) — extracted to balance-deduction.ts
      const shouldReinvestRmdExcess = input.reinvestRmdExcess !== false; // default: true
      reinvestRmdExcess(
        shouldReinvestRmdExcess,
        rmdOverrodeRouting,
        totalWithdrawal,
        afterTaxNeed,
        taxCost,
        balances,
        acctBal,
      );

      // Clamp individual account balances — extracted to individual-account-tracking.ts
      if (hasIndividualAccounts) {
        clampIndividualBalances(indAccts, indKey, indBal);
      }

      // Track per-account depletions — extracted to balance-deduction.ts
      trackDepletions(acctBal, depletionTracked, accountDepletions, year, age);

      // --- Roth Conversions (Phase 4) ---
      // Extracted to post-withdrawal-optimizer.ts — Roth conversion + IRMAA + ACA chain.
      const rothResult = performRothConversion({
        enableRothConversions: taxRates.enableRothConversions,
        taxBrackets: taxRates.taxBrackets,
        taxMultiplier: taxRates.taxMultiplier,
        rothConversionTarget: config.rothConversionTarget,
        rothBracketTarget:
          taxRates.rothConversionTarget ?? taxRates.rothBracketTarget,
        totalTraditionalWithdrawal,
        taxableSS,
        brokerageGainsPortion,
        irmaaAwareRothConversions:
          input.irmaaAwareRothConversions ??
          (enableIrmaaAwareness ? true : undefined),
        filingStatus,
        balances,
        acctBal,
      });
      const { rothConversionAmount, rothConversionTaxCost } = rothResult;

      // Recompute LTCG tax including Roth conversion income (#37).
      // Roth conversions are taxed as ordinary income and push total taxable income
      // into potentially higher LTCG brackets (0%/15%/20%).
      let postConversionLtcgRate: number;
      if (rothConversionAmount > 0 && filingStatus && brokerageGainsPortion > 0) {
        const revisedOrdinary = actualTaxableIncome + rothConversionAmount;
        brokerageTaxCost = roundToCents(
          computeLtcgTax(revisedOrdinary, brokerageGainsPortion, filingStatus),
        );
        postConversionLtcgRate = brokerageGainsPortion > 0
          ? brokerageTaxCost / brokerageGainsPortion
          : 0;
        // Recompute taxCost with revised brokerage tax
        taxCost = roundToCents(
          totalTraditionalWithdrawal * actualTraditionalRate +
            totalRothWithdrawal * taxRates.roth +
            hsaWithdrawal * taxRates.hsa +
            brokerageTaxCost,
        );
      } else {
        postConversionLtcgRate = brokerageGainsPortion > 0
          ? brokerageTaxCost / brokerageGainsPortion
          : (filingStatus ? getLtcgRate(actualTaxableIncome, filingStatus) : taxRates.brokerage);
      }

      // --- NIIT (Net Investment Income Tax, 3.8% surtax) ---
      // Applies to lesser of net investment income or MAGI exceeding threshold.
      // Roth conversions raise MAGI but are NOT net investment income.
      const currentYearMagi =
        totalTraditionalWithdrawal +
        rothConversionAmount +
        brokerageGainsPortion +
        taxableSS;
      const niitAmount = filingStatus
        ? computeNiit(currentYearMagi, brokerageGainsPortion, filingStatus)
        : 0;
      if (niitAmount > 0) {
        taxCost = roundToCents(taxCost + niitAmount);
      }

      // --- IRMAA Awareness (Phase 6) ---
      // Store MAGI for 2-year lookback (#18).
      magiHistory.push(currentYearMagi);
      // IRMAA uses year N-2 MAGI per IRS rules; fall back to current year for first 2 years.
      const irmaaLookbackMagi =
        magiHistory.length > 2
          ? magiHistory[magiHistory.length - 3]!
          : currentYearMagi;
      const anyPersonAge65 =
        perPersonBirthYears && perPersonBirthYears.length > 0
          ? perPersonBirthYears.some((by) => year - by >= 65)
          : age >= 65;
      const irmaaResult = checkIrmaa({
        enableIrmaaAwareness,
        filingStatus,
        anyPersonAge65,
        projectedMagi: irmaaLookbackMagi,
        rothConversionAmount,
      });
      const { irmaaCost } = irmaaResult;
      routeWarnings.push(...irmaaResult.warnings);

      // --- ACA Subsidy Awareness (Phase 7) ---
      const allPersonsUnder65 =
        perPersonBirthYears && perPersonBirthYears.length > 0
          ? perPersonBirthYears.every((by) => year - by < 65)
          : age < 65;
      const acaResult = checkAca({
        enableAcaAwareness,
        allPersonsUnder65,
        householdSize: householdSize ?? 2,
        totalTraditionalWithdrawal,
        rothConversionAmount,
        brokerageGainsPortion,
        taxableSS,
      });
      const { acaSubsidyPreserved, acaMagiHeadroom } = acaResult;
      routeWarnings.push(...acaResult.warnings);

      // Apply growth — extracted to growth-application.ts
      applyGrowth({ effectiveReturn: returnRate, balances, acctBal });

      // Update RMD tracking: year-end Traditional balance (after growth) for next year's RMD
      priorYearEndTradBalance = balances.preTax;
      // Update spending strategy state: prior year return + spending
      spendingState.priorYearReturn = returnRate;
      spendingState.priorYearSpending = projectedExpenses;
      // Per-individual-account growth (decumulation) — extracted to individual-account-tracking.ts
      const decIndGrowth = hasIndividualAccounts
        ? applyIndividualGrowth(indAccts, indKey, indBal, returnRate, true)
        : new Map<string, number>();

      // Build individual account year balances (decumulation) — extracted to individual-account-tracking.ts
      const decIndYearBalances: IndividualAccountYearBalance[] =
        hasIndividualAccounts
          ? buildIndividualYearBalances(
              indAccts,
              indKey,
              indBal,
              indParentCat,
              "decumulation",
              {
                growth: decIndGrowth,
                withdrawal: decIndWithdrawal,
              },
            )
          : [];

      // Zero out rounding dust — extracted to balance-deduction.ts
      cleanupDust(balances, acctBal, indAccts, indKey, indBal);
      const endBalance = roundToCents(
        balances.preTax + balances.taxFree + balances.hsa + balances.afterTax,
      );

      // Track depletion
      if (endBalance < 1 && portfolioDepletionYear === null) {
        portfolioDepletionYear = year;
        portfolioDepletionAge = age;
      }

      const yearProjection: EngineDecumulationYear = {
        year,
        age,
        phase: "decumulation",
        projectedExpenses: roundToCents(projectedExpenses),
        hasBudgetOverride: budgetOverrideMap.has(year),
        targetWithdrawal,
        config,
        slots,
        totalWithdrawal,
        totalRothWithdrawal,
        totalTraditionalWithdrawal,
        taxCost,
        effectiveTaxRate: totalWithdrawal > 0 ? taxCost / totalWithdrawal : 0,
        ssIncome,
        afterTaxNeed,
        grossUpFactor,
        estTraditionalPortion,
        bracketTraditionalCap: routeResult.traditionalCap,
        unmetNeed: routeResult.unmetNeed,
        preWithdrawalAcctBal,
        endBalance,
        balanceByTaxType: { ...balances },
        balanceByAccount: cloneAccountBalances(acctBal),
        individualAccountBalances: decIndYearBalances,
        returnRate,
        annualizedReturnRate: returnRate,
        rmdAmount,
        rmdOverrodeRouting,
        taxableSS,
        ltcgRate: postConversionLtcgRate,
        rothConversionAmount,
        rothConversionTaxCost,
        strategyAction,
        niitAmount,
        irmaaCost,
        acaSubsidyPreserved,
        acaMagiHeadroom,
        warnings: routeWarnings,
      };

      projectionByYear.push(yearProjection);
    }
  }

  // Compute sustainable withdrawal at retirement
  const retirementYear = projectionByYear.find((p) => p.age === retirementAge);
  const retirementBalance = retirementYear?.endBalance ?? 0;
  const retirementConfig = resolveDecumulationConfig(
    asOfDate.getFullYear() + (retirementAge - currentAge),
    decumulationDefaults,
    sortedDecOverrides,
  );
  const sustainableWithdrawal = roundToCents(
    retirementBalance * retirementConfig.withdrawalRate,
  );

  return {
    projectionByYear,
    firstOverflowYear,
    firstOverflowAge,
    firstOverflowAmount,
    portfolioDepletionYear,
    portfolioDepletionAge,
    sustainableWithdrawal,
    accountDepletions,
    warnings,
  };
}

