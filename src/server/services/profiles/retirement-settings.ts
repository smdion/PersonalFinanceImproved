import type { Db } from "@/lib/db";
import { HOUSEHOLD_SIZE_MAX } from "@/lib/config/aca-tables";
import { returnFilingStatusSchema } from "@/lib/config/filing-status.schema";
import { eq, ne, and, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import {
  storedWithdrawalOrderSchema,
  storedWithdrawalSplitsSchema,
} from "@/lib/pure/engine/types";
import * as schema from "@/lib/db/schema";
import {
  isRetirementParent,
  tracksCostBasis,
} from "@/lib/config/account-types";
import { withdrawalStrategyEnum } from "@/lib/config/withdrawal-strategies";
import { WITHDRAWAL_ROUTING_MODES } from "@/lib/config/withdrawal-routing";
import { strategyParamInputShape } from "@/lib/config/withdrawal-strategy-inputs";
import { zDecimal } from "@/lib/utils/zod-fields";
import { resolveRetirementProfileId } from "@/server/data/retirement-profiles";
import {
  adoptFirstRetirementProfile,
  lockFirstRetirementProfile,
} from "@/server/services/profiles/first-retirement-profile";
import { firstRow } from "@/lib/utils/first-row";

// --- CRUD Zod schemas ---

export const retirementSettingsInput = z.object({
  personId: z.number().int(),
  /** Which retirement profile this write targets; key presence matters (see `upsertRetirementSettings`).
   *  Omitted only by API callers without profiles; UI call sites always send it. */
  profileId: z.number().int().nullable().optional(),
  retirementAge: z.number().int().min(18).max(100),
  endAge: z.number().int().min(30).max(120),
  returnAfterRetirement: zDecimal,
  annualInflation: zDecimal,
  postRetirementInflation: zDecimal.nullable().optional(),
  salaryAnnualIncrease: zDecimal,
  salaryCap: zDecimal.nullable().optional(),
  raisesDuringRetirement: z.boolean().default(false),
  ruleOf55Override: z.boolean().optional(),
  withdrawalRate: zDecimal.optional(),
  taxMultiplier: zDecimal.optional(),
  grossUpForTaxes: z.boolean().optional(),
  rothBracketTarget: zDecimal.nullable().optional(),
  enableRothConversions: z.boolean().optional(),
  rothConversionTarget: zDecimal.nullable().optional(),
  withdrawalStrategy: z.enum(withdrawalStrategyEnum()).optional(),
  discretionaryWithdrawalOrder: z
    .enum(["roth_first", "brokerage_first"])
    .optional(),
  withdrawalRoutingMode: z.enum(WITHDRAWAL_ROUTING_MODES).optional(),
  /** Persisted household default for the withdrawal ORDER. `null` clears it
   *  back to `getDefaultDecumulationOrder()`; omit the key to leave it. */
  withdrawalOrder: storedWithdrawalOrderSchema.nullable().optional(),
  /** Persisted household default for percentage-mode splits. `null` clears
   *  it back to the default; omit the key to leave it unchanged. */
  withdrawalSplits: storedWithdrawalSplitsSchema.nullable().optional(),
  ...strategyParamInputShape(),
  rmdExcessHandling: z.enum(["reinvest", "spend"]).optional(),
  /** Where reinvested RMD money goes — a Retirement brokerage's performance
   *  account; null = spread across the Retirement brokerages. */
  rmdExcessTargetPerformanceAccountId: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional(),
  qcdMaximize: z.boolean().optional(),
  rmdSmoothingEnabled: z.boolean().optional(),
  rmdSmoothingMaxBracketTarget: zDecimal.nullable().optional(),
  enableIrmaaAwareness: z.boolean().optional(),
  /** IRMAA surcharges on top of the budget rather than inside it. */
  irmaaOnTopOfBudget: z.boolean().optional(),
  gapYearStopSaving: z.boolean().optional(),
  gapYearDraws: z.boolean().optional(),
  enableAcaAwareness: z.boolean().optional(),
  householdSize: z.number().int().min(1).max(HOUSEHOLD_SIZE_MAX).optional(),
  socialSecurityMonthly: zDecimal.optional(),
  ssStartAge: z.number().int().min(62).max(70).optional(),
  filingStatus: returnFilingStatusSchema.nullable().optional(),
});

export async function upsertRetirementSettings(
  ctx: { db: Db },
  input: z.output<typeof retirementSettingsInput>,
) {
  // Unspent RMD money is retirement money: only an active Retirement
  // brokerage may receive it.
  if (input.rmdExcessTargetPerformanceAccountId != null) {
    const [target] = await ctx.db
      .select()
      .from(schema.performanceAccounts)
      .where(
        eq(
          schema.performanceAccounts.id,
          input.rmdExcessTargetPerformanceAccountId,
        ),
      );
    if (
      !target?.isActive ||
      !tracksCostBasis(target.accountType) ||
      !isRetirementParent(target.parentCategory)
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Unspent required withdrawals can only go to an active Retirement brokerage",
      });
  }
  return ctx.db.transaction(async (tx) => {
    const profileIdGiven = Object.prototype.hasOwnProperty.call(
      input,
      "profileId",
    );
    let resolvedProfileId = profileIdGiven
      ? input.profileId!
      : await resolveRetirementProfileId(tx);
    // No profile at all yet: this save makes the first one. Wait out
    // a first save in flight, then look again, so two can't make two.
    const firstSave =
      resolvedProfileId == null &&
      (!profileIdGiven || (await resolveRetirementProfileId(tx)) == null);
    if (firstSave) {
      await lockFirstRetirementProfile(tx);
      resolvedProfileId = await resolveRetirementProfileId(tx);
    }
    const profileScope =
      resolvedProfileId != null
        ? eq(schema.retirementSettings.profileId, resolvedProfileId)
        : isNull(schema.retirementSettings.profileId);

    const existing = await tx
      .select()
      .from(schema.retirementSettings)
      .where(
        and(
          eq(schema.retirementSettings.personId, input.personId),
          profileScope,
        ),
      );
    // filing_status: null = "Auto" (follow this year's filing status,
    // resolved when read — lib/pure/tax/filing-status.ts); not sent = keep
    // what's stored. Never defaulted here.
    const { profileId: _profileIdKey, ...inputFields } = input;
    const resolvedInput = {
      ...inputFields,
      profileId: resolvedProfileId,
      filingStatus:
        input.filingStatus === undefined
          ? (existing[0]?.filingStatus ?? null)
          : input.filingStatus,
    };
    const saved =
      existing.length > 0
        ? await tx
            .update(schema.retirementSettings)
            .set(resolvedInput)
            .where(
              and(
                eq(schema.retirementSettings.personId, input.personId),
                profileScope,
              ),
            )
            .returning()
            .then(firstRow)
        : await tx
            .insert(schema.retirementSettings)
            .values(resolvedInput)
            .returning()
            .then(firstRow);

    // Fan household-grain fields to every person's row in the SAME profile, for
    // readers that fall back to `retirement_settings.end_age`. Add a field only if its
    // UI control is household-wide AND its read aggregates across people.
    const HOUSEHOLD_FANOUT_FIELDS = ["endAge"] as const;
    const fanout = Object.fromEntries(
      HOUSEHOLD_FANOUT_FIELDS.map((f) => [f, resolvedInput[f]]),
    );
    if (Object.keys(fanout).length > 0) {
      // Existing rows only: a person with no row already inherits the primary's
      // value via the `?? settings.endAge` fallback in build-engine-payload.ts.
      await tx
        .update(schema.retirementSettings)
        .set(fanout)
        .where(
          and(
            ne(schema.retirementSettings.personId, input.personId),
            profileScope,
          ),
        );
    }

    if (firstSave && resolvedProfileId == null) {
      const adopted = await adoptFirstRetirementProfile(tx);
      if (adopted != null) return { ...saved!, profileId: adopted };
    }
    return saved;
  });
}
