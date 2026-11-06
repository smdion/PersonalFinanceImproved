import {
  deleteProfile,
  duplicateProfile,
} from "@/server/services/profiles/profile-lifecycle";
import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";

export const profileProcedures = {
  // retirementScenarios CRUD removed.
  // It had ZERO UI callers while the table it wrote was read on every engine
  // build, so it could silently change every projection with no way to see
  // or undo it. The four distribution tax rates it carried now live on
  // retirement_settings and are read from there; leaving a writable router
  // pointed at the now-ignored columns would be a second, invisible answer
  // to "what drives my projection" — the exact thing this work removes.
  //
  // The TABLE survives for now: retirement.ts's relocation comparison still
  // reads its withdrawal_rate, which is deliberately NOT relocated (see the
  // schema docblock — retirement_settings.withdrawal_rate already exists and
  // collapsing the two is a user-visible change needing its own commit).

  /**
   * Retirement Profiles CRUD (Retirement Profiles step D — "multiple
   * profiles + the Plan field"). Each profile is a COMPLETE WORLD: no
   * baseline, no default, no inheritance, no merge at read time — same
   * contract Salary Profiles already state. `duplicate` is the one creation
   * path (no bare `create`): retirement_settings has ~40 columns, many
   * NOT NULL with no sensible blank default, so every new profile starts as
   * a clone of an existing one, matching the plan's own recommendation that
   * "duplicate to compare" be the primary action.
   *
   * adminProcedure throughout, matching retirementSettings.upsert's existing
   * gate — CONTRIBUTING.md Composed Router Convention: an inconsistent procedure type within
   * one group is a bug, not a design choice.
   */
  retirementProfiles: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.retirementProfiles)
        .orderBy(asc(schema.retirementProfiles.id)),
    ),

    /** Clone a profile's per-person rows into a new profile (profile-lifecycle.ts). */
    duplicate: adminProcedure
      .input(
        z.object({
          sourceProfileId: z.number().int(),
          name: z.string().min(1).max(100),
          description: z.string().max(500).optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        duplicateProfile(ctx.db, "retirement", input),
      ),

    /** Rename / re-describe a profile, or pin its tax-law year. Household/
     *  per-person assumptions themselves are edited through
     *  retirementSettings.upsert, scoped to whichever profile is active —
     *  not here. taxParamsYear lives on retirement_profiles itself:
     *  null (default) tracks the latest enacted tax data; a real year pins
     *  resolveTaxParams's base year so re-opening this profile reproduces
     *  its numbers instead of re-pricing under whatever year is newest. */
    update: adminProcedure
      .input(
        z.object({
          id: z.number().int(),
          name: z.string().min(1).max(100).optional(),
          description: z.string().max(500).nullish(),
          taxParamsYear: z.number().int().min(2000).max(2100).nullish(),
        }),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.retirementProfiles)
          .set(data)
          .where(eq(schema.retirementProfiles.id, id))
          .returning()
          .then((r) => r[0]),
      ),

    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        deleteProfile(ctx.db, "retirement", input.id),
      ),
  }),
};
