/**
 * The engine's per-account starting list (category, tax type, owner, basis, early-access
 * eligibility, penalty allowance, unspent-RMD target). The engine declares the
 * projection-only Retirement brokerage itself (`declareOpeningParts`).
 */
import { calendarYear } from "@/lib/utils/date";
import type { AccountCategory } from "@/lib/config/account-types";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import { tracksCostBasis } from "@/lib/config/account-types";
import { accountIdKeyOf, entryKeyOf } from "@/lib/pure/accounts/account-part";
import type { resolveRmdExcessTarget } from "@/lib/pure/retirement/rmd-excess-target";
import type { computeTaxBucketBreakdown } from "@/lib/pure/accounts/tax-buckets/tax-buckets";
import { computeTaxBucketAnalysis } from "@/lib/pure/accounts/tax-buckets/tax-bucket-analysis";
import type {
  RuleOf55Status,
  RothBasisMeta,
} from "@/lib/pure/accounts/account-balances.types";
import { earlyAccessInputs } from "@/server/services/tax/early-access-inputs";
import type { RetirementData } from "./load";

export function buildIndividualAccounts({
  allJobs,
  jobLinkRows,
  accountBasisRows,
  perfAccounts,
  people,
  asOfDate,
  taxBucketBreakdown,
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
  /** Each person's planned retirement year (birth year + retirement age). */
  retirementYearByPersonId?: ReadonlyMap<number, number>;
  ruleOf55OverrideByPerson: ReadonlyMap<number, boolean | null | undefined>;
  rmdTarget: ReturnType<typeof resolveRmdExcessTarget>;
}): IndividualAccountInput[] {
  const { accountBreakdownByCategory } = taxBucketBreakdown;
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
  // Joined on the part's key (`entryKeyOf`), the one the engine keys it by.
  const eligibilityByKey = new Map<
    string,
    { ruleOf55: RuleOf55Status | null; rothBasisMeta: RothBasisMeta | null }
  >();
  for (const entry of accountAnalysis) {
    if (entry.ownerPersonId == null) continue; // joint — no per-owner data to join
    eligibilityByKey.set(entryKeyOf(entry), {
      ruleOf55: entry.ruleOf55,
      rothBasisMeta: entry.rothBasisMeta,
    });
  }
  // Per-account penalty allowance: account-level, so joint accounts are
  // included. Records only `true` (omit-when-false, for cache-hash stability).
  const allowPenalizedByPerfAccountId = new Map(
    perfAccounts.map((p) => [p.id, p.allowPenalizedWithdrawals]),
  );
  const allowPenalizedByKey = new Map<string, true>();
  for (const entry of accountAnalysis) {
    if (entry.performanceAccountId == null) continue;
    if (!allowPenalizedByPerfAccountId.get(entry.performanceAccountId))
      continue;
    allowPenalizedByKey.set(entryKeyOf(entry), true);
  }
  return Object.entries(accountBreakdownByCategory).flatMap(([cat, accounts]) =>
    accounts.map((a) => {
      const ids = accountIds(a);
      const key = accountIdKeyOf({ ...a, category: cat, ...ids });
      const eligibility = a.ownerPersonId
        ? eligibilityByKey.get(key)
        : undefined;
      return {
        name: a.name,
        ...ids,
        category: cat as AccountCategory,
        taxType: a.taxType,
        accountType: a.accountType,
        startingBalance: a.amount,
        ...(a.costBasis != null ? { startingBasis: a.costBasis } : {}),
        ownerName: a.ownerName,
        ownerPersonId: a.ownerPersonId,
        parentCategory: a.parentCategory,
        ...eligibility,
        ownerRetirementYear:
          a.ownerPersonId != null
            ? retirementYearByPersonId?.get(a.ownerPersonId)
            : undefined,
        ruleOf55ForceIneligible:
          a.ownerPersonId != null &&
          ruleOf55OverrideByPerson.get(a.ownerPersonId) === false
            ? true
            : undefined,
        allowPenalizedWithdrawals: allowPenalizedByKey.get(key),
        ...(rmdTarget.targetPerformanceAccountId != null &&
        tracksCostBasis(cat) &&
        a.performanceAccountIds?.includes(rmdTarget.targetPerformanceAccountId)
          ? { rmdExcessTarget: true }
          : {}),
      };
    }),
  );
}

/** A part's performance account, when it has exactly one; else its first
 *  snapshot row, which names it for this run. */
function accountIds(entry: {
  performanceAccountIds?: number[];
  portfolioAccountIds: number[];
}): Pick<
  IndividualAccountInput,
  "performanceAccountId" | "portfolioAccountId"
> {
  const ids = entry.performanceAccountIds;
  const performanceAccountId = ids?.length === 1 ? ids[0] : undefined;
  return performanceAccountId != null
    ? { performanceAccountId }
    : { portfolioAccountId: entry.portfolioAccountIds[0] };
}
