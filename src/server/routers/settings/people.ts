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
    /** Every person in the household, by id. */
    list: protectedProcedure.query(({ ctx }) => getAllPeople(ctx.db)),
    /**
     * Add a person with their speculative-job peg and their rows in every Retirement profile
     * (cloned from the primary person's); returns the person.
     */
    create: adminProcedure
      .input(personInput)
      .mutation(async ({ ctx, input }) => {
        return ctx.db.transaction(async (tx) => {
          // Resolved BEFORE inserting the new person: existing retirement_profile
          // rows are cloned from these people, never from the new one.
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
          // Provision the speculative-job peg with the person, inserted directly (not
          // via jobs.create) to skip materializeExtraPaycheckSavings.
          await tx
            .insert(schema.jobs)
            .values(speculativeJobValues(person.id, ctx.scope.asOf));

          // Completeness invariant: every profile holds rows for every person. Under the
          // first-profile lock, so a concurrent first profile includes this person or is seen.
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
    /**
     * Refused while they own a debt, are the primary person, or have a real job or Roth basis;
     * their speculative job, retirement rows and changes by year go with them.
     */
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
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
        // The speculative-job peg is not employment history: delete it in the same
        // transaction so it never blocks the delete via the jobs FK.
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
