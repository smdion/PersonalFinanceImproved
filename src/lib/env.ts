import { z } from "zod/v4";

/**
 * Validate required environment variables at startup.
 * Import this module early (e.g. in db/index.ts or layout.tsx) so
 * missing vars surface immediately rather than at first use.
 */

const envSchema = z.object({
  DATABASE_HOST: z.string().min(1),
  DATABASE_PORT: z.string().regex(/^\d+$/).default("5432"),
  DATABASE_USER: z.string().min(1),
  DATABASE_PASSWORD: z.string().min(1),
  DATABASE_NAME: z.string().min(1),
  DATABASE_SSL: z.enum(["true", "false"]).optional(),
  DATABASE_POOL_MAX: z.string().regex(/^\d+$/).optional(),
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

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = z.prettifyError(result.error);
    console.error("❌ Invalid environment variables:\n", formatted);
    throw new Error(
      "Missing or invalid environment variables. See above for details.",
    );
  }
  return result.data;
}

export const env = validateEnv();
