/** Demo router for creating, listing, activating, and destroying isolated demo schemas seeded with predefined financial profiles. */
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { cookies } from "next/headers";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { DEMO_PROFILES, getDemoProfileList } from "@/lib/demo";
import { isPostgres } from "@/lib/db/dialect";
import { buildDemoSchema } from "@/server/services/demo/demo-schema";

/** Safe slug pattern — lowercase alphanumeric + hyphens, 1-40 chars. */
const DEMO_SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
const MAX_SLUG_LENGTH = 40;

const demoSlugSchema = z
  .string()
  .min(1)
  .max(MAX_SLUG_LENGTH)
  .regex(
    DEMO_SLUG_REGEX,
    "Slug must be lowercase alphanumeric with hyphens only",
  );

export const demoRouter = createTRPCRouter({
  /** List available demo profiles. */
  listProfiles: protectedProcedure.query(() => {
    return {
      profiles: getDemoProfileList(),
      isDemoOnly: process.env.DEMO_ONLY === "true",
    };
  }),

  /** Activate a demo profile — creates schema, seeds data, returns success.
   *  Uses protectedProcedure (not a domain procedure) intentionally: writes
   *  go to an isolated per-user demo schema, never to shared application
   *  data, and must remain callable in DEMO_ONLY mode. See RULES.md
   *  § Permission & Security Gates rule 3 exception. */
  activateProfile: protectedProcedure
    .input(z.object({ slug: demoSlugSchema }))
    .mutation(async ({ input }) => {
      if (!isPostgres()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Demo mode requires PostgreSQL (uses PG schemas for isolation)",
        });
      }

      const profile = DEMO_PROFILES[input.slug];
      if (!profile) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown demo profile: ${input.slug}`,
        });
      }

      const schemaName = await buildDemoSchema(input.slug, profile);

      // Set HttpOnly cookie server-side so it's not accessible to JavaScript
      const cookieStore = await cookies();
      cookieStore.set("demo_active_profile", input.slug, {
        path: "/",
        maxAge: 86400,
        sameSite: "strict",
        httpOnly: true,
      });

      return { ok: true, slug: input.slug, schemaName };
    }),

  /** Deactivate demo mode — clear the HttpOnly cookie server-side.
   *  Uses protectedProcedure (not a domain procedure) intentionally: this
   *  mutates session/cookie state, not application data, and must remain
   *  callable in DEMO_ONLY mode where the demoOnlyGuard exempts demo.*
   *  paths. See RULES.md § Permission & Security Gates rule 3 exception. */
  deactivateDemo: protectedProcedure.mutation(async () => {
    const cookieStore = await cookies();
    cookieStore.set("demo_active_profile", "", {
      path: "/",
      maxAge: 0,
      httpOnly: true,
    });
    return { ok: true };
  }),
});
