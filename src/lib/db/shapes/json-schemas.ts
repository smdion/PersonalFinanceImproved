/**
 * Zod schemas for every JSONB column, parsed before each write; most mirror the column's type in
 * schema.ts; app settings, the audit log, backups and the API cache are loose by design.
 */

import { z } from "zod/v4";
import {
  payPeriodSchema,
  payWeekSchema,
  bonusDestinationSchema,
  contributionMethodSchema,
  employerMatchTypeSchema,
} from "@/lib/config/enum-values.schema";
import { ROTH_IRA_ROUTE_VALUES } from "@/lib/config/enum-values";
import { zDecimal, zMoneyNumber, zYear } from "@/lib/utils/zod-fields";
import { w4FilingStatusSchema } from "@/lib/config/filing-status.schema";
import { isCalendarDate } from "@/lib/utils/date";

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

/** Each entry's value is ≥ the previous one's. */
const nonDecreasing = (xs: number[]) =>
  xs.every((x, i) => i === 0 || x >= xs[i - 1]!);

/** ltcg_brackets.brackets: each threshold is that bracket's ceiling. Only the last threshold
 *  is null (the open top); thresholds and rates (0–100%) never go down. Equal thresholds are
 *  allowed (Settings' empty placeholder is 0 / 0 / top). */
export const ltcgBracketsSchema = z
  .array(ltcgBracketEntrySchema)
  .min(1)
  .refine((b) => b.at(-1)?.threshold === null, {
    message: "The last LTCG bracket must have no upper limit",
  })
  .refine(
    (b) =>
      b.slice(0, -1).every((e) => e.threshold !== null && e.threshold >= 0),
    {
      message: "Only the last LTCG bracket can have no upper limit",
    },
  )
  .refine((b) => nonDecreasing(b.slice(0, -1).map((e) => e.threshold ?? 0)), {
    message: "LTCG thresholds must go up",
  })
  .refine(
    (b) =>
      b.every((e) => e.rate >= 0 && e.rate <= 1) &&
      nonDecreasing(b.map((e) => e.rate)),
    { message: "LTCG rates must be 0–100% and go up" },
  );

// ── irmaa_brackets ──────────────────────────────────────────────

/** Single entry inside irmaa_brackets.brackets */
export const irmaaBracketEntrySchema = z.object({
  magiThreshold: z.number(),
  annualSurcharge: z.number(),
});

/** irmaa_brackets.brackets — ordered list of IRMAA bracket entries (the
 *  surcharge applies above each threshold): thresholds and surcharges are
 *  non-negative and never go down. */
export const irmaaBracketsSchema = z
  .array(irmaaBracketEntrySchema)
  .min(1)
  .refine(
    (b) =>
      b.every((e) => e.magiThreshold >= 0 && e.annualSurcharge >= 0) &&
      nonDecreasing(b.map((e) => e.magiThreshold)) &&
      nonDecreasing(b.map((e) => e.annualSurcharge)),
    { message: "IRMAA thresholds and surcharges must be positive and go up" },
  );

// ── fpl_by_household ────────────────────────────────────────────

/** fpl_by_household.amounts: FPL dollars by household size, all 8 keys required since
 *  getAcaSubsidyCliff throws on a missing size. */
export const fplByHouseholdAmountsSchema = z.object({
  "1": z.number(),
  "2": z.number(),
  "3": z.number(),
  "4": z.number(),
  "5": z.number(),
  "6": z.number(),
  "7": z.number(),
  "8": z.number(),
});

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
  debtId: z.number().int().optional(),
  performanceAccountId: z.number().int().optional(),
});

/** api_connections.account_mappings (nullable) */
export const accountMappingsSchema = z.array(accountMappingSchema).nullable();

/** api_connections.skipped_category_ids (nullable) */
export const skippedCategoryIdsSchema = z.array(z.string()).nullable();

// ── relocation_scenarios ────────────────────────────────────────

const yearAdjustmentSchema = z.object({
  year: zYear,
  monthlyExpenses: zMoneyNumber,
  profileId: z.number().optional(),
  budgetColumn: z.number().optional(),
  notes: z.string().optional(),
});

const largePurchaseSchema = z.object({
  name: z.string(),
  purchasePrice: zMoneyNumber,
  downPaymentPercent: z.number().optional(),
  loanRate: z.number().optional(),
  loanTermYears: z.number().optional(),
  ongoingMonthlyCost: zMoneyNumber.optional(),
  saleProceeds: zMoneyNumber.optional(),
  purchaseYear: zYear,
});

/** relocation_scenarios.params, as the save request sends it (request
 *  fields, so zYear years); nothing parses stored rows through it. */
export const relocationScenarioParamsSchema = z.object({
  currentProfileId: z.number(),
  currentBudgetColumn: z.number(),
  currentExpenseOverride: zMoneyNumber.nullable(),
  relocationProfileId: z.number(),
  relocationBudgetColumn: z.number(),
  relocationExpenseOverride: zMoneyNumber.nullable(),
  yearAdjustments: z.array(yearAdjustmentSchema),
  largePurchases: z.array(largePurchaseSchema),
  currentContributionProfileId: z.number().nullable(),
  relocationContributionProfileId: z.number().nullable(),
  moveYear: zYear.nullable().optional().default(null),
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

/** A Salary Profile entry's `extraPaycheckRouting`, mirroring ExtraPaycheckRoutingData in
 *  schema-pg.ts; `.strict()` like salaryEntrySchema. */
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
 * salary_profiles.salaries: jobId → a complete entry (salary, bonus, pay schedule, W-4, extra-
 * paycheck routing) or no key (the job resolves to $0, never a fallback). `.strict()` rejects a
 * stale shape, so a new required field ships with its BLANK_SALARY_ENTRY default.
 */
export const salaryEntrySchema = z
  .object({
    salary: z.number().nonnegative(),
    /** Fraction, not percent: 0.12 = 12%. Matches the bonus % shown in the UI. */
    bonusPercent: z.number().nonnegative(),
    bonusMultiplier: z.number().nonnegative(),
    monthsInBonusYear: z.number().min(0).max(12),
    /** This year's actual paid-out bonus, pinned once known — orthogonal to
     *  the formula fields above, which growth/projection math always uses
     *  untouched. Only the live Paycheck display reads this. */
    bonusOverride: z.number().nonnegative().nullable(),
    payPeriod: payPeriodSchema,
    payWeek: payWeekSchema,
    /** `null` is a real, complete value ("no anchor, use start date"). */
    anchorPayDate: z
      .string()
      .refine(isCalendarDate, "Not a date (YYYY-MM-DD, 1900-2100)")
      .nullable(),
    /** null = the pay schedule's usual number. */
    budgetPeriodsPerMonth: z.number().positive().nullable(),
    w4FilingStatus: w4FilingStatusSchema,
    w4Box2cChecked: z.boolean(),
    additionalFedWithholding: z.number().nonnegative(),
    /** 1-12, month when bonus is typically paid (null = unknown/spread). */
    bonusMonth: z.number().int().min(1).max(12).nullable(),
    /** 1-31, day of month when bonus is paid (null = first period of month). */
    bonusDayOfMonth: z.number().int().min(1).max(31).nullable(),
    /** `null` is a real, complete value ("no extra-paycheck routing
     *  configured for this job"). See extraPaycheckRoutingSchema above. */
    extraPaycheckRouting: extraPaycheckRoutingSchema.nullable(),
    /** Where this job's bonus goes: into the budget (absent) or extra
     *  spending outside it — Living Costs shows its take-home as its own
     *  bar. */
    bonusDestination: bonusDestinationSchema.optional(),
    /** Other pay per check, by paycheck_earnings id (amount ≥ 0). Absent =
     *  none — the same as `{}`, so older entries need no backfill. */
    otherEarnings: z
      .record(z.string().regex(/^\d+$/), z.number().nonnegative())
      .optional(),
  })
  .strict();

/** jobId → salary entry. */
export const salaryEntriesSchema = z.record(z.string(), salaryEntrySchema);

// ── contribution_profiles ───────────────────────────────────────

/**
 * All fields optional, used alone to validate a single-field PATCH; the merged entry is then
 * checked against `contribAccountActiveFieldsSchema` (paired-or-neither) before saving.
 */
export const contribAccountActiveFieldsPatchSchema = z
  .object({
    contributionValue: z.union([z.string(), z.number()]).optional(),
    contributionMethod: contributionMethodSchema.optional(),
    employerMatchType: employerMatchTypeSchema.optional(),
    employerMatchValue: z.union([z.string(), z.number()]).optional(),
    /** A percent match's rate, a fraction: what is read (0017 drops the value). */
    employerMatchRate: z.union([z.string(), z.number()]).optional(),
    employerMaxMatchPct: z.union([z.string(), z.number()]).optional(),
    autoMaximize: z.boolean().optional(),
    isActive: z.boolean().optional(),
    /** Also taken from bonus checks (bonusCheckContribution). Absent = no. */
    fromBonus: z.boolean().optional(),
    /** A Roth IRA account's route (ROTH_IRA_ROUTE_VALUES). Absent = direct. */
    rothRoute: z.enum(ROTH_IRA_ROUTE_VALUES).optional(),
    /** This profile's display label for the account; cosmetic only. */
    displayNameCustom: z.string().optional(),
  })
  .strict();

/**
 * A profile's contribution-account active fields (write path). `contributionValue` and
 * `contributionMethod` come together or not at all; with neither, the account has no
 * contribution (getIncompleteContribAccountIds), as the row has no fallback. Others optional.
 */
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
 * A profile's deduction active fields: the only source of a deduction's `amountPerPeriod` (no
 * base value, like contributionValue). Name, tax flags and job stay on paycheck_deductions.
 */
export const deductionActiveFieldsSchema = z
  .object({
    amountPerPeriod: zDecimal.optional(),
  })
  .strict();

/**
 * contribution_profiles.contribution_active_fields, with no base value: an account without
 * contributionValue, or a deduction without amountPerPeriod, resolves to nothing (the
 * "incomplete profile" state). Job fields live on the Salary Profile, not here.
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
