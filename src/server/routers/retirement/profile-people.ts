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
import { firstRow } from "@/lib/utils/first-row";

export const profilePeopleProcedures = {
  retirementProfilePeople: createTRPCRouter({
    /**
     * Every Retirement profile's per-person rows (retirement age, end age, Social Security),
     * by profile then person.
     */
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.retirementProfilePeople)
        .orderBy(
          asc(schema.retirementProfilePeople.profileId),
          asc(schema.retirementProfilePeople.personId),
        ),
    ),

    // The write path for per-person Retirement Age, Rule of 55 and Social Security
    // benefit: the engine reads them from `retirement_profile_people`.
    upsertPerson: adminProcedure
      .input(
        z.object({
          profileId: z.number().int(),
          personId: z.number().int(),
          retirementAge: z.number().int().min(18).max(100).optional(),
          endAge: z.number().int().min(30).max(120).optional(),
          socialSecurityMonthly: zDecimal.nullable().optional(),
          // PIA (monthly benefit at Full Retirement Age), per person and
          // opt-in; independent of socialSecurityMonthly. null means "not
          // opted in", never a household-wide default.
          socialSecurityPia: zDecimal.nullable().optional(),
          ssStartAge: z.number().int().min(62).max(70).nullable().optional(),
          ruleOf55Override: z.boolean().nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(schema.retirementProfilePeople)
          .where(
            and(
              eq(schema.retirementProfilePeople.profileId, input.profileId),
              eq(schema.retirementProfilePeople.personId, input.personId),
            ),
          );
        // retirementAge/endAge are NOT NULL: the completeness invariant guarantees
        // `existing` in real flows, but a cold insert still needs concrete values.
        if (
          !existing &&
          (input.retirementAge == null || input.endAge == null)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Retirement age and end age are required to add a person to a new profile.",
          });
        }
        const { profileId, personId, ...patch } = input;
        const values = {
          profileId,
          personId,
          retirementAge: patch.retirementAge ?? existing!.retirementAge,
          endAge: patch.endAge ?? existing!.endAge,
          ...("socialSecurityMonthly" in patch
            ? { socialSecurityMonthly: patch.socialSecurityMonthly }
            : {}),
          ...("socialSecurityPia" in patch
            ? { socialSecurityPia: patch.socialSecurityPia }
            : {}),
          ...("ssStartAge" in patch ? { ssStartAge: patch.ssStartAge } : {}),
          ...("ruleOf55Override" in patch
            ? { ruleOf55Override: patch.ruleOf55Override }
            : {}),
        };
        return existing
          ? ctx.db
              .update(schema.retirementProfilePeople)
              .set(values)
              .where(eq(schema.retirementProfilePeople.id, existing.id))
              .returning()
              .then(firstRow)
          : ctx.db
              .insert(schema.retirementProfilePeople)
              .values(values)
              .returning()
              .then(firstRow);
      }),

    // "Projection Through" (end age) and Social Security "Start Age" are one
    // household-wide control but stored per person: fan the sent field to every
    // person's row in the profile.
    upsertHouseholdFields: adminProcedure
      .input(
        z.object({
          profileId: z.number().int(),
          endAge: z.number().int().min(30).max(120).optional(),
          ssStartAge: z.number().int().min(62).max(70).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { profileId, ...fields } = input;
        const patch = Object.fromEntries(
          Object.entries(fields).filter(([, v]) => v !== undefined), // superjson keeps a key sent as undefined
        );
        if (Object.keys(patch).length === 0) return [];
        return ctx.db
          .update(schema.retirementProfilePeople)
          .set(patch)
          .where(eq(schema.retirementProfilePeople.profileId, profileId))
          .returning();
      }),
  }),
};
