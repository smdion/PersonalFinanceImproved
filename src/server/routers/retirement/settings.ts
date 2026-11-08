import { HOUSEHOLD_SIZE_MAX } from "@/lib/config/aca-tables";
import { returnFilingStatusSchema } from "@/lib/config/filing-status.schema";
import { eq, ne, asc, and, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import {
  storedWithdrawalOrderSchema,
  storedWithdrawalSplitsSchema,
} from "@/lib/pure/engine/types";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  isRetirementParent,
  tracksCostBasis,
} from "@/lib/config/account-types";
import { withdrawalStrategyEnum } from "@/lib/config/withdrawal-strategies";
import { strategyParamInputShape } from "@/lib/config/withdrawal-strategy-inputs";
import { zDecimal } from "@/lib/utils/zod-fields";
import { resolveRetirementProfileId } from "@/server/data/retirement-profiles";
import {
  adoptFirstRetirementProfile,
  lockFirstRetirementProfile,
} from "@/server/services/profiles/first-retirement-profile";
import { firstRow } from "@/lib/utils/first-row";

// --- CRUD Zod schemas ---

const retirementSettingsInput = z.object({
  personId: z.number().int(),
  /** Which retirement profile this write targets. Explicit key presence
   *  matters, not just the value — see the upsert mutation's docblock. Omit
   *  the field entirely only from legacy/API callers that predate profiles;
   *  every UI call site should send it (sourced from the `settings.profileId`
   *  already on the wire from computeProjection, via buildSettingsPatch). */
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
  withdrawalRoutingMode: z
    .enum(["bracket_filling", "waterfall", "percentage"])
    .optional(),
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

export const settingsProcedures = {
  retirementSettings: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.retirementSettings)
        .orderBy(asc(schema.retirementSettings.personId)),
    ),
    // Retirement Profiles phase 4: `retirement_settings` was re-keyed in
    // step C to a composite (profile_id, person_id) index — a person can
    // now hold ONE ROW PER PROFILE. This mutation must scope every read and
    // write by profile, or a household with 2+ profiles gets every profile's
    // row for that person matched (and overwritten) by a single edit.
    //
    // Key PRESENCE, not just value, matters: `profileId: undefined` (key
    // omitted — a legacy/API caller that predates profiles) resolves
    // server-side to the household's globally-active profile, so every
    // existing UI call site keeps editing exactly what it edits today.
    // `profileId: null` (key present, value null) means "the caller
    // resolved a real profileId and it was null" (e.g. a fresh/pre-backfill
    // household with zero profiles yet) — that is NOT the same as "use the
    // active profile," and must NOT silently retarget the write there; it
    // scopes to the (rare, legitimate) null-profile rows via `isNull`
    // instead of `eq`. Collapsing these two cases with `??` was the bug:
    // once the assumptions band lets you VIEW a non-active profile, an
    // omitted-vs-null mixup would render profile B while writing profile A.
    upsert: adminProcedure
      .input(retirementSettingsInput)
      .mutation(async ({ ctx, input }) => {
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

          // Propagate household-grain fields to every other person's row —
          // WITHIN THE SAME PROFILE ONLY (the `profileScope` filter below).
          //
          // `retirement_settings` is one row per (profile, person), but a
          // few of its columns are presented in the UI as a SINGLE
          // household control while being read across all people within
          // that profile. Historically `end_age` was the live case here
          // ("Projection Through" — see sections/timeline.tsx). As of the
          // Retirement Profiles migration (step B), the engine's actual
          // per-person read for end_age moved to `retirement_profile_people`
          // — see the `retirementProfilePeople.upsertPerson` /
          // `upsertHouseholdEndAge` mutations below, which are now the
          // real write path for that field. This fan-out stays for
          // whatever legacy readers still fall back to
          // `retirement_settings.end_age` (build-engine-payload.ts's
          // `pp ?? retSettings.find(...)` fallback, reached only when a
          // profile-person row is missing).
          //
          // DELIBERATELY NARROW. Do not extend this to every column:
          // `salary_annual_increase` is genuinely per-person and read
          // per-person (build-engine-payload.ts, whose docblock records
          // that applying the primary's raise rate to everyone "silently
          // produced the wrong number" — a bug already fixed once). Fanning
          // that out would re-introduce it. Only add a field here if its UI
          // control is household-wide AND its read path aggregates across
          // people within one profile.
          const HOUSEHOLD_FANOUT_FIELDS = ["endAge"] as const;
          const fanout = Object.fromEntries(
            HOUSEHOLD_FANOUT_FIELDS.map((f) => [f, resolvedInput[f]]),
          );
          if (Object.keys(fanout).length > 0) {
            // Existing rows only — a person with no row already inherits the
            // primary's value via the `?? settings.endAge` fallback in
            // build-engine-payload.ts, so creating rows here would add
            // state without changing the result.
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
      }),

    // `salary_annual_increase` is stored per (profile, person) on
    // `retirement_settings` and read per-person by the engine
    // (`build-engine-payload.ts`'s `raiseRateByPerson`), but the "Pre-
    // Retirement Raise" UI control was a single household control that only
    // ever wrote the primary person's row via `retirementSettings.upsert` —
    // so a second household member's raise rate was unreachable after seed
    // time. This narrow mutation writes ONLY that one column for one
    // (profile, person); the multi-person Income section calls it per person.
    // Deliberately NOT a fan-out (that would overwrite each person's distinct
    // rate with the primary's — the exact bug `raiseRateByPerson`'s docblock
    // records as already fixed once) and deliberately NOT folded into
    // `upsert` (which requires a full anchor payload the per-person UI
    // doesn't have, runs the endAge fan-out, and resolves+writes a default
    // filing status — all wrong for a one-field raise-rate edit).
    // UPDATE-only: the step-A completeness invariant guarantees a row per
    // (profile, person); a missing row is an error, not a silent insert with
    // guessed NOT NULL anchor values.
    upsertPersonRaiseRate: adminProcedure
      .input(
        z.object({
          profileId: z.number().int(),
          personId: z.number().int(),
          salaryAnnualIncrease: zDecimal,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .update(schema.retirementSettings)
          .set({ salaryAnnualIncrease: input.salaryAnnualIncrease })
          .where(
            and(
              eq(schema.retirementSettings.profileId, input.profileId),
              eq(schema.retirementSettings.personId, input.personId),
            ),
          )
          .returning();
        if (!row) {
          // .mutation() — friendlyMutationError only passes a message
          // through for BAD_REQUEST (NOT_FOUND gets fixed generic copy).
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "No retirement settings for this person yet — open the Retirement page first.",
          });
        }
        return row;
      }),
  }),
};
