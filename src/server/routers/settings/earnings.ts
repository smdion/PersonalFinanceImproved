import { z } from "zod/v4";
import { eq, asc } from "drizzle-orm";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
  contributionProfileProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { firstRow } from "@/lib/utils/first-row";
import { mergeSalaryEntries } from "@/server/services/profiles/salary-entry-writes";

// Other pay on a job's checks — structural only (the per-check amount is
// the Salary Profile entry's `otherEarnings`, like salary and bonus).
const earningInput = z
  .object({
    jobId: z.number().int(),
    earningName: z.string().trim().min(1),
    isCash: z.boolean(),
    federalTaxable: z.boolean(),
    ficaTaxable: z.boolean(),
  })
  // A benefit that's neither paid nor taxed changes nothing — almost
  // certainly a mistake.
  .refine((e) => e.isCash || e.federalTaxable || e.ficaTaxable, {
    message: "A benefit that isn't paid must be taxed by something",
    path: ["isCash"],
  });

export const earningsProcedures = {
  earnings: createTRPCRouter({
    /** Every other-pay line on a job's checks, by job. */
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.paycheckEarnings)
        .orderBy(asc(schema.paycheckEarnings.jobId)),
    ),
    // Same permission level as deductions: structure only, the amount is
    // the Salary Profile's.
    create: contributionProfileProcedure
      .input(earningInput)
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.paycheckEarnings)
          .values(input)
          .returning()
          .then(firstRow),
      ),
    /**
     * Edit an other-pay line's structure (its amount is the Salary Profile's), at the
     * contributionProfile permission, like create.
     */
    update: contributionProfileProcedure
      .input(z.object({ id: z.number().int() }).and(earningInput))
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.paycheckEarnings)
          .set(data)
          .where(eq(schema.paycheckEarnings.id, id))
          .returning()
          .then(firstRow),
      ),
    // Also drops its amount from every Salary Profile, so no profile keeps
    // an amount for a deleted line.
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db.transaction(async (tx) => {
          const profiles = await tx
            .select({ id: schema.salaryProfiles.id })
            .from(schema.salaryProfiles)
            .orderBy(asc(schema.salaryProfiles.id));
          for (const p of profiles)
            await mergeSalaryEntries(tx, p.id, (salaries) => {
              const key = String(input.id);
              const held = Object.entries(salaries).filter(
                ([, entry]) =>
                  entry.otherEarnings && key in entry.otherEarnings,
              );
              if (held.length === 0) return null;
              const next = { ...salaries };
              for (const [jobId, entry] of held) {
                const { [key]: _drop, ...rest } = entry.otherEarnings!;
                next[jobId] = { ...entry, otherEarnings: rest };
              }
              return next;
            });
          await tx
            .delete(schema.paycheckEarnings)
            .where(eq(schema.paycheckEarnings.id, input.id));
        }),
      ),
  }),
};
