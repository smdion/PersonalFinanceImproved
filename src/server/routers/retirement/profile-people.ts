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
  // getProjection and getMonteCarloProjection moved to projection.ts

  retirementProfilePeople: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.retirementProfilePeople)
        .orderBy(
          asc(schema.retirementProfilePeople.profileId),
          asc(schema.retirementProfilePeople.personId),
        ),
    ),

    // Retirement Profiles phase 4 (the assumptions band). Until this
    // mutation existed, every per-person editor on the Projection
    // Assumptions card (Timeline's per-person Retirement Age + Rule of 55,
    // Social Security's per-person benefit) actually called
    // `retirementSettings.upsert`, writing `retirement_settings` — the
    // table `build-engine-payload.ts` stopped reading per-person values
    // from once those reads were switched to `retirement_profile_people`.
    // The edits saved, the UI showed the new
    // number optimistically, and the projection never moved — same failure
    // shape as the pre-0b5d5fe `end_age` bug, just at this table instead.
    // This is the real write path now; the affected client call sites are
    // updated in the same commit as this mutation.
    upsertPerson: adminProcedure
      .input(
        z.object({
          profileId: z.number().int(),
          personId: z.number().int(),
          retirementAge: z.number().int().min(18).max(100).optional(),
          endAge: z.number().int().min(30).max(120).optional(),
          socialSecurityMonthly: zDecimal.nullable().optional(),
          // PIA (Primary Insurance Amount, monthly benefit at Full
          // Retirement Age) — opt-in direct user input, see
          // SOCIAL-SECURITY-OPTIMIZATION-PLAN.md decision #1. Independent
          // of socialSecurityMonthly; null means "not opted in," never
          // falls back to a household-wide default (PIA is inherently
          // per-person).
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
        // retirementAge/endAge are NOT NULL — the completeness invariant
        // (profile duplicate / person create, see retirementProfiles below)
        // guarantees `existing` here in every real flow, but an insert path
        // still needs concrete values if it's ever reached cold.
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

    // "Plan Through" (end age) and Social Security "Start Age" both render
    // as ONE household-wide control regardless of person count
    // (sections/timeline.tsx, sections/social-security.tsx), but the
    // engine's real per-person read source for both
    // (`retirement_profile_people`) is per-person storage. Fan whichever
    // field the caller sends to every person's row in the profile — same
    // shape as `retirementSettings.upsert`'s endAge fan-out used to be the
    // fix for, before the read moved to this table out from under it (see
    // upsertPerson's docblock above).
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
          Object.entries(fields).filter(([, v]) => v !== undefined),
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
