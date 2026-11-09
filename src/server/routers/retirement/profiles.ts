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
import { firstRow } from "@/lib/utils/first-row";

export const profileProcedures = {
  // retirement_scenarios has no write procedures: nothing in the app edits
  // it, so it can't change a projection unseen. Its selected row is read by
  // build-engine-payload and the relocation analysis.

  /**
   * Retirement Profiles CRUD; each profile is a complete, independent world. New profiles
   * come only from `duplicate`: retirement_settings has many NOT NULL columns with no
   * sensible blank default. adminProcedure throughout, like retirementSettings.upsert.
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

    /** Rename / re-describe a profile, or set its tax-law year (assumptions are edited
     *  through retirementSettings.upsert). `taxParamsYear` null tracks the latest enacted
     *  tax data; a year fixes resolveTaxParams's base year so the profile reproduces. */
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
          .then(firstRow),
      ),

    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        deleteProfile(ctx.db, "retirement", input.id),
      ),
  }),
};
