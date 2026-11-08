import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq, asc, and } from "drizzle-orm";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { getPrimaryPerson } from "@/lib/pure/household/primary-person";
import { getAllPeople } from "@/server/data/people";
import {
  addPersonToRetirementProfile,
  lockFirstRetirementProfile,
} from "@/server/services/profiles/first-retirement-profile";
import { zCalendarDate } from "@/lib/utils/zod-fields";
import { speculativeJobValues } from "@/server/data/jobs";
import { firstRow } from "@/lib/utils/first-row";

// --- Zod schemas ---

const personInput = z.object({
  name: z.string().min(1),
  dateOfBirth: zCalendarDate,
  isPrimaryUser: z.boolean().default(false),
});

export const peopleProcedures = {
  people: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) => getAllPeople(ctx.db)),
    create: adminProcedure
      .input(personInput)
      .mutation(async ({ ctx, input }) => {
        return ctx.db.transaction(async (tx) => {
          // Resolved BEFORE inserting the new person — this is who existing
          // retirement_profile rows are cloned FROM, and the new person (who
          // by definition has no row of their own yet in any profile) must
          // not be a candidate for that.
          const existingPeople = await tx
            .select()
            .from(schema.people)
            .orderBy(asc(schema.people.id));
          const primaryPerson = getPrimaryPerson(existingPeople);

          const person = await tx
            .insert(schema.people)
            .values(input)
            .returning()
            .then((r) => r[0]!);
          // Provision the speculative-job peg atomically with the person —
          // inserted directly (not via jobs.create) so it doesn't trigger
          // materializeExtraPaycheckSavings, which a job that never has
          // real routing rules has no need for.
          await tx.insert(schema.jobs).values(speculativeJobValues(person.id));

          // Completeness invariant: every profile holds rows for every
          // person, so the new person joins each existing profile. Under the
          // first-profile lock, so a first profile made at the same time
          // either includes this person or is seen here.
          await lockFirstRetirementProfile(tx);
          const existingProfiles = await tx
            .select({ id: schema.retirementProfiles.id })
            .from(schema.retirementProfiles);
          for (const profile of existingProfiles)
            await addPersonToRetirementProfile(
              tx,
              profile.id,
              person.id,
              primaryPerson?.id,
            );

          return person;
        });
      }),
    update: adminProcedure
      .input(z.object({ id: z.number().int() }).extend(personInput.shape))
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.people)
          .set(data)
          .where(eq(schema.people.id, id))
          .returning()
          .then(firstRow),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        // The speculative-job peg is an implementation detail of this
        // person's row, not real employment history — delete it first so
        // it never blocks a person delete via jobs' onDelete: "restrict"
        // FK. Any REAL job still correctly blocks the delete. Both deletes
        // must be one transaction — otherwise a failed person delete (a
        // real job still referencing them) leaves the peg gone with no
        // re-provisioning path.
        // Debts they own block the delete (owner_person_id restrict) —
        // say so instead of surfacing the foreign-key error.
        const owned = await ctx.db
          .select({ name: schema.debts.name })
          .from(schema.debts)
          .where(eq(schema.debts.ownerPersonId, input.id));
        if (owned.length > 0)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `They own ${owned.map((d) => d.name).join(", ")} on Liabilities — make it joint, reassign or delete it first`,
          });
        // The household's own retirement settings live on the primary
        // person's rows: someone else must be primary first.
        const everyone = await ctx.db.select().from(schema.people);
        if (everyone.length > 1 && getPrimaryPerson(everyone)?.id === input.id)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "They're the primary person — make someone else primary first",
          });
        // A real job or recorded Roth basis is history: block with a
        // clear reason rather than the foreign-key error.
        const [realJob] = await ctx.db
          .select({ id: schema.jobs.id })
          .from(schema.jobs)
          .where(
            and(
              eq(schema.jobs.personId, input.id),
              eq(schema.jobs.isSpeculative, false),
            ),
          )
          .limit(1);
        if (realJob)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "They have a job on record — delete their jobs on Paycheck first",
          });
        const [basis] = await ctx.db
          .select({ id: schema.accountBasis.id })
          .from(schema.accountBasis)
          .where(eq(schema.accountBasis.ownerPersonId, input.id))
          .limit(1);
        if (basis)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "They have Roth basis recorded on an account — remove it first",
          });
        return ctx.db.transaction(async (tx) => {
          await tx
            .delete(schema.jobs)
            .where(
              and(
                eq(schema.jobs.personId, input.id),
                eq(schema.jobs.isSpeculative, true),
              ),
            );
          // Their per-profile retirement rows and changes by year are
          // settings about them, not history: they go with them.
          await tx
            .delete(schema.retirementSettings)
            .where(eq(schema.retirementSettings.personId, input.id));
          await tx
            .delete(schema.retirementSalaryOverrides)
            .where(eq(schema.retirementSalaryOverrides.personId, input.id));
          await tx
            .delete(schema.retirementBudgetOverrides)
            .where(eq(schema.retirementBudgetOverrides.personId, input.id));
          return tx.delete(schema.people).where(eq(schema.people.id, input.id));
        });
      }),
  }),
};
