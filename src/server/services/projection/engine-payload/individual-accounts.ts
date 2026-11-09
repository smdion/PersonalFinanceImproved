/**
 * The engine's per-account starting list (category, tax type, owner, basis, birth year, early-
 * access eligibility, penalty allowance, unspent-RMD target), plus the projection-only
 * Retirement brokerage when there's none to receive that money.
 */
import { calendarYear } from "@/lib/utils/date";
import type { AccountCategory } from "@/lib/config/account-types";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import {
  getAllCategories,
  isOverflowTarget,
  tracksCostBasis,
} from "@/lib/config/account-types";
import {
  PERF_CATEGORY_RETIREMENT,
  PROJECTED_RETIREMENT_BROKERAGE_LABEL,
} from "@/lib/config/display-labels";
import type { resolveRmdExcessTarget } from "@/lib/pure/retirement/rmd-excess-target";
import type { computeTaxBucketBreakdown } from "@/lib/pure/accounts/tax-buckets";
import { computeTaxBucketAnalysis } from "@/lib/pure/accounts/tax-bucket-analysis";
import type {
  RuleOf55Status,
  RothBasisMeta,
} from "@/lib/pure/accounts/account-balances.types";
import { earlyAccessInputs } from "@/server/services/tax/early-access-inputs";
import type { fetchRetirementData } from "./load";

type RetirementData = Awaited<ReturnType<typeof fetchRetirementData>>;

export function buildIndividualAccounts({
  allJobs,
  jobLinkRows,
  accountBasisRows,
  perfAccounts,
  people,
  asOfDate,
  taxBucketBreakdown,
  birthYearByPersonId,
  retirementYearByPersonId,
  ruleOf55OverrideByPerson,
  rmdTarget,
}: {
  allJobs: RetirementData["allJobs"];
  jobLinkRows: RetirementData["jobLinkRows"];
  accountBasisRows: RetirementData["accountBasisRows"];
  perfAccounts: RetirementData["perfAccounts"];
  people: readonly { id: number; name: string; dateOfBirth: string }[];
  asOfDate: Date;
  taxBucketBreakdown: ReturnType<typeof computeTaxBucketBreakdown>;
  birthYearByPersonId: ReadonlyMap<number, number>;
  /** Each person's planned retirement year (birth year + retirement age). */
  retirementYearByPersonId?: ReadonlyMap<number, number>;
  ruleOf55OverrideByPerson: ReadonlyMap<number, boolean | null | undefined>;
  rmdTarget: ReturnType<typeof resolveRmdExcessTarget>;
}): IndividualAccountInput[] {
  const { accountBreakdownByCategory } = taxBucketBreakdown;
  const OVERFLOW_TARGET_CATEGORY = getAllCategories().find(isOverflowTarget)!;
  // Per-account early-access eligibility from computeTaxBucketAnalysis (RULES §
  // Single Computation Path). Retirement accounts only: a Portfolio account has
  // no entry, since early-access rules don't apply to a taxable account.
  const accountAnalysis = computeTaxBucketAnalysis({
    breakdown: taxBucketBreakdown,
    ...earlyAccessInputs({
      jobs: allJobs,
      jobLinkRows,
      accountBasisRows,
      perfAccounts,
    }),
    people: people.map((p) => ({
      id: p.id,
      name: p.name,
      birthYear: calendarYear(p.dateOfBirth),
    })),
    currentDate: asOfDate,
  });
  // Local join key (name, category, taxType, ownerPersonId), the tuple
  // `accountRollup` merges on; not the engine's `makeIndKey()`, since this data
  // attaches directly onto each `individualAccounts` entry below.
  function eligibilityJoinKey(
    name: string,
    category: string,
    taxType: string,
    ownerPersonId: number | null,
  ): string {
    return `${name}|${category}|${taxType}|${ownerPersonId ?? "null"}`;
  }
  const eligibilityByJoinKey = new Map<
    string,
    { ruleOf55: RuleOf55Status | null; rothBasisMeta: RothBasisMeta | null }
  >();
  for (const entry of accountAnalysis) {
    if (entry.ownerPersonId == null) continue; // joint — no per-owner data to join
    eligibilityByJoinKey.set(
      eligibilityJoinKey(
        entry.displayName,
        entry.category,
        entry.taxType,
        entry.ownerPersonId,
      ),
      { ruleOf55: entry.ruleOf55, rothBasisMeta: entry.rothBasisMeta },
    );
  }
  // Per-account penalty allowance: account-level, so joint accounts are
  // included. Records only `true` (omit-when-false, for cache-hash stability).
  const allowPenalizedByPerfAccountId = new Map(
    perfAccounts.map((p) => [p.id, p.allowPenalizedWithdrawals]),
  );
  // The join key isn't unique (performanceAccounts is unique on another tuple),
  // so fail CLOSED: a key mapping to more than one performanceAccountId never
  // allows the penalty, since the flag authorizes a real tax penalty.
  const perfAccountIdsByJoinKey = new Map<string, Set<number>>();
  for (const entry of accountAnalysis) {
    if (entry.performanceAccountId == null) continue;
    const key = eligibilityJoinKey(
      entry.displayName,
      entry.category,
      entry.taxType,
      entry.ownerPersonId,
    );
    const ids = perfAccountIdsByJoinKey.get(key) ?? new Set<number>();
    ids.add(entry.performanceAccountId);
    perfAccountIdsByJoinKey.set(key, ids);
  }
  const allowPenalizedByJoinKey = new Map<string, true>();
  for (const entry of accountAnalysis) {
    if (entry.performanceAccountId == null) continue;
    const key = eligibilityJoinKey(
      entry.displayName,
      entry.category,
      entry.taxType,
      entry.ownerPersonId,
    );
    const ids = perfAccountIdsByJoinKey.get(key);
    if (!ids || ids.size > 1) continue; // ambiguous join key — fail closed
    if (!allowPenalizedByPerfAccountId.get(entry.performanceAccountId))
      continue;
    allowPenalizedByJoinKey.set(key, true);
  }
  return [
    ...Object.entries(accountBreakdownByCategory).flatMap(([cat, accounts]) =>
      accounts.map((a) => {
        const eligibility = a.ownerPersonId
          ? eligibilityByJoinKey.get(
              eligibilityJoinKey(a.name, cat, a.taxType, a.ownerPersonId),
            )
          : undefined;
        return {
          name: a.name,
          category: cat as AccountCategory,
          taxType: a.taxType,
          accountType: a.accountType,
          startingBalance: a.amount,
          ...(a.costBasis != null ? { startingBasis: a.costBasis } : {}),
          ownerName: a.ownerName,
          ownerPersonId: a.ownerPersonId,
          parentCategory: a.parentCategory,
          ruleOf55: eligibility?.ruleOf55,
          rothBasisMeta: eligibility?.rothBasisMeta,
          ownerBirthYear:
            a.ownerPersonId != null
              ? birthYearByPersonId.get(a.ownerPersonId)
              : undefined,
          ownerRetirementYear:
            a.ownerPersonId != null
              ? retirementYearByPersonId?.get(a.ownerPersonId)
              : undefined,
          ruleOf55ForceIneligible:
            a.ownerPersonId != null &&
            ruleOf55OverrideByPerson.get(a.ownerPersonId) === false
              ? true
              : undefined,
          allowPenalizedWithdrawals: allowPenalizedByJoinKey.get(
            eligibilityJoinKey(a.name, cat, a.taxType, a.ownerPersonId ?? null),
          ),
          ...(rmdTarget.targetPerformanceAccountId != null &&
          tracksCostBasis(cat) &&
          a.performanceAccountIds?.includes(
            rmdTarget.targetPerformanceAccountId,
          )
            ? { rmdExcessTarget: true }
            : {}),
        };
      }),
    ),
    ...(rmdTarget.addProjectedBrokerage
      ? [
          {
            name: PROJECTED_RETIREMENT_BROKERAGE_LABEL,
            category: OVERFLOW_TARGET_CATEGORY,
            taxType: "afterTax",
            startingBalance: 0,
            startingBasis: 0,
            parentCategory: PERF_CATEGORY_RETIREMENT,
            projectedOnly: true,
          },
        ]
      : []),
  ];
}
