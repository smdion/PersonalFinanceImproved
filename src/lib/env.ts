import { z } from "zod/v4";
import { getDialect } from "./db/dialect";

/**
 * Validate required environment variables at startup.
 * Import this module early (e.g. in db/index.ts or layout.tsx) so
 * missing vars surface immediately rather than at first use.
 *
 * DATABASE_URL is the single control point for database selection:
 *   - Set to a postgres:// connection string → PostgreSQL
 *   - Absent → SQLite (file at SQLITE_PATH, default: data/ledgr.db)
 */

const baseSchema = z.object({
  DATABASE_URL: z.string().optional(),
  NEXTAUTH_SECRET: z.string().min(32),
  NEXTAUTH_URL: z.string().url().optional(),
  AUTH_TRUST_HOST: z.enum(["true", "false"]).optional(),
  // Auth provider — optional in dev, required in production
  AUTH_AUTHENTIK_ISSUER: z.string().url().optional(),
  AUTH_AUTHENTIK_ID: z.string().min(1).optional(),
  AUTH_AUTHENTIK_SECRET: z.string().min(1).optional(),
  // Cron secret — optional but must be strong when set
  CRON_SECRET: z.string().min(32).optional(),
});

const pgSchema = baseSchema.extend({
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(["true", "false"]).optional(),
  DATABASE_POOL_MAX: z.string().regex(/^\d+$/).optional(),
});

const sqliteSchema = baseSchema.extend({
  SQLITE_PATH: z.string().optional(), // default: data/ledgr.db
});

export type Env = z.infer<typeof pgSchema> & { SQLITE_PATH?: string };

function validateEnv(): Env {
  const schema = getDialect() === "postgresql" ? pgSchema : sqliteSchema;
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const formatted = z.prettifyError(result.error);
    console.error("❌ Invalid environment variables:\n", formatted);
    throw new Error(
      "Missing or invalid environment variables. See above for details.",
    );
  }
  return result.data as Env;
}

export const env = validateEnv();
