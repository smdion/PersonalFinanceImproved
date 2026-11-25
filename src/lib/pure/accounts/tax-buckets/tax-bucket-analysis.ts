/**
 * The Tax Buckets page's per-account view: tax-bucket extraction plus rothBasis rows and
 * early access (Rule of 55 / Roth ordering).
 */
import type { AccountCategory } from "@/lib/config/account-types";
import type { StoredAccountType } from "@/lib/config/account-types.types";
import {
  isTaxFreeBucket,
  earlyAccessRuleOf,
  tracksCostBasis,
} from "@/lib/config/account-types";
import { ageInYear } from "@/lib/utils/date";
import type { TaxBucketBreakdown } from "@/lib/pure/accounts/tax-buckets/tax-buckets";
import {
  resolveSeparationYear,
  isRuleOf55Eligible,
  computeBrokerageAccess,
  accountAccessSlices,
  ageThresholdStatusOf,
  type AgeThresholdStatus,
  type EarlyAccessSlice,
} from "@/lib/pure/accounts/early-access";
import type {
  RothBasisMeta,
  RuleOf55Status,
} from "@/lib/pure/accounts/account-balances.types";

export type PersonInfo = { id: number; name: string; birthYear: number };

type PerformanceAccountInfo = {
  id: number;
  accountType: StoredAccountType;
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

export type AccountAnalysisEntry = {
  performanceAccountId: number | null;
  /** The snapshot rows the entry holds (`portfolio_accounts.id`). */
  portfolioAccountIds: number[];
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
  /** IRA (59½) or HSA (the year after 65) age-gate status — null for every other
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

  // Rule of 55 per (performanceAccountId, ownerPersonId): an account's preTax and
  // taxFree slices share one resolution (it frees the whole plan, not a part).
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

    // No performance account: no costBasis or separationDate, whoever owns it.
    if (!perfAccount) {
      return {
        performanceAccountId: entry.performanceAccountId,
        portfolioAccountIds: entry.portfolioAccountIds,
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
    let ageThresholdStatus: AgeThresholdStatus | null = null;
    const rule = earlyAccessRuleOf(category);

    if (entry.ownerPersonId == null) {
      // Joint account, no single owner: age-gated rules (Roth, 401k, IRA, HSA)
      // stay unattributed; the brokerage basis/growth split needs no person.
      if (costBasis != null) {
        slices = computeBrokerageAccess(entry.amount, costBasis);
      }
    } else {
      ageThresholdStatus = ageThresholdStatusOf(rule, currentAge);
      // An employer plan's preTax and taxFree parts share one resolution.
      if (rule === "employer_plan") {
        ruleOf55 = resolveRuleOf55(perfAccount.id, entry.ownerPersonId);
      }
      slices = accountAccessSlices(
        rule,
        {
          balance: entry.amount,
          currentAge,
          currentYear,
          isRoth: isTaxFreeBucket(entry.taxType),
          ruleOf55Met: ruleOf55?.eligible ?? false,
          contributionBasis: rothBasis?.contributionBasis ?? 0,
          conversionBasis: rothBasis?.conversionBasis ?? 0,
          latestConversionYear: rothBasis?.latestConversionYear ?? null,
        },
        costBasis,
      );
    }

    return {
      performanceAccountId: entry.performanceAccountId,
      portfolioAccountIds: entry.portfolioAccountIds,
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
