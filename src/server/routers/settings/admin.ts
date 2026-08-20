import { z } from "zod/v4";
import { eq, asc, desc } from "drizzle-orm";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
  scenarioProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { log } from "@/lib/logger";
import { invalidateYearEndCache } from "@/server/helpers";
import {
  ALL_PERMISSIONS,
  RBAC_SETTINGS_PREFIX,
  RBAC_ADMIN_GROUP_KEY,
} from "@/server/auth";
import { getAccountTypeConfig } from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";
import { settingValue } from "./_shared";
import {
  apiConfigSchema,
  accountMappingSchema,
  scenarioOverridesSchema,
} from "@/lib/db/json-schemas";

// --- Zod schemas ---

const appSettingInput = z.object({
  key: z.string().min(1),
  value: settingValue,
});

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
    return {
      balanceDate: latestSnapshot[0]?.snapshotDate ?? null,
      performanceDate: (perfSetting[0]?.value as string) ?? null,
    };
  }),

  updateDataFreshness: adminProcedure
    .input(
      z.object({
        balanceDate: z.string().optional(),
        performanceDate: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.balanceDate) {
        // Update the most recent portfolio snapshot date
        const latest = await ctx.db
          .select({ id: schema.portfolioSnapshots.id })
          .from(schema.portfolioSnapshots)
          .orderBy(desc(schema.portfolioSnapshots.snapshotDate))
          .limit(1);
        if (latest[0]) {
          await ctx.db
            .update(schema.portfolioSnapshots)
            .set({ snapshotDate: input.balanceDate })
            .where(eq(schema.portfolioSnapshots.id, latest[0].id));
        }
      }
      if (input.performanceDate) {
        await ctx.db
          .insert(schema.appSettings)
          .values({
            key: "performance_last_updated",
            value: input.performanceDate,
          })
          .onConflictDoUpdate({
            target: schema.appSettings.key,
            set: { value: input.performanceDate },
          });
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
        // value column is NOT NULL — when null, delete the row so the default applies
        if (input.value === null || input.value === undefined) {
          await ctx.db
            .delete(schema.appSettings)
            .where(eq(schema.appSettings.key, input.key));
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
        // Invalidate year-end cache when settings change (e.g. salary averaging toggle)
        invalidateYearEndCache();
        return result;
      }),
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

      const permissions = ALL_PERMISSIONS.map((perm) => {
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

  // ══ SCENARIOS (global what-if system) ══
  scenarios: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db.select().from(schema.scenarios).orderBy(asc(schema.scenarios.id)),
    ),
    create: scenarioProcedure
      .input(
        z.object({
          name: z.string().min(1),
          description: z.string().nullable().optional(),
          overrides: scenarioOverridesSchema.default({}),
          budgetProfileId: z.number().int().nullable().optional(),
          contributionProfileId: z.number().int().nullable().optional(),
          salaryProfileId: z.number().int().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.scenarios)
          .values(input)
          .returning()
          .then((r) => r[0]),
      ),
    update: scenarioProcedure
      .input(
        z.object({
          id: z.number().int(),
          name: z.string().min(1).optional(),
          description: z.string().nullable().optional(),
          overrides: scenarioOverridesSchema.optional(),
          budgetProfileId: z.number().int().nullable().optional(),
          contributionProfileId: z.number().int().nullable().optional(),
          salaryProfileId: z.number().int().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.scenarios)
          .set({ ...data, updatedAt: new Date() })
          .where(eq(schema.scenarios.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    /** Pin (or clear, with null) which Budget Profile is "active" when this Plan is selected. */
    setBudgetProfilePin: scenarioProcedure
      .input(
        z.object({
          id: z.number().int(),
          budgetProfileId: z.number().nullable(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .update(schema.scenarios)
          .set({
            budgetProfileId: input.budgetProfileId,
            updatedAt: new Date(),
          })
          .where(eq(schema.scenarios.id, input.id))
          .returning()
          .then((r) => r[0]),
      ),
    /** Pin (or clear, with null) which Contribution Profile is "active" when this Plan is selected. */
    setContributionProfilePin: scenarioProcedure
      .input(
        z.object({
          id: z.number().int(),
          contributionProfileId: z.number().nullable(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .update(schema.scenarios)
          .set({
            contributionProfileId: input.contributionProfileId,
            updatedAt: new Date(),
          })
          .where(eq(schema.scenarios.id, input.id))
          .returning()
          .then((r) => r[0]),
      ),
    /** Pin (or clear, with null) which Salary Profile is "active" when this Plan is selected. */
    setSalaryProfilePin: scenarioProcedure
      .input(
        z.object({
          id: z.number().int(),
          salaryProfileId: z.number().nullable(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .update(schema.scenarios)
          .set({
            salaryProfileId: input.salaryProfileId,
            updatedAt: new Date(),
          })
          .where(eq(schema.scenarios.id, input.id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: scenarioProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.scenarios)
          .where(eq(schema.scenarios.id, input.id)),
      ),
    /** Update a single override within a scenario's overrides JSONB */
    setOverride: scenarioProcedure
      .input(
        z.object({
          id: z.number().int(),
          entity: z.string(),
          recordId: z.string(),
          field: z.string(),
          value: settingValue,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Wrapped in a transaction so the read-modify-write of the JSONB
        // overrides column is atomic. (No FOR UPDATE — was never actually
        // added despite an earlier comment claiming it; SQLite has no
        // equivalent and relies on single-writer semantics elsewhere in
        // this codebase, so the transaction boundary alone is consistent
        // with that pattern.)
        return ctx.db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(schema.scenarios)
            .where(eq(schema.scenarios.id, input.id));
          if (!existing) throw new Error("Scenario not found");
          const overrides = (existing.overrides ?? {}) as Record<
            string,
            Record<string, Record<string, unknown>>
          >;
          if (!overrides[input.entity]) overrides[input.entity] = {};
          if (!overrides[input.entity]![input.recordId])
            overrides[input.entity]![input.recordId] = {};
          overrides[input.entity]![input.recordId]![input.field] = input.value;
          return tx
            .update(schema.scenarios)
            .set({ overrides, updatedAt: new Date() })
            .where(eq(schema.scenarios.id, input.id))
            .returning()
            .then((r) => r[0]);
        });
      }),
    /** Remove a single override from a scenario */
    clearOverride: scenarioProcedure
      .input(
        z.object({
          id: z.number().int(),
          entity: z.string(),
          recordId: z.string(),
          field: z.string(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Wrapped in a transaction so the read-modify-write of the JSONB
        // overrides column is atomic. (No FOR UPDATE — was never actually
        // added despite an earlier comment claiming it; SQLite has no
        // equivalent and relies on single-writer semantics elsewhere in
        // this codebase, so the transaction boundary alone is consistent
        // with that pattern.)
        return ctx.db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(schema.scenarios)
            .where(eq(schema.scenarios.id, input.id));
          if (!existing) throw new Error("Scenario not found");
          const overrides = (existing.overrides ?? {}) as Record<
            string,
            Record<string, Record<string, unknown>>
          >;
          delete overrides[input.entity]?.[input.recordId]?.[input.field];
          // Clean up empty branches
          if (
            overrides[input.entity]?.[input.recordId] &&
            Object.keys(overrides[input.entity]![input.recordId]!).length === 0
          ) {
            delete overrides[input.entity]![input.recordId];
          }
          if (
            overrides[input.entity] &&
            Object.keys(overrides[input.entity]!).length === 0
          ) {
            delete overrides[input.entity];
          }
          return tx
            .update(schema.scenarios)
            .set({ overrides, updatedAt: new Date() })
            .where(eq(schema.scenarios.id, input.id))
            .returning()
            .then((r) => r[0]);
        });
      }),
  }),

  // ══ API CONNECTIONS ══
  apiConnections: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.apiConnections)
        .orderBy(asc(schema.apiConnections.service)),
    ),
    upsert: adminProcedure
      .input(
        z.object({
          service: z.string().min(1),
          config: apiConfigSchema,
          accountMappings: z.array(accountMappingSchema).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const existing = await ctx.db
          .select()
          .from(schema.apiConnections)
          .where(eq(schema.apiConnections.service, input.service));
        if (existing.length > 0) {
          return ctx.db
            .update(schema.apiConnections)
            .set(input)
            .where(eq(schema.apiConnections.service, input.service))
            .returning()
            .then((r) => r[0]);
        }
        return ctx.db
          .insert(schema.apiConnections)
          .values(input)
          .returning()
          .then((r) => r[0]);
      }),
    delete: adminProcedure
      .input(z.object({ service: z.string().min(1) }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.apiConnections)
          .where(eq(schema.apiConnections.service, input.service)),
      ),
  }),

  // ══ RELOCATION SCENARIOS ══
  // ══ BACKFILL PERFORMANCE ACCOUNT IDS ══
  backfillPerformanceAccountIds: adminProcedure
    .input(
      z.object({ dryRun: z.boolean().optional().default(false) }).optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const dryRun = input?.dryRun ?? false;
      const [allContribs, allPerfAccounts, allPeople] = await Promise.all([
        ctx.db.select().from(schema.contributionAccounts),
        ctx.db.select().from(schema.performanceAccounts),
        ctx.db.select().from(schema.people),
      ]);

      const peopleMap = new Map(allPeople.map((p) => [p.id, p]));
      const needsBackfill = allContribs.filter(
        (c) => c.performanceAccountId === null,
      );

      let updated = 0;
      const unmatched: string[] = [];
      const matches: {
        contribAccountId: number;
        performanceAccountId: number;
        description: string;
      }[] = [];

      for (const contrib of needsBackfill) {
        const person =
          contrib.personId != null
            ? peopleMap.get(contrib.personId)
            : undefined;
        const personName = person?.name?.toLowerCase() ?? "";
        const display = getAccountTypeConfig(
          contrib.accountType as AccountCategory,
        );
        const typeLabel =
          display?.displayLabel?.toLowerCase() ??
          contrib.accountType.toLowerCase();

        const match = allPerfAccounts.find((pa) => {
          const labelLower = (pa.accountLabel ?? "").toLowerCase();
          return (
            labelLower.includes(typeLabel) &&
            (pa.ownerPersonId === contrib.personId ||
              // Guard against personName being "" (joint contrib /
              // unresolved person) — String.includes("") is always true,
              // which would otherwise match this contrib to ANY performance
              // account of the right type regardless of actual ownership.
              (personName !== "" && labelLower.includes(personName)))
          );
        });

        if (match) {
          matches.push({
            contribAccountId: contrib.id,
            performanceAccountId: match.id,
            description: `contrib_account id=${contrib.id} (${contrib.accountType}, person=${person?.name ?? contrib.personId}) -> performance_account id=${match.id} (${match.accountLabel})`,
          });
          if (!dryRun) {
            await ctx.db
              .update(schema.contributionAccounts)
              .set({ performanceAccountId: match.id })
              .where(eq(schema.contributionAccounts.id, contrib.id));
          }
          updated++;
        } else {
          const desc = `contrib_account id=${contrib.id} (${contrib.accountType}, person=${person?.name ?? contrib.personId})`;
          unmatched.push(desc);
          log("warn", "admin_backfill_perf_id_unmatched", {
            description: desc,
          });
        }
      }

      return {
        dryRun,
        updated,
        matches,
        unmatched,
        alreadyLinked: allContribs.length - needsBackfill.length,
      };
    }),
};
