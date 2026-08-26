/**
 * Projects the "now" Tax Buckets analysis forward to the household's one
 * modeled retirement transition, using the real retirement projection
 * engine's per-account `individualAccountBalances`. A second, additive view
 * alongside `computeTaxBucketAnalysis`'s "now" view (`tax-bucket-analysis.ts`)
 * — never merged with it.
 *
 * "At retirement" deliberately assumes the plan is followed (contributions
 * continue as configured, no early separation) — the opposite premise of
 * "now", which only ever counts a real, already-happened separation. Both
 * premises are correct for their own question; keeping them in separate
 * functions/entries is what keeps that distinction visible instead of
 * silently blended.
 *
 * Advisor-reviewed twice this session (see the plan file) — the match key
 * is deliberately the same `(name, category, taxType, ownerPersonId)` tuple
 * `computeTaxBucketBreakdown` groups `accountRollup` on, so a rollup entry
 * and an engine row that represent the same real account always merge
 * identically on both sides instead of drifting apart.
 */
import type {
  EngineAccumulationYear,
  EngineYearProjection,
} from "@/lib/calculators/types/engine-projection";
import {
  getAccountTypeConfig,
  isTaxFreeBucket,
  isAfterTaxType,
  isHsaCategory,
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
} from "@/lib/pure/early-access";
import type {
  AccountAnalysisEntry,
  AgeThresholdStatus,
  PersonInfo,
  RothBasisMeta,
  RuleOf55Status,
} from "@/lib/pure/tax-bucket-analysis";

function ageInYear(birthYear: number, year: number): number {
  return year - birthYear;
}

function matchKey(
  name: string,
  category: string,
  taxType: string,
  ownerPersonId: number | null,
): string {
  return `${name}|${category}|${taxType}|${ownerPersonId ?? "null"}`;
}

export type TaxBucketProjectionResult = {
  /** Null when the projection has no modeled accumulation phase at all —
   *  e.g. the household is already past its retirement transition in the
   *  active projection. The page must say so explicitly rather than
   *  rendering an empty or zeroed-out view. */
  transitionYear: number | null;
  entries: AccountAnalysisEntry[];
  /** "Now" accounts with no matching projected row — carried forward
   *  unchanged in `entries` rather than defaulting to a zero balance, but
   *  named here so the page can flag them instead of presenting a
   *  same-as-now figure as if it were actually projected. */
  unmatchedAccountNames: string[];
  /** Accounts whose projected Roth basis rests on a basis entry older than
   *  the current year — the gap between that entry's year and now isn't
   *  modeled by the projection engine, so the projected total may
   *  understate real accessible basis. */
  staleBasisAccountNames: string[];
};

/** contributionBasis + every taxFree-bucket `contribution` from the basis
 *  row's own year through the transition year, inclusive. Deliberately NOT
 *  a hardcoded "year 0" or "year 1" — the basis row's year is whatever
 *  `selectCurrentRothBasisRow` last picked, which can be behind the
 *  current year. Deliberately excludes `employerMatch` — never Roth basis,
 *  regardless of which tax-type row it lands on. */
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

/** Brokerage cost basis + every dollar contributed from the current year
 *  (year 0 — a live "as of today" snapshot, unlike Roth's dated basis row)
 *  through the transition year, inclusive. Year 0's `contribution` is the
 *  *remaining* part of this year not yet contributed as of today, so
 *  including it (not skipping it) is what keeps this from undercounting —
 *  same reasoning as the Roth basis projection above. Every dollar that
 *  lands in a taxable brokerage account is after-tax money, so all of
 *  `contribution` (intentional + overflow + ramp alike) is real cost basis
 *  — there's no employer-match-style component to exclude here. */
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

/** Substitutes the retirement-transition year as the separation year for a
 *  still-active job (source "active") and re-evaluates Rule of 55 from
 *  there — the entire premise of this view. A job with a real, already-
 *  known future end date caps the assumed separation at that date instead
 *  of assuming employment runs all the way to the household transition.
 *  Any other source (already separated, or genuinely no data) is reused
 *  unchanged — the future can't move a real past separation, and can't
 *  manufacture data that doesn't exist. */
function projectRuleOf55(
  now: RuleOf55Status | null,
  transitionYear: number,
  birthYear: number,
): RuleOf55Status | null {
  if (!now || now.source !== "active") return now;
  const separationYear =
    now.knownFutureSeparationYear != null
      ? Math.min(now.knownFutureSeparationYear, transitionYear)
      : transitionYear;
  return {
    eligible: isRuleOf55Eligible(separationYear, birthYear),
    separationYear,
    source: now.source,
    knownFutureSeparationYear: now.knownFutureSeparationYear,
  };
}

export function computeTaxBucketProjection(input: {
  nowEntries: AccountAnalysisEntry[];
  projectionByYear: EngineYearProjection[];
  people: PersonInfo[];
}): TaxBucketProjectionResult {
  const { nowEntries, projectionByYear, people } = input;
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
  for (const yr of accumulationYears) {
    for (const bal of yr.individualAccountBalances) {
      if (!isTaxFreeBucket(bal.taxType) && !isAfterTaxType(bal.taxType))
        continue;
      const key = matchKey(
        bal.name,
        bal.category,
        bal.taxType,
        bal.ownerPersonId ?? null,
      );
      let yearMap = contributionsByKey.get(key);
      if (!yearMap) {
        yearMap = new Map();
        contributionsByKey.set(key, yearMap);
      }
      yearMap.set(yr.year, bal.contribution);
    }
  }

  const transitionBalanceByKey = new Map(
    transitionYearRow.individualAccountBalances.map((bal) => [
      matchKey(bal.name, bal.category, bal.taxType, bal.ownerPersonId ?? null),
      bal,
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
    const cfg = getAccountTypeConfig(now.category);
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
      // Joint account, no single owner — Roth/401k/Traditional-IRA rules
      // all need an age to project against and stay unattributed here.
      // Brokerage's Cost basis/Growth split needs no person at all, so it
      // isn't blocked by the same gap — project it the same way the owned
      // branch below does.
      let projectedCostBasis: number | null = now.costBasis;
      if (now.costBasis != null) {
        projectedCostBasis = projectCostBasis(
          now.costBasis,
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
    if (cfg.rothOrderingRules === "basis_first") {
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

    if (cfg.rothOrderingRules === "basis_first") {
      if (isTaxFreeBucket(now.taxType)) {
        const projectedContributionBasis = projectContributionBasis(
          now.rothBasisMeta,
          contributionsByKey.get(key),
          transitionYear,
        );
        rothBasisMeta = now.rothBasisMeta
          ? {
              ...now.rothBasisMeta,
              contributionBasis: projectedContributionBasis,
            }
          : null;
        slices = computeRothIraAccess({
          balance,
          currentAge: ageAtTransition,
          currentYear: transitionYear,
          contributionBasis: projectedContributionBasis,
          conversionBasis: now.rothBasisMeta?.conversionBasis ?? 0,
          latestConversionYear: now.rothBasisMeta?.latestConversionYear ?? null,
        });
      } else {
        slices = computeTraditionalIraAccess(balance, ageAtTransition);
      }
    } else if (cfg.rothOrderingRules === "pro_rata") {
      ruleOf55 = projectRuleOf55(
        now.ruleOf55,
        transitionYear,
        person!.birthYear,
      );
      const eligible = ruleOf55?.eligible ?? false;
      if (isTaxFreeBucket(now.taxType)) {
        const projectedContributionBasis = projectContributionBasis(
          now.rothBasisMeta,
          contributionsByKey.get(key),
          transitionYear,
        );
        rothBasisMeta = now.rothBasisMeta
          ? {
              ...now.rothBasisMeta,
              contributionBasis: projectedContributionBasis,
            }
          : null;
        const enteredBasis =
          projectedContributionBasis +
          (now.rothBasisMeta?.conversionBasis ?? 0);
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
      // Brokerage — every dollar contributed between now and the
      // transition is real cost basis (see projectCostBasis), so this
      // grows the same way Roth contribution basis does rather than
      // holding flat.
      costBasis = projectCostBasis(
        now.costBasis,
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
