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

// ── salary_profiles ─────────────────────────────────────────────

/**
 * salary_profiles.salaries — jobId → salary entry.
 *
 * A job either has a COMPLETE entry (all four fields, a real self-contained
 * number for this profile) or no key at all (this profile says nothing
 * about that job, which resolves to $0/no bonus — never a fallback to some
 * other value). There is no partial-pin state and no "live" concept: a
 * profile is its own complete world, not a set of overrides on a shared
 * baseline. If you want different numbers, use a different profile.
 *
 * `.strict()` so a stale payload shape from an old client is rejected
 * loudly rather than being stored and silently ignored.
 *
 * Bonus terms live HERE, not on a Contribution Profile: "what is my bonus"
 * is the same category of fact as "what is my salary". A Contribution
 * Profile still owns include401kInBonus / includeBonusInContributions,
 * which are about how contributions are computed FROM a bonus.
 */
export const salaryEntrySchema = z
  .object({
    salary: z.number(),
    /** Fraction, not percent: 0.12 = 12%. Matches the bonus % shown in the UI. */
    bonusPercent: z.number(),
    bonusMultiplier: z.number(),
    monthsInBonusYear: z.number(),
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
export const contribAccountActiveFieldsSchema = z
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
  .strict()
  .refine(
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
 * Contribution-profile job active-field set.
 *
 * Bonus AMOUNT terms (bonusPercent / bonusMultiplier / monthsInBonusYear)
 * deliberately do NOT appear here — they moved to the Salary Profile entry,
 * because "how big is the bonus" belongs with "how big is the salary". What
 * stays is what is genuinely about contributions computed FROM a bonus
 * (include401kInBonus, includeBonusInContributions), plus the employer name
 * and the bonus pay DATE, which are neither.
 */
export const jobActiveFieldsSchema = z
  .object({
    bonusMonth: z.union([z.number(), z.null()]).optional(),
    bonusDayOfMonth: z.union([z.number(), z.null()]).optional(),
    include401kInBonus: z.boolean().optional(),
    includeBonusInContributions: z.boolean().optional(),
    employerName: z.string().optional(),
  })
  .strict();

/** contribution_profiles.contribution_active_fields — typed active-field structure */
export const contributionActiveFieldsSchema = z
  .object({
    contributionAccounts: z
      .record(z.string(), contribAccountActiveFieldsSchema)
      .default({}),
    jobs: z.record(z.string(), jobActiveFieldsSchema).default({}),
  })
  .strict()
  .default({ contributionAccounts: {}, jobs: {} });

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
