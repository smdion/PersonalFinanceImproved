import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import {
  protectedProcedure,
  adminProcedure,
  publicProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import {
  checkOnboardingComplete,
  firstRunState,
} from "@/server/data/first-run";
import { lockForTransaction } from "@/server/data/lock-row";
import { adoptFirstRetirementProfile } from "@/server/helpers/retirement-profile";
import type { DbOrTx } from "@/lib/db";
import { upsertSetting } from "@/server/data/settings";

/** Refuse unless the install still needs its first admin (first-run.ts). */
async function requireAdminNeeded(db: DbOrTx): Promise<void> {
  if ((await firstRunState(db)).adminNeeded) return;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message:
      "A local admin account already exists, or onboarding is complete. Sign in to continue.",
  });
}

export const onboardingProcedures = {
  isOnboardingComplete: protectedProcedure.query(async ({ ctx }) => {
    return { complete: await checkOnboardingComplete(ctx.db) };
  }),

  completeOnboarding: adminProcedure.mutation(async ({ ctx }) => {
    await upsertSetting(ctx.db, "onboarding_completed", true);
    // Settings saved before onboarding finished become the first profile.
    await adoptFirstRetirementProfile(ctx.db);
    return { ok: true };
  }),

  /** Signed-out callers read this too: /login and the wizard offer
   *  "Create the first admin" only while it says so. */
  firstRunState: publicProcedure.query(({ ctx }) => firstRunState(ctx.db)),

  /**
   * Create the first local admin. Public, because no session exists yet;
   * callable only while `firstRunState` says an admin is needed, so it
   * closes for good once any local admin exists or onboarding is complete.
   * The check repeats under a transaction lock, so two first-run requests
   * at once can't both create one.
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
      // Refused cheaply, before the write transaction and the password hash.
      await requireAdminNeeded(ctx.db);
      const passwordHash = await hashPassword(input.password);
      const admin = await ctx.db.transaction(async (tx) => {
        await lockForTransaction(tx, "first-local-admin");
        await requireAdminNeeded(tx);
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
