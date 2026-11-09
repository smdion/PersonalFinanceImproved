/**
 * The Tax Buckets page's per-account view: tax-bucket extraction plus rothBasis rows and
 * early access (Rule of 55 / Roth ordering).
 */
import type { AccountCategory } from "@/lib/config/account-types";
import {
  isTaxFreeBucket,
  isHsaCategory,
  isIraCategory,
  isRuleOf55EligibleCategory,
  tracksCostBasis,
} from "@/lib/config/account-types";
import { PENALTY_FREE_AGE, HSA_NON_MEDICAL_PENALTY_AGE } from "@/lib/constants";
import { ageInYear } from "@/lib/utils/date";
import type { TaxBucketBreakdown } from "@/lib/pure/accounts/tax-buckets";
import {
  resolveSeparationYear,
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
  RothBasisMeta,
  RuleOf55Status,
} from "@/lib/pure/accounts/account-balances.types";

export type PersonInfo = { id: number; name: string; birthYear: number };

type PerformanceAccountInfo = {
  id: number;
  accountType: AccountCategory;
  ownerPersonId: number | null;
  isActive: boolean;
  separationDate: Date | null;
  costBasis: number;
  accountLabel: string;
  displayName: string | null;
  institution: string;
};

/** A job funding a performanceAccountId, via contributionAccounts. */
type JobLinkInfo = {
  performanceAccountId: number;
  endDate: Date | null;
  isSpeculative: boolean;
};

/** The already-selected "current" row for one (account, owner) pair — see
 *  src/lib/pure/accounts/roth-basis-rollover.ts's buildCurrentRothBasisMap, which the
 *  router uses before calling into this module. */
type RothBasisRow = {
  performanceAccountId: number;
  ownerPersonId: number;
  year: number;
  contributionBasis: number;
  conversionBasis: number;
  latestConversionYear: number | null;
  /** True if this row was auto-seeded at year-end rollover and never
   *  reviewed/confirmed by the user for its own year. */
  isSeeded: boolean;
  updatedAt: Date;
};

/** Plain age-threshold status (no separation concept): IRA at 59½, HSA at 65.
 *  401k/403b use RuleOf55Status instead. */
export type AgeThresholdStatus = {
  thresholdAge: number;
  eligible: boolean;
};

export type AccountAnalysisEntry = {
  performanceAccountId: number | null;
  ownerPersonId: number | null;
  ownerName: string | null;
  category: AccountCategory;
  taxType: string;
  displayName: string;
  balance: number;
  /** Empty when no early-access computation applies (joint accounts, HSA,
   *  or a category/taxType combination v1 doesn't model per-slice). */
  slices: EarlyAccessSlice[];
  /** Only present for 401k/403b accounts. */
  ruleOf55: RuleOf55Status | null;
  rothBasisMeta: RothBasisMeta | null;
  /** Raw `performance_accounts.costBasis` for a Brokerage account (else null), its own
   *  field so the projection never string-matches a slice label. */
  costBasis: number | null;
  /** IRA (59½) or HSA (65) age-gate status — null for every other
   *  category (401k/403b use `ruleOf55` instead; Brokerage has no age
   *  gate at all). Also null when there's no resolvable owner/age. */
  ageThresholdStatus: AgeThresholdStatus | null;
};

export function computeTaxBucketAnalysis(input: {
  breakdown: TaxBucketBreakdown;
  performanceAccounts: PerformanceAccountInfo[];
  jobLinks: JobLinkInfo[];
  rothBasisRows: RothBasisRow[];
  people: PersonInfo[];
  currentDate: Date;
}): AccountAnalysisEntry[] {
  const {
    breakdown,
    performanceAccounts,
    jobLinks,
    rothBasisRows,
    people,
    currentDate,
  } = input;

  const currentYear = currentDate.getFullYear();
  const perfAccountById = new Map(performanceAccounts.map((p) => [p.id, p]));
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const rothBasisByKey = new Map(
    rothBasisRows.map((r) => [
      `${r.performanceAccountId}|${r.ownerPersonId}`,
      r,
    ]),
  );
  const jobLinksByAccount = new Map<number, JobLinkInfo[]>();
  for (const link of jobLinks) {
    const arr = jobLinksByAccount.get(link.performanceAccountId) ?? [];
    arr.push(link);
    jobLinksByAccount.set(link.performanceAccountId, arr);
  }

  // Cache Rule-of-55 resolution per (performanceAccountId, ownerPersonId) —
  // both the preTax and taxFree slices of one account share the exact same
  // resolution (Rule of 55 frees the whole plan, not just part of it).
  const ruleOf55Cache = new Map<string, RuleOf55Status>();
  function resolveRuleOf55(
    performanceAccountId: number,
    ownerPersonId: number,
  ): RuleOf55Status {
    const cacheKey = `${performanceAccountId}|${ownerPersonId}`;
    const cached = ruleOf55Cache.get(cacheKey);
    if (cached) return cached;

    const perfAccount = perfAccountById.get(performanceAccountId);
    const person = peopleById.get(ownerPersonId);
    // getUTCFullYear() — separationDate is a date-only column; see the same
    // note in early-access.ts's resolveSeparationYear.
    const explicitYear = perfAccount?.separationDate
      ? perfAccount.separationDate.getUTCFullYear()
      : null;
    const linkedJobs = (jobLinksByAccount.get(performanceAccountId) ?? []).map(
      (j) => ({ endDate: j.endDate, isSpeculative: j.isSpeculative }),
    );

    const resolution = person
      ? resolveSeparationYear({
          explicitSeparationYear: explicitYear,
          linkedJobs,
          currentDate,
        })
      : { year: null, source: "no_data" as const };

    const knownFutureSeparationYear =
      resolution.source === "active"
        ? linkedJobs
            .filter(
              (j) =>
                !j.isSpeculative &&
                j.endDate != null &&
                j.endDate > currentDate,
            )
            .map((j) => j.endDate!.getUTCFullYear())
            .reduce(
              (min, y) => (min == null || y < min ? y : min),
              null as number | null,
            )
        : null;

    const status: RuleOf55Status = {
      eligible:
        resolution.year != null && person
          ? isRuleOf55Eligible(resolution.year, person.birthYear)
          : resolution.source === "active"
            ? false // known: still employed there, hasn't separated yet
            : null, // genuinely unknown — no data to resolve either way
      separationYear: resolution.year,
      source: resolution.source,
      knownFutureSeparationYear,
    };
    ruleOf55Cache.set(cacheKey, status);
    return status;
  }

  return breakdown.accountRollup.map((entry): AccountAnalysisEntry => {
    const perfAccount =
      entry.performanceAccountId != null
        ? perfAccountById.get(entry.performanceAccountId)
        : undefined;
    const ownerName =
      entry.ownerPersonId != null
        ? (peopleById.get(entry.ownerPersonId)?.name ?? null)
        : null;
    const displayName = entry.name;
    const category = entry.category as AccountCategory;

    // No matching performance account at all — nothing to compute against
    // (no costBasis, no separationDate), regardless of ownership.
    if (!perfAccount) {
      return {
        performanceAccountId: entry.performanceAccountId,
        ownerPersonId: null,
        ownerName: null,
        category,
        taxType: entry.taxType,
        displayName,
        balance: entry.amount,
        slices: [],
        ruleOf55: null,
        rothBasisMeta: null,
        costBasis: null,
        ageThresholdStatus: null,
      };
    }

    const costBasis = tracksCostBasis(category) ? perfAccount.costBasis : null;
    const person =
      entry.ownerPersonId != null
        ? peopleById.get(entry.ownerPersonId)
        : undefined;
    const currentAge = person ? ageInYear(person.birthYear, currentYear) : 0;
    const rothBasis =
      entry.ownerPersonId != null
        ? rothBasisByKey.get(
            `${entry.performanceAccountId}|${entry.ownerPersonId}`,
          )
        : undefined;

    let slices: EarlyAccessSlice[] = [];
    let ruleOf55: RuleOf55Status | null = null;
    // 59½ (IRA) / 65 (HSA) age-gate — independent of the slices branch
    // below, since it applies even to HSA (which computes no slices at
    // all in v1) and doesn't change based on taxType the way slices do.
    let ageThresholdStatus: AgeThresholdStatus | null = null;
    if (entry.ownerPersonId != null) {
      if (isIraCategory(category)) {
        ageThresholdStatus = {
          thresholdAge: PENALTY_FREE_AGE,
          eligible: currentAge >= PENALTY_FREE_AGE,
        };
      } else if (isHsaCategory(category)) {
        ageThresholdStatus = {
          thresholdAge: HSA_NON_MEDICAL_PENALTY_AGE,
          eligible: currentAge >= HSA_NON_MEDICAL_PENALTY_AGE,
        };
      }
    }

    if (entry.ownerPersonId == null) {
      // Joint account, no single owner: age-gated rules (Roth, 401k, IRA, HSA)
      // stay unattributed; the brokerage basis/growth split needs no person.
      if (costBasis != null) {
        slices = computeBrokerageAccess(entry.amount, costBasis);
      }
    } else if (isIraCategory(category)) {
      // Roth IRA
      if (isTaxFreeBucket(entry.taxType)) {
        slices = computeRothIraAccess({
          balance: entry.amount,
          currentAge,
          currentYear,
          contributionBasis: rothBasis?.contributionBasis ?? 0,
          conversionBasis: rothBasis?.conversionBasis ?? 0,
          latestConversionYear: rothBasis?.latestConversionYear ?? null,
        });
      } else {
        // Traditional IRA
        slices = computeTraditionalIraAccess(entry.amount, currentAge);
      }
    } else if (
      isRuleOf55EligibleCategory(category) &&
      entry.performanceAccountId != null
    ) {
      // 401k/403b — preTax and taxFree slices share one Rule-of-55 resolution.
      ruleOf55 = resolveRuleOf55(
        entry.performanceAccountId,
        entry.ownerPersonId,
      );
      const eligible = ruleOf55.eligible ?? false;
      if (isTaxFreeBucket(entry.taxType)) {
        const enteredBasis =
          (rothBasis?.contributionBasis ?? 0) +
          (rothBasis?.conversionBasis ?? 0);
        slices = computeEmployerPlanRothAccess(
          entry.amount,
          currentAge,
          eligible,
          enteredBasis,
        );
      } else {
        slices = computeEmployerPlanPreTaxAccess(
          entry.amount,
          currentAge,
          eligible,
        );
      }
    } else if (costBasis != null) {
      // Brokerage — the only other category with a basis concept.
      slices = computeBrokerageAccess(entry.amount, costBasis);
    } else if (isHsaCategory(category)) {
      slices = computeHsaAccess(entry.amount, currentAge);
    }

    return {
      performanceAccountId: entry.performanceAccountId,
      ownerPersonId: entry.ownerPersonId,
      ownerName,
      category,
      taxType: entry.taxType,
      displayName,
      balance: entry.amount,
      slices,
      ruleOf55,
      rothBasisMeta: rothBasis
        ? {
            year: rothBasis.year,
            contributionBasis: rothBasis.contributionBasis,
            conversionBasis: rothBasis.conversionBasis,
            latestConversionYear: rothBasis.latestConversionYear,
            isSeeded: rothBasis.isSeeded,
            updatedAt: rothBasis.updatedAt,
          }
        : null,
      costBasis,
      ageThresholdStatus,
    };
  });
}
