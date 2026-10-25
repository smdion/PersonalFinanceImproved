/**
 * The engine's per-account starting list: every snapshot account (by
 * category, tax type and owner) with its basis, owner's birth year, early-
 * access eligibility (Rule of 55, Roth basis — from the Tax Buckets
 * analysis), the per-account penalty allowance (fail-closed on an
 * ambiguous match), and the unspent-RMD target; plus the projection-only
 * Retirement brokerage when there's none to receive that money.
 */
import type {
  AccountCategory,
  IndividualAccountInput,
} from "@/lib/calculators/types";
import {
  getAllCategories,
  isOverflowTarget,
  tracksCostBasis,
} from "@/lib/config/account-types";
import {
  PERF_CATEGORY_RETIREMENT,
  PROJECTED_RETIREMENT_BROKERAGE_LABEL,
} from "@/lib/config/display-labels";
import type { resolveRmdExcessTarget } from "@/lib/pure/rmd-excess-target";
import type { computeTaxBucketBreakdown } from "@/lib/pure/tax-buckets";
import {
  computeTaxBucketAnalysis,
  type RuleOf55Status,
  type RothBasisMeta,
} from "@/lib/pure/tax-bucket-analysis";
import { buildCurrentRothBasisMap } from "@/lib/pure/roth-basis-rollover";
import { toNumber } from "@/server/helpers";
import type { fetchRetirementData } from "../build-engine-payload";

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
  // Per-account withdrawal-ordering eligibility — reuses computeTaxBucketAnalysis
  // verbatim (RULES.md § Single Computation Path) rather than re-deriving Rule of 55 / Roth-ordering
  // resolution a third time. Keyed with the same indKey format the engine's
  // individual-account-tracking module uses, so Group 2's eligibility gate
  // can look a given `IndividualAccountInput` up directly. Retirement-only
  // (computeTaxBucketAnalysis walks `accountRollup`, which excludes
  // Portfolio-category holdings) — a Portfolio-category individualAccounts
  // entry simply has no match here, which is correct: early-access rules
  // don't apply to a taxable brokerage account.
  const jobsById = new Map(allJobs.map((j) => [j.id, j]));
  const jobLinks = jobLinkRows
    .filter(
      (l): l is { performanceAccountId: number; jobId: number } =>
        l.performanceAccountId != null && l.jobId != null,
    )
    .map((l) => {
      const job = jobsById.get(l.jobId);
      return {
        performanceAccountId: l.performanceAccountId,
        endDate: job?.endDate ? new Date(job.endDate) : null,
        isSpeculative: job?.isSpeculative ?? false,
      };
    });
  const currentRothBasisRows = Array.from(
    buildCurrentRothBasisMap(
      accountBasisRows.map((r) => ({
        id: r.id,
        performanceAccountId: r.performanceAccountId,
        ownerPersonId: r.ownerPersonId,
        year: r.year,
        contributionBasis: toNumber(r.contributionBasis),
        conversionBasis: toNumber(r.conversionBasis),
        latestConversionYear: r.latestConversionYear,
        isFinalized: r.isFinalized,
      })),
    ).values(),
  );
  const accountBasisById = new Map(accountBasisRows.map((r) => [r.id, r]));
  const accountAnalysis = computeTaxBucketAnalysis({
    breakdown: taxBucketBreakdown,
    performanceAccounts: perfAccounts.map((p) => ({
      id: p.id,
      accountType: p.accountType as AccountCategory,
      ownerPersonId: p.ownerPersonId,
      isActive: p.isActive,
      separationDate: p.separationDate ? new Date(p.separationDate) : null,
      costBasis: toNumber(p.costBasis),
      accountLabel: p.accountLabel,
      displayName: p.displayName,
      institution: p.institution,
    })),
    jobLinks,
    rothBasisRows: currentRothBasisRows.map((r) => {
      const raw = accountBasisById.get(r.id)!;
      return {
        performanceAccountId: r.performanceAccountId,
        ownerPersonId: r.ownerPersonId,
        year: r.year,
        contributionBasis: r.contributionBasis,
        conversionBasis: r.conversionBasis,
        latestConversionYear: r.latestConversionYear,
        isSeeded: raw.isSeeded,
        updatedAt: raw.updatedAt,
      };
    }),
    people: people.map((p) => ({
      id: p.id,
      name: p.name,
      birthYear: new Date(p.dateOfBirth).getFullYear(),
    })),
    currentDate: asOfDate,
  });
  // Local join key only — (name, category, taxType, ownerPersonId), same
  // tuple `accountRollup`/`accountBreakdownByCategory` already merge on.
  // Deliberately NOT the engine's own `makeIndKey()` format: that's an
  // engine-internal concern (`@/lib/calculators/engine/*` absolute imports
  // outside the barrel are a lint-enforced layering violation —
  // tests/lint/violations.test.ts), and this data attaches directly onto
  // each `individualAccounts` entry below rather than traveling as a
  // separately-keyed side-map, so no shared key format is needed at all.
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
  // Per-account penalty-allowance override — account-level, not
  // person-level, so (unlike ruleOf55/rothBasisMeta above) joint accounts
  // are included, not skipped. Only ever records `true`: same omit-when-
  // false cache-hash-stability convention as `ruleOf55ForceIneligible`.
  const allowPenalizedByPerfAccountId = new Map(
    perfAccounts.map((p) => [p.id, p.allowPenalizedWithdrawals]),
  );
  // The join key (name/category/taxType/owner) is NOT guaranteed unique —
  // `performanceAccounts`' own unique index is on
  // (institution, accountType, subType, label, ownerPersonId), a different
  // tuple. Two distinct real accounts can collide onto the same join key
  // (e.g. same display name, different institution). Fail CLOSED on that
  // ambiguity: never allow the penalty on a join key that maps to more than
  // one distinct performanceAccountId, even if one of the colliding
  // accounts has the override set — this flag only ever authorizes a real
  // tax penalty, so an ambiguous match must default to "not allowed", never
  // silently apply to an account the user never touched.
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
    ...Object.entries(accountBreakdownByCategory).flatMap(([cat, accts]) =>
      accts.map((a) => {
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
