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
          const profiles = await tx.select().from(schema.salaryProfiles);
          for (const p of profiles) {
            let changed = false;
            const salaries = Object.fromEntries(
              Object.entries(p.salaries).map(([jobId, entry]) => {
                const amounts = entry.otherEarnings;
                if (!amounts || !(String(input.id) in amounts))
                  return [jobId, entry];
                changed = true;
                const { [String(input.id)]: _drop, ...rest } = amounts;
                return [jobId, { ...entry, otherEarnings: rest }];
              }),
            );
            if (changed /* set inside the map callback above */)
              await tx
                .update(schema.salaryProfiles)
                .set({ salaries })
                .where(eq(schema.salaryProfiles.id, p.id));
          }
          await tx
            .delete(schema.paycheckEarnings)
            .where(eq(schema.paycheckEarnings.id, input.id));
        }),
      ),
  }),
};
