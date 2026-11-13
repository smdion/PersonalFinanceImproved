/**
 * The decumulation override and defaults schemas: one source for the
 * projection procedures' input and the engine's `DecumulationOverride`.
 */
import { z } from "zod/v4";
import {
  accountCategoryEnum,
  buildCategoryRecord,
  PARENT_CATEGORY_VALUES,
  type AccountCategory,
} from "@/lib/config/account-types";
import { WITHDRAWAL_ROUTING_MODES } from "@/lib/config/withdrawal-routing";

export const lumpSumSchema = z
  .array(
    z.object({
      amount: z.number().positive(),
      targetAccount: z.enum(accountCategoryEnum()),
      taxType: z.enum(["traditional", "roth"]).optional(),
      targetAccountName: z.string().max(200).optional(),
      // Disambiguates two household members' identically-named accounts
      // (LumpSum.targetOwnerName). Optional so older saved lump sums parse.
      targetOwnerName: z.string().max(200).optional(),
      // The named account's id (null: no single account matched) and owner
      // (null: joint), beside its name
      // (LumpSum.targetPerformanceAccountId).
      targetPerformanceAccountId: z.number().int().nullable().optional(),
      targetOwnerPersonId: z.number().int().nullable().optional(),
      // Whose money a lump sum with no named account is (the Brokerage
      // page's are Portfolio savings): LumpSum.targetParentCategory.
      targetParentCategory: z.enum(PARENT_CATEGORY_VALUES).optional(),
      label: z.string().max(100).optional(),
    }),
  )
  .optional();

/** The Roth-or-Traditional preference per account category. A key that
 *  names no category is dropped, never refused: the engine reads categories only. */
const withdrawalTaxPreferenceSchema = z
  .record(z.string(), z.enum(["traditional", "roth"]))
  .transform((preference) => {
    const kept: Partial<Record<AccountCategory, "traditional" | "roth">> = {};
    for (const category of accountCategoryEnum()) {
      const value = preference[category];
      if (value !== undefined) kept[category] = value;
    }
    return kept;
  });

/** Splits with every category, a category left out at 0%. */
function fillSplits(
  splits: Partial<Record<AccountCategory, number>>,
): Record<AccountCategory, number> {
  const filled = buildCategoryRecord(() => 0);
  for (const category of accountCategoryEnum()) {
    const value = splits[category];
    if (value !== undefined) filled[category] = value;
  }
  return filled;
}

/** Whether a year may draw money the 10% early-withdrawal penalty applies
 *  to (DecumulationDefaults.avoidPenalizedWithdrawals). */
const avoidPenalizedWithdrawalsSchema = z.boolean().optional();

/** Top-level `decumulationDefaults` query input: the live withdrawal
 *  settings a client may send over the household's saved ones. No
 *  `withdrawalRate`: the rate always comes from retirement_settings. */
export const decumulationDefaultsInputSchema = z
  .object({
    // `.optional()`, never `.default(...)`: a default would hide the saved
    // value; `buildDecumulationDefaults` owns the fallback (client > DB
    // setting, then the config default for order and splits).
    withdrawalRoutingMode: z.enum(WITHDRAWAL_ROUTING_MODES).optional(),
    withdrawalOrder: z.array(z.enum(accountCategoryEnum())).optional(),
    // Partial like a year's override: a category left out takes 0%.
    withdrawalSplits: z
      .partialRecord(z.enum(accountCategoryEnum()), z.number())
      .transform(fillSplits)
      .optional(),
    withdrawalTaxPreference: withdrawalTaxPreferenceSchema.default({}),
    avoidPenalizedWithdrawals: avoidPenalizedWithdrawalsSchema,
  })
  // No routing mode, order or splits in the object default either: a caller
  // that omits `decumulationDefaults` (Tax Optimization's comparisons) must
  // still reach the DB fallback in `buildDecumulationDefaults`.
  .default({
    withdrawalTaxPreference: {},
  });

/** "Changes by year" for the decumulation phase (DecumulationOverride). No
 *  per-year `withdrawalRate`: no spending strategy reads one. */
export const decumulationOverrideArraySchema = z.array(
  z.object({
    year: z.number().int(),
    withdrawalRoutingMode: z.enum(WITHDRAWAL_ROUTING_MODES).optional(),
    withdrawalOrder: z.array(z.enum(accountCategoryEnum())).optional(),
    // Per-category fields set only some categories (the engine's Partial).
    withdrawalSplits: z
      .partialRecord(z.enum(accountCategoryEnum()), z.number())
      .optional(),
    withdrawalTaxPreference: withdrawalTaxPreferenceSchema.optional(),
    avoidPenalizedWithdrawals: avoidPenalizedWithdrawalsSchema,
    // Dollar cap per account per year; excess need moves to the next account.
    withdrawalAccountCaps: z
      .partialRecord(z.enum(accountCategoryEnum()), z.number())
      .optional(),
    // Cross-account dollar cap per tax type (e.g. Traditional ≤ $80k/year).
    withdrawalTaxTypeCaps: z
      .object({
        traditional: z.number().optional(),
        roth: z.number().optional(),
      })
      .optional(),
    // Roth conversion target from this year on; 0 turns conversions off.
    rothConversionTarget: z.number().min(0).max(1).optional(),
    // bracket_filling's target rate and the RMD-smoothing ceiling from this
    // year on, so a bracket-target search keeps the two consistent.
    rothBracketTarget: z.number().min(0).max(1).optional(),
    rmdSmoothingMaxBracketTarget: z.number().min(0).max(1).optional(),
    // One-time withdrawals for this year only (not sticky-forward).
    lumpSums: lumpSumSchema,
    // Every decumulation field reverts to DecumulationDefaults.
    reset: z.boolean().optional(),
    notes: z.string().optional(),
  }),
);

/** The household's saved withdrawal order: categories, no repeats. A
 *  partial list is allowed; the engine backfills the rest
 *  (`ensureCompleteWithdrawalOrder`). */
export const storedWithdrawalOrderSchema = z
  .array(z.enum(accountCategoryEnum()))
  .refine((arr) => new Set(arr).size === arr.length, {
    message: "withdrawalOrder must not repeat an account category",
  });

/** The saved percentage-mode splits, as fractions, a category left out at 0%.
 *  The sum check is loose on purpose: a one-field edit pushes it off 100%
 *  for a moment; the router reads each split as its part of the sum. */
export const storedWithdrawalSplitsSchema = z
  .partialRecord(z.enum(accountCategoryEnum()), z.number().min(0).max(1))
  .refine(
    (rec) => {
      const sum = Object.values(rec).reduce((s, v) => s + v, 0);
      return sum > 0.5 && sum < 1.5;
    },
    {
      message: "withdrawalSplits values must be in the neighbourhood of 100%",
    },
  )
  .transform(fillSplits);
