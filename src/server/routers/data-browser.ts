/** Admin data browser router for inspecting database tables, columns, and row data with raw SQL queries against a whitelisted table set. */
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { createTRPCRouter, adminProcedure } from "../trpc";
import { VERSION_TABLE_NAMES, EXCLUDED_TABLES } from "@/lib/db/version-tables";
import { isPostgres } from "@/lib/db/dialect";
import { queryRaw } from "@/lib/db/compat";

/** All known table names (version tables + excluded tables like change_log). */
const KNOWN_TABLE_LIST = [...VERSION_TABLE_NAMES, ...EXCLUDED_TABLES];
const KNOWN_TABLES = new Set(KNOWN_TABLE_LIST);

/** Validate table name against whitelist to prevent SQL injection. */
function assertKnownTable(name: string): void {
  if (!KNOWN_TABLES.has(name)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unknown table: "${name}"`,
    });
  }
}

type ColumnInfo = {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
};

export const dataBrowserRouter = createTRPCRouter({
  /** List all known tables with row counts. */
  listTables: adminProcedure.query(async ({ ctx }) => {
    const results: { tableName: string; rowCount: number }[] = [];

    for (const name of KNOWN_TABLE_LIST) {
      try {
        const res = await queryRaw<{ count: string | number }>(
          ctx.db,
          sql.raw(`SELECT COUNT(*) AS count FROM "${name}"`),
        );
        const count = Number(res[0]?.count ?? 0);
        results.push({ tableName: name, rowCount: count });
      } catch {
        // Table might not exist yet (migration not run)
        results.push({ tableName: name, rowCount: -1 });
      }
    }

    return results.sort((a, b) => a.tableName.localeCompare(b.tableName));
  }),

  /** Get column metadata for a table. */
  getColumns: adminProcedure
    .input(z.object({ tableName: z.string() }))
    .query(async ({ ctx, input }) => {
      assertKnownTable(input.tableName);

      if (isPostgres()) {
        const res = await queryRaw<{
          column_name: string;
          data_type: string;
          is_nullable: string;
          column_default: string | null;
        }>(
          ctx.db,
          sql`SELECT column_name, data_type, is_nullable, column_default
              FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = ${input.tableName}
              ORDER BY ordinal_position`,
        );
        return res.map((r): ColumnInfo => ({
          name: r.column_name,
          type: r.data_type,
          nullable: r.is_nullable === "YES",
          defaultValue: r.column_default,
        }));
      }

      // SQLite
      const res = await queryRaw<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }>(ctx.db, sql.raw(`PRAGMA table_info("${input.tableName}")`));
      return res.map((r): ColumnInfo => ({
        name: r.name,
        type: r.type,
        nullable: r.notnull === 0,
        defaultValue: r.dflt_value,
      }));
    }),

  /** Get paginated rows from a table. */
  getRows: adminProcedure
    .input(
      z.object({
        tableName: z.string(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      assertKnownTable(input.tableName);

      const countRes = await queryRaw<{ count: string | number }>(
        ctx.db,
        sql`SELECT COUNT(*) AS count FROM ${sql.raw(`"${input.tableName}"`)}`,
      );
      const totalCount = Number(countRes[0]?.count ?? 0);

      const rows = await queryRaw<Record<string, unknown>>(
        ctx.db,
        sql`SELECT * FROM ${sql.raw(`"${input.tableName}"`)} ORDER BY 1 LIMIT ${input.limit} OFFSET ${input.offset}`,
      );

      return {
        rows,
        totalCount,
      };
    }),

  /** Export full table as JSON array. */
  exportTable: adminProcedure
    .input(z.object({ tableName: z.string() }))
    .query(async ({ ctx, input }) => {
      assertKnownTable(input.tableName);

      return queryRaw<Record<string, unknown>>(
        ctx.db,
        sql`SELECT * FROM ${sql.raw(`"${input.tableName}"`)} ORDER BY 1`,
      );
    }),
});
