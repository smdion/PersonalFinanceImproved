import {
  SK_SIMULATION_PRESET,
  SK_TAX_FILING_STATUS,
} from "@/lib/constants/settings-keys";
import { returnFilingStatusSchema } from "@/lib/config/filing-status.schema";
import { z } from "zod/v4";
import {
  parseCurrentGlidePath,
  unknownAssetClassIds,
} from "@/lib/pure/simulation/current-glide-path";
import { TRPCError } from "@trpc/server";
import { eq, asc, desc } from "drizzle-orm";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
  scenarioProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  SK_HOUSEHOLD_TIMEZONE,
  SK_MILESTONE_CHECKLIST,
  SK_MILESTONE_FIRST_REACHED,
  SK_MILESTONE_CHECKPOINT_SOURCE,
  SK_MILESTONE_CUSTOM_GOALS,
  SK_MILESTONE_SAVINGS_TARGET_SOURCE,
  SK_RECOMMENDATION_DISMISSALS,
  SK_CURRENT_GLIDE_PATH,
  SK_ROTH_IRA_DIRECT_MARGIN,
  SK_HSA_CASH_BUFFER,
} from "@/lib/constants/settings-keys";
import { currentGlidePathSchema } from "@/lib/pure/simulation/current-glide-path";
import {
  dismissalIdSchema,
  dismissalSchema,
  dismissalsSchema,
  nextDismissals,
  parseDismissals,
} from "@/lib/pure/advice/recommendation-dismissals";
import { isCalendarDate } from "@/lib/utils/date";
import {
  checkpointSourceSchema,
  customGoalsSchema,
  milestoneChecklistSchema,
  savingsTargetSourceSchema,
} from "@/lib/pure/advice/milestones/milestones";
import {
  applyHouseholdTimeZone,
  isValidTimeZone,
} from "@/server/data/household-timezone";
import { invalidateYearEndCache } from "@/server/services/net-worth/year-end-history";
import { RBAC_SETTINGS_PREFIX, RBAC_ADMIN_GROUP_KEY } from "@/server/auth";
import { PERMISSIONS } from "@/lib/config/permissions";
import { settingValue } from "./_shared";
import { applyPlan } from "@/server/services/profiles/plans";
import { firstReachedSchema } from "@/lib/pure/advice/milestone-first-reached";
import { SIMULATION_PRESET_KEYS } from "@/lib/constants";
import type { Db } from "@/lib/db";
import { mergeSettingAtomically, upsertSetting } from "@/server/data/settings";

// --- Zod schemas ---

const appSettingInput = z.object({
  key: z.string().min(1),
  value: settingValue,
});

/** Settings whose value has a shape: checked on every write, so a bad save
 *  is refused instead of read back later as empty. */
const STRUCTURED_SETTINGS: Record<string, z.ZodType> = {
  [SK_TAX_FILING_STATUS]: returnFilingStatusSchema,
  [SK_SIMULATION_PRESET]: z.enum(SIMULATION_PRESET_KEYS),
  [SK_MILESTONE_CUSTOM_GOALS]: customGoalsSchema,
  [SK_MILESTONE_CHECKLIST]: milestoneChecklistSchema,
  [SK_MILESTONE_FIRST_REACHED]: firstReachedSchema,
  [SK_MILESTONE_CHECKPOINT_SOURCE]: checkpointSourceSchema,
  [SK_MILESTONE_SAVINGS_TARGET_SOURCE]: savingsTargetSourceSchema,
  [SK_RECOMMENDATION_DISMISSALS]: dismissalsSchema,
  [SK_CURRENT_GLIDE_PATH]: currentGlidePathSchema,
  [SK_ROTH_IRA_DIRECT_MARGIN]: z.number().finite().nonnegative(),
  [SK_HSA_CASH_BUFFER]: z.number().finite().nonnegative(),
};

const planName = z.string().trim().min(1).max(100);

/** A Plan holds one profile of every kind. */
const planProfileIdsInput = z.object({
  salaryProfileId: z.number().int(),
  contributionProfileId: z.number().int(),
  budgetProfileId: z.number().int(),
  retirementProfileId: z.number().int(),
});

/** Plan names are unique, like profile names. */
async function assertPlanNameFree(
  db: Db,
  name: string,
  exceptId?: number,
): Promise<void> {
  const [clash] = await db
    .select({ id: schema.scenarios.id })
    .from(schema.scenarios)
    .where(eq(schema.scenarios.name, name));
  if (clash && clash.id !== exceptId)
    throw new TRPCError({
      code: "CONFLICT",
      message: `A Plan named "${name}" already exists.`,
    });
}

// --- Procedures ---

export const adminProcedures = {
  // ══ DATA FRESHNESS ══
  getDataFreshness: protectedProcedure.query(async ({ ctx }) => {
    const latestSnapshot = await ctx.db
      .select({ snapshotDate: schema.portfolioSnapshots.snapshotDate })
      .from(schema.portfolioSnapshots)
      .orderBy(desc(schema.portfolioSnapshots.snapshotDate))
      .limit(1);
    const perfSetting = await ctx.db
      .select({ value: schema.appSettings.value })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, "performance_last_updated"));
    const basisSetting = await ctx.db
      .select({ value: schema.appSettings.value })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, "basis_last_updated"));
    return {
      balanceDate: latestSnapshot[0]?.snapshotDate ?? null,
      performanceDate: (perfSetting[0]?.value as string) ?? null,
      basisDate: (basisSetting[0]?.value as string) ?? null,
    };
  }),

  updateDataFreshness: adminProcedure
    .input(
      z.object({
        balanceDate: z
          .string()
          .refine(isCalendarDate, "Not a date (YYYY-MM-DD)")
          .optional(),
        performanceDate: z.string().optional(),
        basisDate: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.balanceDate) {
        // Update the most recent portfolio snapshot date
        const [latest, previous] = await ctx.db
          .select({
            id: schema.portfolioSnapshots.id,
            snapshotDate: schema.portfolioSnapshots.snapshotDate,
          })
          .from(schema.portfolioSnapshots)
          .orderBy(desc(schema.portfolioSnapshots.snapshotDate))
          .limit(2);
        // The latest stays the latest and in its own year: anything else
        // collides with another snapshot or leaves a year's Performance
        // figures derived from a snapshot that moved away.
        if (latest && previous && input.balanceDate <= previous.snapshotDate)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Must be after the previous snapshot (${previous.snapshotDate})`,
          });
        if (
          latest &&
          input.balanceDate.slice(0, 4) !== latest.snapshotDate.slice(0, 4)
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Must stay in ${latest.snapshotDate.slice(0, 4)} — create a new snapshot for another year`,
          });
        if (latest) {
          await ctx.db
            .update(schema.portfolioSnapshots)
            .set({ snapshotDate: input.balanceDate })
            .where(eq(schema.portfolioSnapshots.id, latest.id));
        }
      }
      if (input.performanceDate) {
        await upsertSetting(
          ctx.db,
          "performance_last_updated",
          input.performanceDate,
        );
      }
      if (input.basisDate) {
        await upsertSetting(ctx.db, "basis_last_updated", input.basisDate);
      }
      return { ok: true };
    }),

  // ══ APP SETTINGS ══
  appSettings: createTRPCRouter({
    list: protectedProcedure.query(async ({ ctx }) => {
      const rows = await ctx.db
        .select()
        .from(schema.appSettings)
        .orderBy(asc(schema.appSettings.key));
      // Non-admin users shouldn't see RBAC configuration
      if (ctx.session?.user?.role !== "admin") {
        return rows.filter(
          (r) =>
            !r.key.startsWith(RBAC_SETTINGS_PREFIX) &&
            r.key !== RBAC_ADMIN_GROUP_KEY,
        );
      }
      return rows;
    }),
    upsert: adminProcedure
      .input(appSettingInput)
      .mutation(async ({ ctx, input }) => {
        const isTimeZone = input.key === SK_HOUSEHOLD_TIMEZONE;
        if (isTimeZone && input.value != null && !isValidTimeZone(input.value))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Not a recognized time zone",
          });
        const shape = STRUCTURED_SETTINGS[input.key];
        if (shape && input.value != null) {
          const parsed = shape.safeParse(input.value);
          if (!parsed.success)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Invalid ${input.key}: ${parsed.error.issues[0]?.message ?? "bad value"}`,
            });
        }
        if (input.key === SK_CURRENT_GLIDE_PATH && input.value != null) {
          const active = await ctx.db
            .select({ id: schema.assetClassParams.id })
            .from(schema.assetClassParams)
            .where(eq(schema.assetClassParams.isActive, true));
          const path = parseCurrentGlidePath(input.value);
          if (
            path &&
            unknownAssetClassIds(path, new Set(active.map((c) => c.id)))
              .length > 0
          )
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "The glide path uses an asset class that doesn't exist (or is turned off)",
            });
        }
        // value column is NOT NULL — when null, delete the row so the default applies
        if (input.value === null || input.value === undefined) {
          await ctx.db
            .delete(schema.appSettings)
            .where(eq(schema.appSettings.key, input.key));
          if (isTimeZone) applyHouseholdTimeZone(null);
          return null;
        }
        const result = await ctx.db
          .insert(schema.appSettings)
          .values(input)
          .onConflictDoUpdate({
            target: schema.appSettings.key,
            set: { value: input.value },
          })
          .returning()
          .then((r) => r[0]);
        // Server date math moves to the new zone right away.
        if (isTimeZone) applyHouseholdTimeZone(input.value);
        // Invalidate year-end cache when settings change (e.g. salary averaging toggle)
        invalidateYearEndCache();
        return result;
      }),
    /** Dismiss, snooze or restore one recommendation (merged on the
     *  server, so two admins changing different items both stick). */
    setDismissal: adminProcedure
      .input(
        z.object({
          id: dismissalIdSchema,
          value: dismissalSchema.nullable(),
        }),
      )
      .mutation(({ ctx, input }) =>
        mergeSettingAtomically(ctx.db, SK_RECOMMENDATION_DISMISSALS, (stored) =>
          nextDismissals(parseDismissals(stored), ctx.scope.today, input),
        ),
      ),
    delete: adminProcedure
      .input(z.object({ key: z.string() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.appSettings)
          .where(eq(schema.appSettings.key, input.key)),
      ),
  }),

  // ══ RBAC GROUP MAPPING ══
  rbacGroups: createTRPCRouter({
    /** Get current RBAC group mapping (DB overrides merged with defaults). */
    get: adminProcedure.query(async ({ ctx }) => {
      const settings = await ctx.db.select().from(schema.appSettings);
      const map = new Map(settings.map((s) => [s.key, s.value]));

      const adminGroup =
        (typeof map.get(RBAC_ADMIN_GROUP_KEY) === "string"
          ? (map.get(RBAC_ADMIN_GROUP_KEY) as string)
          : null) || "ledgr-admin";

      const permissions = PERMISSIONS.map((perm) => {
        const override = map.get(`${RBAC_SETTINGS_PREFIX}${perm}`);
        return {
          permission: perm,
          group:
            (typeof override === "string" ? override : null) || `ledgr-${perm}`,
          isCustom: typeof override === "string",
        };
      });

      return {
        adminGroup,
        isAdminCustom: typeof map.get(RBAC_ADMIN_GROUP_KEY) === "string",
        permissions,
      };
    }),
  }),

  // ══ PLANS (a named set of profiles — see server/services/profiles/plans.ts) ══
  scenarios: createTRPCRouter({
    /** Every saved Plan. */
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db.select().from(schema.scenarios).orderBy(asc(schema.scenarios.id)),
    ),
    /** Save a set of profiles as a Plan — all four kinds, by name. */
    create: scenarioProcedure
      .input(
        z.object({
          name: planName,
          description: z.string().nullable().optional(),
          ...planProfileIdsInput.shape,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await assertPlanNameFree(ctx.db, input.name);
        return ctx.db
          .insert(schema.scenarios)
          .values(input)
          .returning()
          .then((r) => r[0]);
      }),
    /** Rename a Plan or change which profiles it holds. */
    update: scenarioProcedure
      .input(
        z.object({
          id: z.number().int(),
          name: planName.optional(),
          description: z.string().nullable().optional(),
          ...planProfileIdsInput.partial().shape,
        }),
      )
      .mutation(async ({ ctx, input: { id, ...data } }) => {
        if (data.name !== undefined)
          await assertPlanNameFree(ctx.db, data.name, id);
        return ctx.db
          .update(schema.scenarios)
          .set({ ...data, updatedAt: new Date() })
          .where(eq(schema.scenarios.id, id))
          .returning()
          .then((r) => r[0]);
      }),
    /** Make this Plan's profiles the active ones, household-wide (applyPlan). */
    activate: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        await applyPlan(ctx.db, ctx.session.user, input.id);
        await invalidateYearEndCache();
        return { ok: true };
      }),
    delete: scenarioProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.scenarios)
          .where(eq(schema.scenarios.id, input.id)),
      ),
  }),

  // ══ API CONNECTIONS ══
  apiConnections: createTRPCRouter({
    /** Admin-only, and never returns `config`: it holds credentials
     *  (encrypted envelopes, or plaintext for legacy rows such as FMP).
     *  Connections are written only through each integration's own save
     *  (sync), which encrypts, checks the URL and the mappings; a generic
     *  upsert that stored config in plaintext was removed. */
    list: adminProcedure.query(({ ctx }) =>
      ctx.db
        .select({
          id: schema.apiConnections.id,
          service: schema.apiConnections.service,
          accountMappings: schema.apiConnections.accountMappings,
          skippedCategoryIds: schema.apiConnections.skippedCategoryIds,
          linkedProfileId: schema.apiConnections.linkedProfileId,
          linkedColumnIndex: schema.apiConnections.linkedColumnIndex,
          serverKnowledge: schema.apiConnections.serverKnowledge,
          lastSyncedAt: schema.apiConnections.lastSyncedAt,
        })
        .from(schema.apiConnections)
        .orderBy(asc(schema.apiConnections.service)),
    ),
    delete: adminProcedure
      .input(z.object({ service: z.string().min(1) }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.apiConnections)
          .where(eq(schema.apiConnections.service, input.service)),
      ),
  }),
};
