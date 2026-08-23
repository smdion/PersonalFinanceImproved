/**
 * Zod validation schemas for all JSONB columns in the database.
 *
 * These schemas enforce structure before insert/update so that arbitrary
 * data never reaches the JSONB columns.  Each schema mirrors the
 * TypeScript type declared in schema.ts for the same column.
 *
 * Usage: import the schema you need and call `.parse(data)` (throws) or
 * `.safeParse(data)` before writing to the database.
 */

import { z } from "zod/v4";
import {
  w4FilingStatusSchema,
  payPeriodSchema,
  payWeekSchema,
  zDecimal,
} from "@/lib/config/enum-values";

// ── Primitives & re-usable fragments ────────────────────────────

/**
 * Generic "setting value" — the loosest shape we allow for appSettings.value
 * and scenario override leaf values.
 */
export const settingValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

// ── budget_profiles ─────────────────────────────────────────────

/** budget_profiles.column_labels — non-empty array of non-empty strings */
export const columnLabelsSchema = z.array(z.string().min(1)).min(1);

/** budget_profiles.column_months — per-column month counts (nullable) */
export const columnMonthsSchema = z.array(z.number().min(0)).nullable();

/** budget_profiles.column_contribution_profile_ids — per-column profile refs (nullable) */
export const columnContributionProfileIdsSchema = z
  .array(z.number().int().nullable())
  .nullable();

/** budget_profiles.column_salary_profile_ids — per-column profile refs (nullable) */
export const columnSalaryProfileIdsSchema = z
  .array(z.number().int().nullable())
  .nullable();

// ── budget_items ────────────────────────────────────────────────

/** budget_items.amounts — per-column dollar amounts */
export const budgetAmountsSchema = z.array(z.number());

// ── tax_brackets ────────────────────────────────────────────────

/** Single entry inside tax_brackets.brackets */
export const taxBracketEntrySchema = z.object({
  threshold: z.number(),
  baseWithholding: z.number(),
  rate: z.number(),
});

/** tax_brackets.brackets — ordered list of bracket entries */
export const taxBracketsSchema = z.array(taxBracketEntrySchema);

// ── ltcg_brackets ───────────────────────────────────────────────

/** Single entry inside ltcg_brackets.brackets */
export const ltcgBracketEntrySchema = z.object({
  threshold: z.number().nullable(), // null = Infinity (top bracket)
  rate: z.number(),
});

/** ltcg_brackets.brackets — ordered list of LTCG bracket entries */
export const ltcgBracketsSchema = z.array(ltcgBracketEntrySchema);

// ── irmaa_brackets ──────────────────────────────────────────────

/** Single entry inside irmaa_brackets.brackets */
export const irmaaBracketEntrySchema = z.object({
  magiThreshold: z.number(),
  annualSurcharge: z.number(),
});

/** irmaa_brackets.brackets — ordered list of IRMAA bracket entries */
export const irmaaBracketsSchema = z.array(irmaaBracketEntrySchema);

// ── api_connections ─────────────────────────────────────────────

/** api_connections.config */
export const apiConfigSchema = z.record(z.string(), z.string().optional());

/** Single entry inside api_connections.account_mappings */
export const accountMappingSchema = z.object({
  localId: z.string().optional(),
  localName: z.string(),
  remoteAccountId: z.string(),
  syncDirection: z.enum(["pull", "push", "both"]),
  assetId: z.number().int().optional(),
  loanId: z.number().int().optional(),
  loanMapType: z.enum(["propertyValue", "loanBalance"]).optional(),
  performanceAccountId: z.number().int().optional(),
});

/** api_connections.account_mappings (nullable) */
export const accountMappingsSchema = z.array(accountMappingSchema).nullable();

/** api_connections.skipped_category_ids (nullable) */
export const skippedCategoryIdsSchema = z.array(z.string()).nullable();

// ── scenarios ───────────────────────────────────────────────────

/**
 * scenarios.overrides — nested map: { entityType: { recordId: { field: value } } }
 * Also used by contribution_profiles.contribution_active_fields.
 */
export const scenarioOverridesSchema = z.record(
  z.string(),
  z.record(z.string(), z.record(z.string(), settingValueSchema)),
);

// ── relocation_scenarios ────────────────────────────────────────

const yearAdjustmentSchema = z.object({
  year: z.number(),
  monthlyExpenses: z.number(),
  profileId: z.number().optional(),
  budgetColumn: z.number().optional(),
  notes: z.string().optional(),
});

const largePurchaseSchema = z.object({
  name: z.string(),
  purchasePrice: z.number(),
  downPaymentPercent: z.number().optional(),
  loanRate: z.number().optional(),
  loanTermYears: z.number().optional(),
  ongoingMonthlyCost: z.number().optional(),
  saleProceeds: z.number().optional(),
  purchaseYear: z.number(),
});

/** relocation_scenarios.params */
export const relocationScenarioParamsSchema = z.object({
  currentProfileId: z.number(),
  currentBudgetColumn: z.number(),
  currentExpenseOverride: z.number().nullable(),
  relocationProfileId: z.number(),
  relocationBudgetColumn: z.number(),
  relocationExpenseOverride: z.number().nullable(),
  yearAdjustments: z.array(yearAdjustmentSchema),
  largePurchases: z.array(largePurchaseSchema),
  currentContributionProfileId: z.number().nullable(),
  relocationContributionProfileId: z.number().nullable(),
  moveYear: z.number().nullable().optional().default(null),
});

// ── extra-paycheck routing (nested inside a salary entry) ───────

/** One split target inside an ExtraPaycheckRule/Override. */
const extraPaycheckSplitSchema = z.object({
  goalId: z.number().int(),
  pct: z.number(),
});

/** One date-ranged rule directing an extra paycheck to one or more goals. */
const extraPaycheckRuleSchema = z.object({
  from: z.string(),
  to: z.string().nullable(),
  splits: z.array(extraPaycheckSplitSchema),
  /** @deprecated legacy fallback — see ExtraPaycheckRule in schema-pg.ts. */
  netPaySnapshot: z.number().optional(),
});

/** A one-time per-month override that takes precedence over its rule. */
const extraPaycheckOverrideSchema = z.object({
  month: z.string(),
  splits: z.array(extraPaycheckSplitSchema),
});

/** Per-year growth entry for projecting future extra-paycheck net pay. */
const yearlyGrowthEntrySchema = z.object({
  type: z.enum(["pct", "dollar"]),
  value: z.number(),
});

/**
 * A Salary Profile entry's `extraPaycheckRouting` field — see
 * ExtraPaycheckRoutingData in schema-pg.ts for the full field-by-field
 * rationale (this schema mirrors that type exactly). Moved here from
 * `jobs.extra_paycheck_routing` because it's the same category of fact as
 * `include401kInBonus`/`includeBonusInContributions` above: a comp-layer
 * decision about how this job's pay gets treated, not a job identity fact.
 * `.strict()` for the same reason as salaryEntrySchema itself.
 */
export const extraPaycheckRoutingSchema = z
  .object({
    rules: z.array(extraPaycheckRuleSchema),
    overrides: z.array(extraPaycheckOverrideSchema).optional(),
    baseNetPayPerCheck: z.number().optional(),
    baseYear: z.number().optional(),
    yearlyGrowth: z.record(z.string(), yearlyGrowthEntrySchema).optional(),
    payPeriod: payPeriodSchema.optional(),
    anchorPayDate: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

// ── salary_profiles ─────────────────────────────────────────────

/**
 * salary_profiles.salaries — jobId → salary entry.
 *
 * A job either has a COMPLETE entry (all seventeen fields, a real
 * self-contained set of numbers/elections for this profile) or no key at
 * all (this profile says nothing about that job, which resolves to
 * $0/no bonus/incomplete — never a fallback to some other value). There is
 * no partial-pin state and no "live" concept: a profile is its own complete
 * world, not a set of overrides on a shared baseline. If you want different
 * numbers, use a different profile.
 *
 * `.strict()` so a stale payload shape from an old client is rejected
 * loudly rather than being stored and silently ignored.
 *
 * Bonus terms, pay schedule, W-4 elections, and extra-paycheck routing all
 * live HERE, not split across `jobs` columns or a Contribution Profile:
 * "what is my bonus," "when do I get paid," "what withholding elections
 * apply," and "where does my extra paycheck go" are all the same category
 * of fact as "what is my salary" — this collapses income, withholding/
 * schedule elections, and comp-routing decisions into one axis (see
 * RULES.md's Salary Profile layer section for the accepted tradeoff). A
 * Contribution Profile still owns the *deductions* bucket (paycheck_
 * deductions amounts) — a distinct fact from what the job elects on its
 * W-4/pay schedule.
 */
export const salaryEntrySchema = z
  .object({
    salary: z.number(),
    /** Fraction, not percent: 0.12 = 12%. Matches the bonus % shown in the UI. */
    bonusPercent: z.number(),
    bonusMultiplier: z.number(),
    monthsInBonusYear: z.number(),
    /** This year's actual paid-out bonus, pinned once known — orthogonal to
     *  the formula fields above, which growth/projection math always uses
     *  untouched. Only the live Paycheck display reads this. */
    bonusOverride: z.number().nullable(),
    payPeriod: payPeriodSchema,
    payWeek: payWeekSchema,
    /** `null` is a real, complete value ("no anchor, use start date"). */
    anchorPayDate: z.string().nullable(),
    budgetPeriodsPerMonth: z.number().nullable(),
    w4FilingStatus: w4FilingStatusSchema,
    w4Box2cChecked: z.boolean(),
    additionalFedWithholding: z.number(),
    /** 1-12, month when bonus is typically paid (null = unknown/spread). */
    bonusMonth: z.number().nullable(),
    /** 1-31, day of month when bonus is paid (null = first period of month). */
    bonusDayOfMonth: z.number().nullable(),
    include401kInBonus: z.boolean(),
    includeBonusInContributions: z.boolean(),
    /** `null` is a real, complete value ("no extra-paycheck routing
     *  configured for this job"). See extraPaycheckRoutingSchema above. */
    extraPaycheckRouting: extraPaycheckRoutingSchema.nullable(),
  })
  .strict();

/** jobId → salary entry. */
export const salaryEntriesSchema = z.record(z.string(), salaryEntrySchema);

// ── contribution_profiles ───────────────────────────────────────

/**
 * Detailed contribution account active-field set (write-path). An entry
 * existing at all does NOT by itself mean this profile has a value —
 * an entry can legitimately exist to set only `isActive`/`displayNameActive`/
 * a match field. `contributionValue`/`contributionMethod` are the only
 * pair required TOGETHER (both or neither, enforced below) whenever either
 * is present, because the account row itself carries no value to fall back
 * to (see applyContribActiveFields — there is no base-value fallback). An
 * account with no `contributionValue` set in the current profile has no
 * resolvable contribution at all, which is the "incomplete profile" state
 * surfaced by getIncompleteContribAccountIds. Every other field here stays
 * genuinely optional — those describe account behavior a profile MAY
 * customize, not "the" value.
 * contribution_profiles.contribution_active_fields uses
 * scenarioOverridesSchema at the structural level but the leaf objects have
 * a known shape.
 */
/**
 * Base shape, all fields optional — used directly (without the refine
 * below) to validate a single-field PATCH, where a caller legitimately
 * sends just `{ isActive: false }` without touching contributionValue/
 * contributionMethod. The paired-or-neither invariant only makes sense
 * once applied to the full, merged entry — see
 * setAccountActiveFields/setDeductionActiveFields in
 * contribution-profiles.ts, which validate the post-merge result against
 * `contribAccountActiveFieldsSchema` (below) before persisting.
 */
export const contribAccountActiveFieldsPatchSchema = z
  .object({
    contributionValue: z.union([z.string(), z.number()]).optional(),
    contributionMethod: z.string().optional(),
    employerMatchType: z.string().optional(),
    employerMatchValue: z.union([z.string(), z.number()]).optional(),
    employerMaxMatchPct: z.union([z.string(), z.number()]).optional(),
    autoMaximize: z.boolean().optional(),
    isActive: z.boolean().optional(),
    displayNameActive: z.string().optional(),
  })
  .strict();

export const contribAccountActiveFieldsSchema =
  contribAccountActiveFieldsPatchSchema.refine(
    (f) =>
      (f.contributionValue === undefined) ===
      (f.contributionMethod === undefined),
    {
      message:
        "contributionValue and contributionMethod must be set together (or neither)",
      path: ["contributionValue"],
    },
  );

/**
 * Contribution-profile deduction active-field set. Deductions (STD/LTD/
 * Dental/Medical/Vision, etc.) have NO base `amountPerPeriod` of their own —
 * Stage B dropped that column — so this is the ONLY source for one, same
 * no-base-value contract as a contribution account's contributionValue (see
 * applyDeductionActiveFields/applyContribActiveFields). `deductionName`/
 * `isPretax`/`ficaExempt`/job assignment stay structural/raw-only on
 * `paycheck_deductions` itself, mirroring the accountType/taxTreatment
 * (structural) vs contributionValue/contributionMethod (profile-driven)
 * boundary contribution accounts already draw.
 */
export const deductionActiveFieldsSchema = z
  .object({
    amountPerPeriod: zDecimal.optional(),
  })
  .strict();

/**
 * contribution_profiles.contribution_active_fields — typed active-field
 * structure.
 *
 * Two different merge semantics live under this one column, by bucket —
 * both NO base value, exclude-if-absent (see applyContribActiveFields /
 * applyDeductionActiveFields):
 *  - contributionAccounts: an account absent (or with no contributionValue
 *    set) here has no resolvable contribution at all (the "incomplete
 *    profile" state).
 *  - deductions: a deduction absent (or with no amountPerPeriod set) here
 *    has no resolvable amount at all, same rule.
 *
 * There is no `jobs` bucket any more — a Contribution Profile no longer
 * touches jobs at all. Pay schedule, W-4 elections, bonus pay date/flags,
 * and employerName-override all either moved to the Salary Profile entry
 * (the first three) or lost their profile-override path entirely
 * (employerName — accepted feature reduction, see RULES.md's Salary
 * Profile layer section).
 */
export const contributionActiveFieldsSchema = z
  .object({
    contributionAccounts: z
      .record(z.string(), contribAccountActiveFieldsSchema)
      .default({}),
    deductions: z.record(z.string(), deductionActiveFieldsSchema).default({}),
  })
  .strict()
  .default({ contributionAccounts: {}, deductions: {} });

// ── app_settings ────────────────────────────────────────────────

/** app_settings.value — same as settingValueSchema */
export const appSettingValueSchema = settingValueSchema;

// ── change_log (audit — loose by design) ────────────────────────

/** change_log.old_value / new_value — any JSON-serializable value */
export const changeLogValueSchema = z.unknown();

// ── state_version_tables (backup blob — loose by design) ────────

/** state_version_tables.data — array of serialized row objects */
export const stateVersionDataSchema = z.array(z.unknown());

// ── budget_api_cache (cache — loose by design) ──────────────────

/** budget_api_cache.data — opaque API response cache */
export const budgetApiCacheDataSchema = z.unknown();
