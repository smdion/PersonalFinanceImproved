/**
 * The Tax Buckets view at the retirement transition, from the engine's per-account balances,
 * assuming the plan is followed (unlike "now", which counts only real separations). Matched
 * on the same `(name, category, taxType, ownerPersonId)` key `computeTaxBucketBreakdown` uses.
 */
import type {
  EngineAccumulationYear,
  EngineYearProjection,
} from "@/lib/pure/engine/types/index";
import {
  isTaxFreeBucket,
  isAfterTaxType,
  isHsaCategory,
  isIraCategory,
  isRuleOf55EligibleCategory,
  tracksCostBasis,
} from "@/lib/config/account-types";
import { PENALTY_FREE_AGE, HSA_NON_MEDICAL_PENALTY_AGE } from "@/lib/constants";
import {
  isRuleOf55Eligible,
  computeBrokerageAccess,
  computeTraditionalIraAccess,
  computeEmployerPlanPreTaxAccess,
  computeEmployerPlanRothAccess,
  computeRothIraAccess,
  computeHsaAccess,
  type EarlyAccessSlice,
} from "@/lib/pure/accounts/early-access";
import type {
  AccountAnalysisEntry,
  AgeThresholdStatus,
  PersonInfo,
} from "@/lib/pure/accounts/tax-bucket-analysis";
import type {
  RothBasisMeta,
  RuleOf55Status,
} from "@/lib/pure/accounts/account-balances.types";
import { ageInYear } from "@/lib/utils/date";

function matchKey(
  name: string,
  category: string,
  taxType: string,
  ownerPersonId: number | null,
): string {
  return `${name}|${category}|${taxType}|${ownerPersonId ?? "null"}`;
}

type TaxBucketProjectionResult = {
  /** Null when the projection has no accumulation phase (already past the transition);
   *  the page says so rather than showing a zeroed view. */
  transitionYear: number | null;
  entries: AccountAnalysisEntry[];
  /** "Now" accounts with no projected row, carried unchanged in `entries` and named
   *  here so the page flags them as not projected. */
  unmatchedAccountNames: string[];
  /** Accounts whose Roth basis entry predates the current year; the unmodeled gap
   *  may understate the projected basis. */
  staleBasisAccountNames: string[];
};

/** contributionBasis + every taxFree-bucket `contribution` from the basis row's year
 *  (which may lag the current year) through the transition year, inclusive. Employer
 *  match is excluded: never Roth basis. */
function projectContributionBasis(
  rothBasisMeta: RothBasisMeta | null,
  contributionByYear: Map<number, number> | undefined,
  transitionYear: number,
): number {
  if (!rothBasisMeta) return 0;
  let sum = rothBasisMeta.contributionBasis;
  if (!contributionByYear) return sum;
  for (const [year, contribution] of contributionByYear) {
    if (year >= rothBasisMeta.year && year <= transitionYear) {
      sum += contribution;
    }
  }
  return sum;
}

/** Roth basis at the transition: the engine's per-account figures, so the page and the
 *  projection read one number; without them, `projectContributionBasis`. */
function transitionRothBasis(
  rothBasisMeta: RothBasisMeta | null,
  projectedRoth: {
    contributionBasisRemaining?: number;
    conversionBasisRemaining?: number;
  } = {},
  contributionByYear: Map<number, number> | undefined,
  transitionYear: number,
): { contributionBasis: number; conversionBasis: number } {
  return {
    contributionBasis:
      projectedRoth.contributionBasisRemaining ??
      projectContributionBasis(
        rothBasisMeta,
        contributionByYear,
        transitionYear,
      ),
    conversionBasis:
      projectedRoth.conversionBasisRemaining ??
      rothBasisMeta?.conversionBasis ??
      0,
  };
}

/** Brokerage cost basis at the transition: the engine's per-account basis, so the page
 *  and capital-gains tax read one figure; without it, `projectCostBasis`. */
function transitionCostBasis(
  costBasis: number,
  projectedCostBasis: number | undefined,
  balance: number,
  contributionByYear: Map<number, number> | undefined,
  currentYear: number,
  transitionYear: number,
): number {
  // Capped at the balance, as the engine caps its own (an account that's
  // down can't hand back more basis than it holds).
  return (
    projectedCostBasis ??
    Math.min(
      balance,
      projectCostBasis(
        costBasis,
        contributionByYear,
        currentYear,
        transitionYear,
      ),
    )
  );
}

/** Brokerage cost basis + every contribution from year 0 (the rest of this year) through
 *  the transition year, inclusive. All brokerage money is after-tax, so all of it is basis. */
function projectCostBasis(
  costBasis: number | null,
  contributionByYear: Map<number, number> | undefined,
  currentYear: number,
  transitionYear: number,
): number {
  if (costBasis == null) return 0;
  let sum = costBasis;
  if (!contributionByYear) return sum;
  for (const [year, contribution] of contributionByYear) {
    if (year >= currentYear && year <= transitionYear) {
      sum += contribution;
    }
  }
  return sum;
}

/** Rule of 55 for an assumed future year: a still-active job ("active") separates at
 *  `assumedYear`, capped by a known end date; any other source is reused unchanged.
 *  The engine's withdrawal eligibility reuses this too. */
export function projectRuleOf55(
  now: RuleOf55Status | null,
  assumedYear: number,
  birthYear: number,
  opts?: {
    /** Forces the projected verdict to ineligible, applied after the recompute below;
     *  keeps separation fields for display. Both callers must pass it identically; never
     *  applied to the "now" view (a forecasting assumption, not today's status). */
    forceIneligible?: boolean;
    /** Owner's planned retirement year: a still-active job ends by then, so retiring at
     *  50 isn't Rule-of-55 eligible at 55. Absent = no cap. */
    ownerRetirementYear?: number;
  },
): RuleOf55Status | null {
  let projected: RuleOf55Status | null = now;
  if (now && now.source === "active") {
    const separationYear = Math.min(
      now.knownFutureSeparationYear ?? Infinity,
      opts?.ownerRetirementYear ?? Infinity,
      assumedYear,
    );
    projected = {
      eligible: isRuleOf55Eligible(separationYear, birthYear),
      separationYear,
      source: now.source,
      knownFutureSeparationYear: now.knownFutureSeparationYear,
    };
  }
  if (!projected || !opts?.forceIneligible) return projected;
  return { ...projected, eligible: false };
}

export function computeTaxBucketProjection(input: {
  nowEntries: AccountAnalysisEntry[];
  projectionByYear: EngineYearProjection[];
  people: PersonInfo[];
  /** Rule of 55 forecasting override by personId, from the same setting the engine reads
   *  (`ruleOf55Override === false`). Kept off `PersonInfo`, which the "now" path shares
   *  and must never see it. */
  ruleOf55OverrideByPersonId?: Map<number, boolean>;
  /** Each person's planned retirement year — the same figure the engine
   *  puts on each account (`IndividualAccountInput.ownerRetirementYear`),
   *  so both agree on when a still-active job ends. */
  retirementYearByPersonId?: Map<number, number>;
}): TaxBucketProjectionResult {
  const {
    nowEntries,
    projectionByYear,
    people,
    ruleOf55OverrideByPersonId,
    retirementYearByPersonId,
  } = input;
  const peopleById = new Map(people.map((p) => [p.id, p]));

  const accumulationYears = projectionByYear.filter(
    (y): y is EngineAccumulationYear => y.phase === "accumulation",
  );
  if (accumulationYears.length === 0) {
    return {
      transitionYear: null,
      entries: [],
      unmatchedAccountNames: [],
      staleBasisAccountNames: [],
    };
  }
  const transitionYearRow = accumulationYears[accumulationYears.length - 1]!;
  const transitionYear = transitionYearRow.year;
  // Year 0 in the engine's accumulation phase is "now" — used to decide
  // whether a basis row's own year is genuinely behind the projection's
  // start (stale) vs. simply not yet rolled forward for this calendar year.
  const currentYear = accumulationYears[0]!.year;

  // Per-key contribution history across every accumulation year through the
  // transition — taxFree rows feed Roth basis projection, afterTax rows
  // feed Brokerage cost-basis projection; nothing else uses this map.
  const contributionsByKey = new Map<string, Map<number, number>>();
  for (const yearRow of accumulationYears) {
    for (const balance of yearRow.individualAccountBalances) {
      if (!isTaxFreeBucket(balance.taxType) && !isAfterTaxType(balance.taxType))
        continue;
      const key = matchKey(
        balance.name,
        balance.category,
        balance.taxType,
        balance.ownerPersonId ?? null,
      );
      let yearMap = contributionsByKey.get(key);
      if (!yearMap) {
        yearMap = new Map();
        contributionsByKey.set(key, yearMap);
      }
      yearMap.set(yearRow.year, balance.contribution);
    }
  }

  const transitionBalanceByKey = new Map(
    transitionYearRow.individualAccountBalances.map((balance) => [
      matchKey(
        balance.name,
        balance.category,
        balance.taxType,
        balance.ownerPersonId ?? null,
      ),
      balance,
    ]),
  );

  const unmatchedAccountNames: string[] = [];
  const staleBasisAccountNames: string[] = [];

  const entries: AccountAnalysisEntry[] = nowEntries.map((now) => {
    const key = matchKey(
      now.displayName,
      now.category,
      now.taxType,
      now.ownerPersonId,
    );
    const projected = transitionBalanceByKey.get(key);
    if (!projected) {
      unmatchedAccountNames.push(now.displayName);
      return now;
    }

    const balance = projected.balance;
    const person =
      now.ownerPersonId != null ? peopleById.get(now.ownerPersonId) : undefined;

    // An account with no resolvable owner ID at all (data gap, not a real
    // joint account) gets no recomputation — same as the "now" view.
    if (now.ownerPersonId != null && !person) {
      return {
        ...now,
        balance,
        slices: [],
        ruleOf55: null,
        rothBasisMeta: null,
        ageThresholdStatus: null,
      };
    }

    let slices: EarlyAccessSlice[] = [];
    let ruleOf55: RuleOf55Status | null = now.ruleOf55;
    let rothBasisMeta: RothBasisMeta | null = now.rothBasisMeta;

    if (
      now.rothBasisMeta &&
      isTaxFreeBucket(now.taxType) &&
      now.rothBasisMeta.year < currentYear
    ) {
      staleBasisAccountNames.push(now.displayName);
    }

    if (now.ownerPersonId == null) {
      // Joint account, no single owner: age-gated rules stay unattributed; the
      // brokerage basis/growth split needs no person, so project it as below.
      let projectedCostBasis: number | null = now.costBasis;
      if (now.costBasis != null) {
        projectedCostBasis = transitionCostBasis(
          now.costBasis,
          projected.costBasis,
          balance,
          contributionsByKey.get(key),
          currentYear,
          transitionYear,
        );
        slices = computeBrokerageAccess(balance, projectedCostBasis);
      }
      return {
        ...now,
        balance,
        slices,
        ruleOf55: null,
        rothBasisMeta: null,
        costBasis: projectedCostBasis,
      };
    }

    const ageAtTransition = ageInYear(person!.birthYear, transitionYear);
    let ageThresholdStatus: AgeThresholdStatus | null = null;
    if (isIraCategory(now.category)) {
      ageThresholdStatus = {
        thresholdAge: PENALTY_FREE_AGE,
        eligible: ageAtTransition >= PENALTY_FREE_AGE,
      };
    } else if (isHsaCategory(now.category)) {
      ageThresholdStatus = {
        thresholdAge: HSA_NON_MEDICAL_PENALTY_AGE,
        eligible: ageAtTransition >= HSA_NON_MEDICAL_PENALTY_AGE,
      };
    }

    if (isIraCategory(now.category)) {
      if (isTaxFreeBucket(now.taxType)) {
        const {
          contributionBasis: projectedContributionBasis,
          conversionBasis: projectedConversionBasis,
        } = transitionRothBasis(
          now.rothBasisMeta,
          projected.roth,
          contributionsByKey.get(key),
          transitionYear,
        );
        rothBasisMeta = now.rothBasisMeta
          ? {
              ...now.rothBasisMeta,
              contributionBasis: projectedContributionBasis,
              conversionBasis: projectedConversionBasis,
            }
          : null;
        slices = computeRothIraAccess({
          balance,
          currentAge: ageAtTransition,
          currentYear: transitionYear,
          contributionBasis: projectedContributionBasis,
          conversionBasis: projectedConversionBasis,
          latestConversionYear: now.rothBasisMeta?.latestConversionYear ?? null,
        });
      } else {
        slices = computeTraditionalIraAccess(balance, ageAtTransition);
      }
    } else if (isRuleOf55EligibleCategory(now.category)) {
      ruleOf55 = projectRuleOf55(
        now.ruleOf55,
        transitionYear,
        person!.birthYear,
        {
          forceIneligible:
            ruleOf55OverrideByPersonId?.get(now.ownerPersonId) === false,
          ownerRetirementYear: retirementYearByPersonId?.get(now.ownerPersonId),
        },
      );
      const eligible = ruleOf55?.eligible ?? false;
      if (isTaxFreeBucket(now.taxType)) {
        const {
          contributionBasis: projectedContributionBasis,
          conversionBasis: projectedConversionBasis,
        } = transitionRothBasis(
          now.rothBasisMeta,
          projected.roth,
          contributionsByKey.get(key),
          transitionYear,
        );
        rothBasisMeta = now.rothBasisMeta
          ? {
              ...now.rothBasisMeta,
              contributionBasis: projectedContributionBasis,
              conversionBasis: projectedConversionBasis,
            }
          : null;
        const enteredBasis =
          projectedContributionBasis + projectedConversionBasis;
        slices = computeEmployerPlanRothAccess(
          balance,
          ageAtTransition,
          eligible,
          enteredBasis,
        );
      } else {
        slices = computeEmployerPlanPreTaxAccess(
          balance,
          ageAtTransition,
          eligible,
        );
      }
    }

    let costBasis = now.costBasis;
    if (costBasis != null && tracksCostBasis(now.category)) {
      // Brokerage — basis grows with every dollar put in before the
      // transition, as the projection tracks it (see transitionCostBasis).
      costBasis = transitionCostBasis(
        costBasis,
        projected.costBasis,
        balance,
        contributionsByKey.get(key),
        currentYear,
        transitionYear,
      );
      slices = computeBrokerageAccess(balance, costBasis);
    } else if (isHsaCategory(now.category)) {
      slices = computeHsaAccess(balance, ageAtTransition);
    }

    return {
      ...now,
      balance,
      slices,
      ruleOf55,
      rothBasisMeta,
      costBasis,
      ageThresholdStatus,
    };
  });

  return {
    transitionYear,
    entries,
    unmatchedAccountNames,
    staleBasisAccountNames,
  };
}
