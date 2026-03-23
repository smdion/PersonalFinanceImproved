import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  protectedProcedure,
  adminProcedure,
  publicProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";

export const onboardingProcedures = {
  isOnboardingComplete: protectedProcedure.query(async ({ ctx }) => {
    // Check if any people exist
    const peopleRows = await ctx.db
      .select({ id: schema.people.id })
      .from(schema.people)
      .limit(1);
    if (peopleRows.length > 0) {
      return { complete: true };
    }

    // Check if onboarding_completed flag is set in app_settings
    const setting = await ctx.db
      .select({ value: schema.appSettings.value })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, "onboarding_completed"));
    if (setting.length > 0 && setting[0]!.value === true) {
      return { complete: true };
    }

    return { complete: false };
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
   * Guard: only callable when no local admins exist yet.
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
      // Guard: only allow creation when no local admins exist
      const existing = await ctx.db
        .select({ id: schema.localAdmins.id })
        .from(schema.localAdmins)
        .limit(1);
      if (existing.length > 0) {
        throw new Error(
          "A local admin account already exists. Use Settings to manage accounts.",
        );
      }

      const passwordHash = await hashPassword(input.password);
      const [admin] = await ctx.db
        .insert(schema.localAdmins)
        .values({
          name: input.name.trim(),
          email: input.email.toLowerCase().trim(),
          passwordHash,
        })
        .returning({ id: schema.localAdmins.id });

      return { id: admin!.id };
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
