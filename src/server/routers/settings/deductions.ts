import { z } from "zod/v4";
import { eq, asc } from "drizzle-orm";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
  contributionProfileProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { dropContributionActiveFields } from "@/server/data/delete-references";
import { firstRow } from "@/lib/utils/first-row";

// No amountPerPeriod: a deduction is structural; its dollar amount is always a
// Contribution Profile's active-field entry. See applyDeductionActiveFields.
const deductionInput = z.object({
  jobId: z.number().int(),
  deductionName: z.string().trim().min(1),
  isPretax: z.boolean(),
  ficaExempt: z.boolean().default(false),
});

// Section 125 money is pre-tax for income tax AND FICA; an after-tax
// deduction can't skip FICA. The paycheck calculator also ignores the flag
// on an after-tax row (old backups), so this guards new writes.
const ficaExemptRequiresPretax = (data: {
  isPretax: boolean;
  ficaExempt: boolean;
}) => !data.ficaExempt || data.isPretax;

const ficaExemptRequiresPretaxIssue = {
  message: "A FICA-exempt deduction must also be pre-tax",
  path: ["ficaExempt"],
};

export const deductionsProcedures = {
  deductions: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.paycheckDeductions)
        .orderBy(asc(schema.paycheckDeductions.jobId)),
    ),
    // create/update at contributionProfileProcedure's level: identity shouldn't be gated
    // higher than the amount that depends on it. delete stays admin (more destructive).
    create: contributionProfileProcedure
      .input(
        deductionInput.refine(
          ficaExemptRequiresPretax,
          ficaExemptRequiresPretaxIssue,
        ),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.paycheckDeductions)
          .values(input)
          .returning()
          .then(firstRow),
      ),
    update: contributionProfileProcedure
      .input(
        z
          .object({ id: z.number().int() })
          .extend(deductionInput.shape)
          .refine(ficaExemptRequiresPretax, ficaExemptRequiresPretaxIssue),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.paycheckDeductions)
          .set(data)
          .where(eq(schema.paycheckDeductions.id, id))
          .returning()
          .then(firstRow),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db.transaction(async (tx) => {
          await dropContributionActiveFields(tx, "deductions", input.id);
          await tx
            .delete(schema.paycheckDeductions)
            .where(eq(schema.paycheckDeductions.id, input.id));
        }),
      ),
  }),
};
