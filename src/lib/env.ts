import { z } from "zod/v4";
import { getDialect } from "./db/dialect";

/**
 * Validates environment variables at startup. DATABASE_URL picks the database:
 * a postgres:// string → PostgreSQL; absent → SQLite at SQLITE_PATH.
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
  // Which proxy header names the client for rate limits (client-address.ts).
  TRUSTED_PROXY_HEADER: z
    .enum(["x-real-ip", "x-forwarded-for", "none"])
    .optional(),
  // Cron secret — optional but must be strong when set
  CRON_SECRET: z.string().min(32).optional(),
  // AES-256-GCM key for api_connections.config: 32 bytes base64 (44 chars).
  // Optional in dev; required in production by the check below.
  ENCRYPTION_KEY: z.string().optional(),
});

const pgSchema = baseSchema.extend({
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(["true", "false"]).optional(),
  DATABASE_POOL_MAX: z.string().regex(/^\d+$/).optional(),
});

const sqliteSchema = baseSchema.extend({
  SQLITE_PATH: z.string().optional(), // default: data/ledgr.db
});

type Env = z.infer<typeof pgSchema> & { SQLITE_PATH?: string };

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
  const env = result.data as Env;

  // Production-only invariants, checked at boot. Skipped during `next build`
  // (no runtime secrets) and in DEMO_ONLY, where demoOnlyGuard blocks every
  // non-demo mutation so no credentials land and health details aren't sensitive.
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
  const isDemoOnly = process.env.DEMO_ONLY === "true";
  if (process.env.NODE_ENV === "production" && !isBuildPhase && !isDemoOnly) {
    if (!env.CRON_SECRET) {
      throw new Error(
        "CRON_SECRET is required in production (32+ chars). Without it, " +
          "/api/health/detailed and other cron-authed endpoints accept " +
          "unauthenticated requests. Set CRON_SECRET to a strong random value.",
      );
    }
    if (process.env.ALLOW_DEV_MODE === "true") {
      throw new Error(
        "ALLOW_DEV_MODE=true is not permitted in production. The dev-mode " +
          "auth bypass is already disabled at runtime by trpc.ts, but this " +
          "check makes the misconfiguration loud instead of silently ignored. " +
          "Remove ALLOW_DEV_MODE from the container env.",
      );
    }
    if (!env.ENCRYPTION_KEY) {
      throw new Error(
        "ENCRYPTION_KEY is required in production. Without it, API " +
          "credentials in api_connections.config cannot be encrypted at rest. " +
          "Generate one with: " +
          'node -e \'console.log(require("crypto").randomBytes(32).toString("base64"))\'',
      );
    }
    // Validate length: must decode to exactly 32 bytes (44-char base64).
    try {
      const keyBytes = Buffer.from(env.ENCRYPTION_KEY, "base64").length;
      if (keyBytes !== 32) {
        throw new Error(
          `ENCRYPTION_KEY must decode to exactly 32 bytes (got ${keyBytes}). ` +
            "Regenerate with the command in CRON_SECRET error above.",
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("ENCRYPTION_KEY"))
        throw err;
      throw new Error(
        "ENCRYPTION_KEY is not valid base64. Regenerate with: " +
          'node -e \'console.log(require("crypto").randomBytes(32).toString("base64"))\'',
      );
    }
  }

  return env;
}

export const env = validateEnv();
