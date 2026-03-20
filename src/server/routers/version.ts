import { z } from "zod";
import { eq, sql, desc } from "drizzle-orm";
import {
  createTRPCRouter,
  adminProcedure,
  protectedProcedure,
  versionProcedure,
} from "../trpc";
import * as schema from "@/lib/db/schema";
import { createVersion, restoreVersion } from "@/lib/db/version-logic";

export const versionRouter = createTRPCRouter({
  /** List all versions (metadata only, no JSONB data). */
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: schema.stateVersions.id,
        name: schema.stateVersions.name,
        description: schema.stateVersions.description,
        versionType: schema.stateVersions.versionType,
        schemaVersion: schema.stateVersions.schemaVersion,
        tableCount: schema.stateVersions.tableCount,
        totalRows: schema.stateVersions.totalRows,
        sizeEstimateBytes: schema.stateVersions.sizeEstimateBytes,
        createdAt: schema.stateVersions.createdAt,
        createdBy: schema.stateVersions.createdBy,
      })
      .from(schema.stateVersions)
      .orderBy(desc(schema.stateVersions.createdAt));
  }),

  /** Get a single version with per-table row counts (no JSONB data). */
  getById: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const [version] = await ctx.db
        .select()
        .from(schema.stateVersions)
        .where(eq(schema.stateVersions.id, input.id));

      if (!version) return null;

      const tables = await ctx.db
        .select({
          tableName: schema.stateVersionTables.tableName,
          rowCount: schema.stateVersionTables.rowCount,
        })
        .from(schema.stateVersionTables)
        .where(eq(schema.stateVersionTables.versionId, input.id));

      return { ...version, tables };
    }),

  /** Preview first 50 rows of a specific table from a version. */
  getPreview: protectedProcedure
    .input(z.object({ versionId: z.number().int(), tableName: z.string() }))
    .query(async ({ ctx, input }) => {
      const [tableData] = await ctx.db
        .select()
        .from(schema.stateVersionTables)
        .where(
          sql`${schema.stateVersionTables.versionId} = ${input.versionId} AND ${schema.stateVersionTables.tableName} = ${input.tableName}`,
        );

      if (!tableData) return { rows: [], rowCount: 0 };

      const allRows = tableData.data as unknown[];
      return {
        rows: allRows.slice(0, 50),
        rowCount: tableData.rowCount,
      };
    }),

  /** Create a new manual version. */
  create: versionProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return createVersion(ctx.db, {
        name: input.name,
        description: input.description,
        type: "manual",
        createdBy: ctx.session.user.name ?? ctx.session.user.email ?? "unknown",
      });
    }),

  /** Restore from a version. */
  restore: versionProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      return restoreVersion(ctx.db, input.id);
    }),

  /** Delete a version. */
  delete: versionProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(schema.stateVersions)
        .where(eq(schema.stateVersions.id, input.id));
      return { ok: true };
    }),

  /** Read retention setting. */
  getRetention: protectedProcedure.query(async ({ ctx }) => {
    const settings = await ctx.db.select().from(schema.appSettings);
    const setting = settings.find((s) => s.key === "version_retention_count");
    return {
      retentionCount: typeof setting?.value === "number" ? setting.value : 30,
    };
  }),

  /** Update retention setting and trigger cleanup. */
  setRetention: versionProcedure
    .input(z.object({ count: z.number().int().min(1).max(365) }))
    .mutation(async ({ ctx, input }) => {
      // Upsert the setting
      await ctx.db
        .insert(schema.appSettings)
        .values({ key: "version_retention_count", value: input.count })
        .onConflictDoUpdate({
          target: schema.appSettings.key,
          set: { value: input.count },
        });

      // Trigger cleanup of auto versions beyond new retention
      const autoVersions = await ctx.db
        .select({ id: schema.stateVersions.id })
        .from(schema.stateVersions)
        .where(eq(schema.stateVersions.versionType, "auto"))
        .orderBy(desc(schema.stateVersions.createdAt));

      if (autoVersions.length > input.count) {
        const toDelete = autoVersions.slice(input.count);
        for (const v of toDelete) {
          await ctx.db
            .delete(schema.stateVersions)
            .where(eq(schema.stateVersions.id, v.id));
        }
      }

      return { ok: true, retentionCount: input.count };
    }),

  /** Read auto-version schedule setting. */
  getSchedule: protectedProcedure.query(async ({ ctx }) => {
    const settings = await ctx.db.select().from(schema.appSettings);
    const scheduleSetting = settings.find(
      (s) => s.key === "version_auto_schedule",
    );
    const cronSetting = settings.find((s) => s.key === "version_auto_cron");
    return {
      schedule:
        typeof scheduleSetting?.value === "string"
          ? scheduleSetting.value
          : "daily",
      cronExpression:
        typeof cronSetting?.value === "string"
          ? cronSetting.value
          : "0 2 * * *",
    };
  }),

  /** Update auto-version schedule. */
  setSchedule: versionProcedure
    .input(
      z.object({
        schedule: z.enum(["off", "daily", "weekly", "monthly", "custom"]),
        cronExpression: z.string().max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(schema.appSettings)
        .values({ key: "version_auto_schedule", value: input.schedule })
        .onConflictDoUpdate({
          target: schema.appSettings.key,
          set: { value: input.schedule },
        });

      // Save custom cron expression if provided
      if (input.cronExpression) {
        await ctx.db
          .insert(schema.appSettings)
          .values({ key: "version_auto_cron", value: input.cronExpression })
          .onConflictDoUpdate({
            target: schema.appSettings.key,
            set: { value: input.cronExpression },
          });
      }

      return { ok: true, schedule: input.schedule };
    }),

  /** Reset all user data — truncates every table except state_versions and app_settings. */
  resetAllData: adminProcedure
    .input(z.object({ confirmation: z.literal("delete") }))
    .mutation(async ({ ctx }) => {
      // Get all public tables
      const { listTablesSQL, truncateTables } = await import("@/lib/db/compat");
      const tables = await ctx.db.execute<{ tablename: string }>(
        listTablesSQL(),
      );

      // Tables to preserve (versioning system + app config)
      const preserve = new Set([
        "state_versions",
        "state_version_tables",
        "app_settings",
      ]);

      // Truncate all user data tables
      const toTruncate = tables.rows
        .map((r) => r.tablename)
        .filter((t) => !preserve.has(t));

      if (toTruncate.length > 0) {
        await truncateTables(ctx.db, toTruncate);
      }

      return { ok: true, tablesCleared: toTruncate.length };
    }),
});
