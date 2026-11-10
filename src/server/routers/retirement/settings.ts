import { eq, asc, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { zDecimal } from "@/lib/utils/zod-fields";
import {
  retirementSettingsInput,
  upsertRetirementSettings,
} from "@/server/services/profiles/retirement-settings";

export const settingsProcedures = {
  retirementSettings: createTRPCRouter({
    /**
     * Every retirement settings row (one per profile and person), by person.
     */
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.retirementSettings)
        .orderBy(asc(schema.retirementSettings.personId)),
    ),
    // Every read and write is scoped by profile (one row per profile and person).
    // `profileId` omitted resolves to the globally-active profile; `null` scopes to the
    // null-profile rows via `isNull`. Never collapse the two with `??`.
    upsert: adminProcedure
      .input(retirementSettingsInput)
      .mutation(({ ctx, input }) => upsertRetirementSettings(ctx, input)),

    // Writes only `salary_annual_increase` for one (profile, person), which the engine
    // reads per person; never fan it out. UPDATE-only: the completeness invariant
    // guarantees the row, so a missing one is an error, not a guessed insert.
    upsertPersonRaiseRate: adminProcedure
      .input(
        z.object({
          profileId: z.number().int(),
          personId: z.number().int(),
          salaryAnnualIncrease: zDecimal,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .update(schema.retirementSettings)
          .set({ salaryAnnualIncrease: input.salaryAnnualIncrease })
          .where(
            and(
              eq(schema.retirementSettings.profileId, input.profileId),
              eq(schema.retirementSettings.personId, input.personId),
            ),
          )
          .returning();
        if (!row) {
          // .mutation() — friendlyMutationError only passes a message
          // through for BAD_REQUEST (NOT_FOUND gets fixed generic copy).
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "No retirement settings for this person yet — open the Retirement page first.",
          });
        }
        return row;
      }),
  }),
};
