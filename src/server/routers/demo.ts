/** Demo router for creating, listing, activating, and destroying isolated demo schemas seeded with predefined financial profiles. */
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { cookies } from "next/headers";
import {
  createTRPCRouter,
  expensiveRateLimitMiddleware,
  protectedProcedure,
} from "../trpc";
import { DEMO_COOKIE, getDemoProfileList } from "@/lib/demo";
import { DEMO_PROFILE_SLUGS } from "@/lib/demo/slugs";
import { isPostgres } from "@/lib/db/dialect";
import { buildDemoSchema } from "@/server/services/demo/demo-schema";

export const demoRouter = createTRPCRouter({
  /** List available demo profiles. */
  listProfiles: protectedProcedure.query(() => {
    return {
      profiles: getDemoProfileList(),
      isDemoOnly: process.env.DEMO_ONLY === "true",
    };
  }),

  /** Activate a demo profile: rebuild its shared schema and seed it, at most 5 a minute
   *  per visitor. protectedProcedure on purpose: must work in DEMO_ONLY mode
   *  (RULES.md § Permission & Security Gates rule 3 exception). */
  activateProfile: protectedProcedure
    .input(z.object({ slug: z.enum(DEMO_PROFILE_SLUGS) }))
    .use(expensiveRateLimitMiddleware)
    .mutation(async ({ ctx, input }) => {
      if (!isPostgres()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Demo mode requires PostgreSQL (uses PG schemas for isolation)",
        });
      }

      const schemaName = await buildDemoSchema(input.slug, ctx.scope.asOf);

      // Set HttpOnly cookie server-side so it's not accessible to JavaScript
      const cookieStore = await cookies();
      cookieStore.set(DEMO_COOKIE, input.slug, {
        path: "/",
        maxAge: 86400,
        sameSite: "strict",
        httpOnly: true,
      });

      return { ok: true, slug: input.slug, schemaName };
    }),

  /** Deactivate demo mode by clearing the HttpOnly cookie. protectedProcedure on purpose:
   *  it changes cookie state, not app data, and must work in DEMO_ONLY mode
   *  (RULES.md § Permission & Security Gates rule 3 exception). */
  deactivateDemo: protectedProcedure.mutation(async () => {
    const cookieStore = await cookies();
    cookieStore.set(DEMO_COOKIE, "", {
      path: "/",
      maxAge: 0,
      httpOnly: true,
    });
    return { ok: true };
  }),
});
