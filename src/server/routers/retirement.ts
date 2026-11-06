/** Retirement router for readiness analysis including savings rates, employer matches, tax bucket projections, relocation comparisons, profile-switching scenarios, and retirement-settings/scenario/override/return-rate CRUD. */
import { HOUSEHOLD_SIZE_MAX } from "@/lib/config/aca-tables";
import { returnFilingStatusSchema } from "@/lib/config/filing-status.schema";
import { redundantReturnRateIds } from "@/lib/pure/simulation/return-rate-breakpoints";
import {
  deleteProfile,
  duplicateProfile,
} from "@/server/services/profiles/profile-lifecycle";
import { eq, ne, asc, and, isNull, inArray } from "drizzle-orm";
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
  brokerageProcedure,
  getSessionUserLabel,
} from "../trpc";
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
import type { Db } from "@/lib/db";
import {
  computeRelocationAnalysis,
  zRelocationAnalysisInput,
} from "@/server/services/projection/relocation-analysis";

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

// retirementScenarioInput removed with the retirementScenarios router
// (Retirement Profiles step B) — nothing writes that table any more.

const returnRateInput = z.object({
  age: z.number().int(),
  rateOfReturn: zDecimal,
});

/** Remove breakpoints that repeat the previous rate — one entry per run of
 *  equal rates (lib/pure/simulation/return-rate-breakpoints.ts). */
async function collapseReturnRates(db: Db) {
  const ids = redundantReturnRateIds(
    await db.select().from(schema.returnRateTable),
  );
  if (ids.length > 0)
    await db
      .delete(schema.returnRateTable)
      .where(inArray(schema.returnRateTable.id, ids));
}

// `fetchRetirementData` and `buildEnginePayload` were moved to
// `src/server/services/projection/engine-payload/build-engine-payload.ts`.
// Projection router imports them directly from the new path; nothing else
// imports from here, so no re-export shim is needed.

export const retirementRouter = createTRPCRouter({
  computeRelocationAnalysis: protectedProcedure
    .input(zRelocationAnalysisInput)
    .query(({ ctx, input }) => computeRelocationAnalysis(ctx, input)),

  // getProjection and getMonteCarloProjection moved to projection.ts

  retirementProfilePeople: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.retirementProfilePeople)
        .orderBy(
          asc(schema.retirementProfilePeople.profileId),
          asc(schema.retirementProfilePeople.personId),
        ),
    ),

    // Retirement Profiles phase 4 (the assumptions band). Until this
    // mutation existed, every per-person editor on the Projection
    // Assumptions card (Timeline's per-person Retirement Age + Rule of 55,
    // Social Security's per-person benefit) actually called
    // `retirementSettings.upsert`, writing `retirement_settings` — the
    // table `build-engine-payload.ts` stopped reading per-person values
    // from once those reads were switched to `retirement_profile_people`.
    // The edits saved, the UI showed the new
    // number optimistically, and the projection never moved — same failure
    // shape as the pre-0b5d5fe `end_age` bug, just at this table instead.
    // This is the real write path now; the affected client call sites are
    // updated in the same commit as this mutation.
    upsertPerson: adminProcedure
      .input(
        z.object({
          profileId: z.number().int(),
          personId: z.number().int(),
          retirementAge: z.number().int().min(18).max(100).optional(),
          endAge: z.number().int().min(30).max(120).optional(),
          socialSecurityMonthly: zDecimal.nullable().optional(),
          // PIA (Primary Insurance Amount, monthly benefit at Full
          // Retirement Age) — opt-in direct user input, see
          // SOCIAL-SECURITY-OPTIMIZATION-PLAN.md decision #1. Independent
          // of socialSecurityMonthly; null means "not opted in," never
          // falls back to a household-wide default (PIA is inherently
          // per-person).
          socialSecurityPia: zDecimal.nullable().optional(),
          ssStartAge: z.number().int().min(62).max(70).nullable().optional(),
          ruleOf55Override: z.boolean().nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(schema.retirementProfilePeople)
          .where(
            and(
              eq(schema.retirementProfilePeople.profileId, input.profileId),
              eq(schema.retirementProfilePeople.personId, input.personId),
            ),
          );
        // retirementAge/endAge are NOT NULL — the completeness invariant
        // (profile duplicate / person create, see retirementProfiles below)
        // guarantees `existing` here in every real flow, but an insert path
        // still needs concrete values if it's ever reached cold.
        if (
          !existing &&
          (input.retirementAge == null || input.endAge == null)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Retirement age and end age are required to add a person to a new profile.",
          });
        }
        const { profileId, personId, ...patch } = input;
        const values = {
          profileId,
          personId,
          retirementAge: patch.retirementAge ?? existing!.retirementAge,
          endAge: patch.endAge ?? existing!.endAge,
          ...("socialSecurityMonthly" in patch
            ? { socialSecurityMonthly: patch.socialSecurityMonthly }
            : {}),
          ...("socialSecurityPia" in patch
            ? { socialSecurityPia: patch.socialSecurityPia }
            : {}),
          ...("ssStartAge" in patch ? { ssStartAge: patch.ssStartAge } : {}),
          ...("ruleOf55Override" in patch
            ? { ruleOf55Override: patch.ruleOf55Override }
            : {}),
        };
        return existing
          ? ctx.db
              .update(schema.retirementProfilePeople)
              .set(values)
              .where(eq(schema.retirementProfilePeople.id, existing.id))
              .returning()
              .then((r) => r[0])
          : ctx.db
              .insert(schema.retirementProfilePeople)
              .values(values)
              .returning()
              .then((r) => r[0]);
      }),

    // "Plan Through" (end age) and Social Security "Start Age" both render
    // as ONE household-wide control regardless of person count
    // (sections/timeline.tsx, sections/social-security.tsx), but the
    // engine's real per-person read source for both
    // (`retirement_profile_people`) is per-person storage. Fan whichever
    // field the caller sends to every person's row in the profile — same
    // shape as `retirementSettings.upsert`'s endAge fan-out used to be the
    // fix for, before the read moved to this table out from under it (see
    // upsertPerson's docblock above).
    upsertHouseholdFields: adminProcedure
      .input(
        z.object({
          profileId: z.number().int(),
          endAge: z.number().int().min(30).max(120).optional(),
          ssStartAge: z.number().int().min(62).max(70).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { profileId, ...fields } = input;
        const patch = Object.fromEntries(
          Object.entries(fields).filter(([, v]) => v !== undefined),
        );
        if (Object.keys(patch).length === 0) return [];
        return ctx.db
          .update(schema.retirementProfilePeople)
          .set(patch)
          .where(eq(schema.retirementProfilePeople.profileId, profileId))
          .returning();
      }),
  }),

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
                  .then((r) => r[0])
              : await tx
                  .insert(schema.retirementSettings)
                  .values(resolvedInput)
                  .returning()
                  .then((r) => r[0]);

          // Propagate household-grain fields to every other person's row —
          // WITHIN THE SAME PROFILE ONLY (the `profileScope` filter below).
          //
          // `retirement_settings` is one row per (profile, person), but a
          // few of its columns are presented in the UI as a SINGLE
          // household control while being read across all people within
          // that profile. Historically `end_age` was the live case here
          // ("Plan Through" — see sections/timeline.tsx). As of the
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
            HOUSEHOLD_FANOUT_FIELDS.filter(
              (f) => resolvedInput[f] !== undefined,
            ).map((f) => [f, resolvedInput[f]]),
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

  retirementSalaryOverrides: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.retirementSalaryOverrides)
        .orderBy(asc(schema.retirementSalaryOverrides.projectionYear)),
    ),
    create: adminProcedure
      .input(
        z.object({
          personId: z.number().int(),
          projectionYear: z.number().int().min(1900).max(2100),
          overrideSalary: zDecimal,
          contributionProfileId: z.number().int().nullable().optional(),
          salaryProfileId: z.number().int().nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.retirementSalaryOverrides)
          .values({ ...input, createdBy: getSessionUserLabel(ctx.session) })
          .returning()
          .then((r) => r[0]),
      ),
    update: adminProcedure
      .input(
        z.object({
          id: z.number().int(),
          personId: z.number().int(),
          projectionYear: z.number().int().min(1900).max(2100),
          overrideSalary: zDecimal,
          contributionProfileId: z.number().int().nullable().optional(),
          salaryProfileId: z.number().int().nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.retirementSalaryOverrides)
          .set({ ...data, updatedBy: getSessionUserLabel(ctx.session) })
          .where(eq(schema.retirementSalaryOverrides.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.retirementSalaryOverrides)
          .where(eq(schema.retirementSalaryOverrides.id, input.id)),
      ),
  }),

  retirementBudgetOverrides: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.retirementBudgetOverrides)
        .orderBy(asc(schema.retirementBudgetOverrides.projectionYear)),
    ),
    create: adminProcedure
      .input(
        z.object({
          personId: z.number().int(),
          projectionYear: z.number().int().min(1900).max(2100),
          overrideMonthlyBudget: zDecimal,
          notes: z.string().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.retirementBudgetOverrides)
          .values({ ...input, createdBy: getSessionUserLabel(ctx.session) })
          .returning()
          .then((r) => r[0]),
      ),
    update: adminProcedure
      .input(
        z.object({
          id: z.number().int(),
          personId: z.number().int(),
          projectionYear: z.number().int().min(1900).max(2100),
          overrideMonthlyBudget: zDecimal,
          notes: z.string().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.retirementBudgetOverrides)
          .set({ ...data, updatedBy: getSessionUserLabel(ctx.session) })
          .where(eq(schema.retirementBudgetOverrides.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.retirementBudgetOverrides)
          .where(eq(schema.retirementBudgetOverrides.id, input.id)),
      ),
  }),

  projectionOverrides: createTRPCRouter({
    get: protectedProcedure
      .input(
        z.object({
          overrideType: z.enum(["accumulation", "decumulation", "brokerage"]),
        }),
      )
      .query(({ ctx, input }) =>
        ctx.db
          .select()
          .from(schema.projectionOverrides)
          .where(
            eq(schema.projectionOverrides.overrideType, input.overrideType),
          )
          .then((r) => (r[0]?.overrides as Record<string, unknown>[]) ?? []),
      ),
    save: brokerageProcedure
      .input(
        z.object({
          overrideType: z.enum(["accumulation", "decumulation", "brokerage"]),
          overrides: z.array(z.record(z.string(), z.unknown())),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.projectionOverrides)
          .values({
            overrideType: input.overrideType,
            overrides: input.overrides,
            createdBy: getSessionUserLabel(ctx.session),
          })
          .onConflictDoUpdate({
            target: schema.projectionOverrides.overrideType,
            set: {
              overrides: input.overrides,
              updatedBy: getSessionUserLabel(ctx.session),
            },
          })
          .returning()
          .then((r) => r[0]),
      ),
    clear: brokerageProcedure
      .input(
        z.object({
          overrideType: z.enum(["accumulation", "decumulation", "brokerage"]),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.projectionOverrides)
          .where(
            eq(schema.projectionOverrides.overrideType, input.overrideType),
          ),
      ),
  }),

  // retirementScenarios CRUD removed.
  // It had ZERO UI callers while the table it wrote was read on every engine
  // build, so it could silently change every projection with no way to see
  // or undo it. The four distribution tax rates it carried now live on
  // retirement_settings and are read from there; leaving a writable router
  // pointed at the now-ignored columns would be a second, invisible answer
  // to "what drives my projection" — the exact thing this work removes.
  //
  // The TABLE survives for now: retirement.ts's relocation comparison still
  // reads its withdrawal_rate, which is deliberately NOT relocated (see the
  // schema docblock — retirement_settings.withdrawal_rate already exists and
  // collapsing the two is a user-visible change needing its own commit).

  /**
   * Retirement Profiles CRUD (Retirement Profiles step D — "multiple
   * profiles + the Plan field"). Each profile is a COMPLETE WORLD: no
   * baseline, no default, no inheritance, no merge at read time — same
   * contract Salary Profiles already state. `duplicate` is the one creation
   * path (no bare `create`): retirement_settings has ~40 columns, many
   * NOT NULL with no sensible blank default, so every new profile starts as
   * a clone of an existing one, matching the plan's own recommendation that
   * "duplicate to compare" be the primary action.
   *
   * adminProcedure throughout, matching retirementSettings.upsert's existing
   * gate — CONTRIBUTING.md Composed Router Convention: an inconsistent procedure type within
   * one group is a bug, not a design choice.
   */
  retirementProfiles: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.retirementProfiles)
        .orderBy(asc(schema.retirementProfiles.id)),
    ),

    /** Clone a profile's per-person rows into a new profile (profile-lifecycle.ts). */
    duplicate: adminProcedure
      .input(
        z.object({
          sourceProfileId: z.number().int(),
          name: z.string().min(1).max(100),
          description: z.string().max(500).optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        duplicateProfile(ctx.db, "retirement", input),
      ),

    /** Rename / re-describe a profile, or pin its tax-law year. Household/
     *  per-person assumptions themselves are edited through
     *  retirementSettings.upsert, scoped to whichever profile is active —
     *  not here. taxParamsYear lives on retirement_profiles itself:
     *  null (default) tracks the latest enacted tax data; a real year pins
     *  resolveTaxParams's base year so re-opening this profile reproduces
     *  its numbers instead of re-pricing under whatever year is newest. */
    update: adminProcedure
      .input(
        z.object({
          id: z.number().int(),
          name: z.string().min(1).max(100).optional(),
          description: z.string().max(500).nullish(),
          taxParamsYear: z.number().int().min(2000).max(2100).nullish(),
        }),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.retirementProfiles)
          .set(data)
          .where(eq(schema.retirementProfiles.id, id))
          .returning()
          .then((r) => r[0]),
      ),

    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        deleteProfile(ctx.db, "retirement", input.id),
      ),
  }),

  returnRates: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.returnRateTable)
        .orderBy(asc(schema.returnRateTable.age)),
    ),
    upsert: adminProcedure.input(returnRateInput).mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(schema.returnRateTable)
          .where(eq(schema.returnRateTable.age, input.age));
        const row =
          existing.length > 0
            ? await tx
                .update(schema.returnRateTable)
                .set(input)
                .where(eq(schema.returnRateTable.age, input.age))
                .returning()
                .then((r) => r[0])
            : await tx
                .insert(schema.returnRateTable)
                .values(input)
                .returning()
                .then((r) => r[0]);
        await collapseReturnRates(tx);
        return row;
      }),
    ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db.transaction(async (tx) => {
          await tx
            .delete(schema.returnRateTable)
            .where(eq(schema.returnRateTable.id, input.id));
          await collapseReturnRates(tx);
        }),
      ),
  }),
});
