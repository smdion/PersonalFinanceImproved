import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import {
  protectedProcedure,
  adminProcedure,
  publicProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import type { DbType } from "./_shared";

/** Shared by isOnboardingComplete and createLocalAdmin's guard — these two
 *  checks must never drift apart, or one can be tricked into believing
 *  onboarding hasn't happened when the other says it has. */
async function checkOnboardingComplete(db: DbType): Promise<boolean> {
  const peopleRows = await db
    .select({ id: schema.people.id })
    .from(schema.people)
    .limit(1);
  if (peopleRows.length > 0) return true;

  const setting = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "onboarding_completed"));
  return setting.length > 0 && setting[0]!.value === true;
}

export const onboardingProcedures = {
  isOnboardingComplete: protectedProcedure.query(async ({ ctx }) => {
    return { complete: await checkOnboardingComplete(ctx.db) };
  }),

  completeOnboarding: adminProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .insert(schema.appSettings)
      .values({ key: "onboarding_completed", value: true })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: { value: true },
      });
    return { ok: true };
  }),

  /**
   * Create the initial local admin account during onboarding.
   * Guard: only callable when no local admins exist yet AND onboarding
   * hasn't otherwise been completed (e.g. via OIDC) — an OIDC-only install
   * never creates a local_admins row, so table-emptiness alone would leave
   * this endpoint permanently open. Runs inside a transaction so the
   * check-then-insert can't race two concurrent first-run requests into
   * both succeeding.
   * Uses publicProcedure because no session exists before the first admin is created.
   */
  createLocalAdmin: publicProcedure
    .input(
      z.object({
        name: z.string().min(1, "Name is required").max(100),
        email: z.string().email("Invalid email address").max(200),
        password: z
          .string()
          .min(12, "Password must be at least 12 characters")
          .refine(
            (p) => /[A-Z]/.test(p) && /[0-9]/.test(p),
            "Password must contain at least one uppercase letter and one digit",
          ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const admin = await ctx.db.transaction(async (tx) => {
        if (await checkOnboardingComplete(tx)) {
          throw new Error(
            "Onboarding has already been completed. Use Settings to manage accounts.",
          );
        }
        const existing = await tx
          .select({ id: schema.localAdmins.id })
          .from(schema.localAdmins)
          .limit(1);
        if (existing.length > 0) {
          throw new Error(
            "A local admin account already exists. Use Settings to manage accounts.",
          );
        }

        const passwordHash = await hashPassword(input.password);
        const [created] = await tx
          .insert(schema.localAdmins)
          .values({
            name: input.name.trim(),
            email: input.email.toLowerCase().trim(),
            passwordHash,
          })
          .returning({ id: schema.localAdmins.id });

        return created!;
      });

      return { id: admin.id };
    }),

  /**
   * Test whether OIDC (Authentik) is configured and reachable.
   * Checks env vars and fetches the issuer's well-known endpoint.
   */
  testOidcConnection: publicProcedure.query(async () => {
    const issuer = process.env.AUTH_AUTHENTIK_ISSUER;
    const clientId = process.env.AUTH_AUTHENTIK_ID;
    const clientSecret = process.env.AUTH_AUTHENTIK_SECRET;

    const configured = !!(issuer && clientId && clientSecret);
    if (!configured) {
      return { configured: false, reachable: false, issuer: null };
    }

    try {
      const wellKnown = `${issuer}/.well-known/openid-configuration`;
      const res = await fetch(wellKnown, {
        signal: AbortSignal.timeout(5000),
      });
      return {
        configured: true,
        reachable: res.ok,
        issuer,
      };
    } catch {
      return { configured: true, reachable: false, issuer };
    }
  }),
};
