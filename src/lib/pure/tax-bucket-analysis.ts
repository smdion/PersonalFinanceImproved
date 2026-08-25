/**
 * Combines the shared tax-bucket extraction (src/lib/pure/tax-buckets.ts)
 * with rothBasis rows and the early-access helper (Rule of 55 / Roth
 * ordering rules) into the per-account view the Tax Buckets analysis page
 * needs. Kept as its own pure function — not inline in the router handler —
 * per RULES.md's Pure Business Logic Boundary.
 */
import type { AccountCategory } from "@/lib/calculators/types";
import {
  getAccountTypeConfig,
  isTaxFreeBucket,
  tracksCostBasis,
} from "@/lib/config/account-types";
import type { TaxBucketBreakdown } from "@/lib/pure/tax-buckets";
import {
  resolveSeparationYear,
  isRuleOf55Eligible,
  computeBrokerageAccess,
  computeTraditionalIraAccess,
  computeEmployerPlanPreTaxAccess,
  computeEmployerPlanRothAccess,
  computeRothIraAccess,
  type EarlyAccessSlice,
  type SeparationSource,
} from "@/lib/pure/early-access";

export type PersonInfo = { id: number; name: string; birthYear: number };

export type PerformanceAccountInfo = {
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
export type JobLinkInfo = {
  performanceAccountId: number;
  endDate: Date | null;
  isSpeculative: boolean;
};

export type RothBasisRow = {
  performanceAccountId: number;
  ownerPersonId: number;
  contributionBasis: number;
  conversionBasis: number;
  latestConversionYear: number | null;
  asOfDate: Date;
};

export type RuleOf55Status = {
  eligible: boolean | null; // null = unknown (no separation data)
  separationYear: number | null;
  source: SeparationSource;
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
  rothBasisAsOfDate: Date | null;
};

function ageInYear(birthYear: number, year: number): number {
  return year - birthYear;
}

export function computeTaxBucketAnalysis(input: {
  breakdown: TaxBucketBreakdown;
  performanceAccounts: PerformanceAccountInfo[];
  jobLinks: JobLinkInfo[];
  rothBasisRows: RothBasisRow[];
  people: PersonInfo[];
  targetRetirementAgeByPerson: Record<number, number>;
  currentDate: Date;
}): AccountAnalysisEntry[] {
  const {
    breakdown,
    performanceAccounts,
    jobLinks,
    rothBasisRows,
    people,
    targetRetirementAgeByPerson,
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
    const targetAge = targetRetirementAgeByPerson[ownerPersonId] ?? 65;
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
          targetRetirementAge: targetAge,
          birthYear: person.birthYear,
        })
      : { year: null, source: "unknown" as const };

    const status: RuleOf55Status = {
      eligible:
        resolution.year != null && person
          ? isRuleOf55Eligible(resolution.year, person.birthYear)
          : null,
      separationYear: resolution.year,
      source: resolution.source,
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
    const displayName =
      perfAccount?.displayName ?? perfAccount?.accountLabel ?? "Account";
    const category = entry.category as AccountCategory;
    const cfg = getAccountTypeConfig(category);

    // Joint (null ownerPersonId) accounts get no per-person early-access
    // computation — no age to compute Rule of 55 or a 59½ gate against.
    if (entry.ownerPersonId == null || !perfAccount) {
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
        rothBasisAsOfDate: null,
      };
    }

    const person = peopleById.get(entry.ownerPersonId);
    const currentAge = person ? ageInYear(person.birthYear, currentYear) : 0;
    const rothBasis = rothBasisByKey.get(
      `${entry.performanceAccountId}|${entry.ownerPersonId}`,
    );

    let slices: EarlyAccessSlice[] = [];
    let ruleOf55: RuleOf55Status | null = null;

    if (cfg.rothOrderingRules === "basis_first") {
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
      cfg.rothOrderingRules === "pro_rata" &&
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
    } else if (tracksCostBasis(category)) {
      // Brokerage — the only other category with a basis concept.
      slices = computeBrokerageAccess(entry.amount, perfAccount.costBasis);
    }
    // Else: hsa (rothOrderingRules null, doesn't track cost basis) — v1
    // shows a static note only, no per-bucket boolean (no medical-spend
    // tracking to key off), so slices stays [].

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
      rothBasisAsOfDate: rothBasis?.asOfDate ?? null,
    };
  });
}
