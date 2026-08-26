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
  isHsaCategory,
  tracksCostBasis,
} from "@/lib/config/account-types";
import { PENALTY_FREE_AGE, HSA_NON_MEDICAL_PENALTY_AGE } from "@/lib/constants";
import type { TaxBucketBreakdown } from "@/lib/pure/tax-buckets";
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

/** The already-selected "current" row for one (account, owner) pair — see
 *  src/lib/pure/roth-basis-rollover.ts's buildCurrentRothBasisMap, which the
 *  router uses before calling into this module. */
export type RothBasisRow = {
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

export type RothBasisMeta = {
  year: number;
  contributionBasis: number;
  conversionBasis: number;
  latestConversionYear: number | null;
  isSeeded: boolean;
  /** `Date` when constructed server-side; arrives as an ISO `string` once
   *  serialized over the wire to the client (no superjson transformer on
   *  this tRPC setup) — same dual-shape `isoDateOnly()` in
   *  tax-buckets-content.tsx already handles. Neither this module nor
   *  tax-bucket-projection.ts reads this field, so the exact runtime shape
   *  never matters to them. */
  updatedAt: Date | string;
};

export type RuleOf55Status = {
  eligible: boolean | null; // null = unknown (no separation data)
  separationYear: number | null;
  source: SeparationSource;
  /** Only set when source is "active" (still employed, not yet separated):
   *  the earliest real (non-speculative) future endDate among this
   *  account's linked jobs, if one is on record. Used by the "at
   *  retirement" projection to cap an assumed retirement-transition
   *  separation at a job's own already-known planned end date, rather than
   *  assuming employment runs all the way to the household's retirement
   *  transition. Null when no linked job has a known future end date. */
  knownFutureSeparationYear: number | null;
};

/** A simple age-threshold status — unlike RuleOf55Status, there's no
 *  employer/separation concept involved, just "have they hit this age
 *  yet." Used for IRA (59½, the penalty-free-withdrawal age) and HSA (65,
 *  the non-medical-penalty age) — never for 401k/403b, which use
 *  RuleOf55Status instead since Rule of 55 can free those funds earlier. */
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
  /** Raw `performance_accounts.costBasis` for a Brokerage-category account
   *  (null otherwise). Carried as its own field — not re-derived by
   *  scanning `slices` for a "Cost basis"-labeled entry — so a UI label
   *  rename can never silently break the "at retirement" projection's
   *  carry-forward the way string-matching against a rendered label would. */
  costBasis: number | null;
  /** IRA (59½) or HSA (65) age-gate status — null for every other
   *  category (401k/403b use `ruleOf55` instead; Brokerage has no age
   *  gate at all). Also null when there's no resolvable owner/age. */
  ageThresholdStatus: AgeThresholdStatus | null;
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
    const cfg = getAccountTypeConfig(category);

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
      if (cfg.rothOrderingRules === "basis_first") {
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
      // Joint account, no single owner — Roth/401k/Traditional-IRA rules
      // all need an age to gate on and stay unattributed here (see
      // RULES.md-flagged v1 design note). Brokerage's Cost basis/Growth
      // split needs no person at all — computeBrokerageAccess only takes
      // balance + costBasis — so it isn't blocked by the same gap. HSA
      // (modeled as general spending, not medical) DOES need an age for
      // its 65 gate, so it stays unattributed here same as Roth/401k.
      if (costBasis != null) {
        slices = computeBrokerageAccess(entry.amount, costBasis);
      }
    } else if (cfg.rothOrderingRules === "basis_first") {
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
