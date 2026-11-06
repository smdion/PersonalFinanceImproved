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

// amountPerPeriod is deliberately NOT here — a deduction is purely
// structural now; its dollar amount is ALWAYS a Contribution Profile's
// deductions active-field entry (contributionProfile.update/
// setDeductionActiveFields write it), same no-base-value rule contribution
// accounts already follow. See applyDeductionActiveFields.
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
    // create/update at contributionProfileProcedure's level, not admin — a
    // deduction's identity (name/isPretax/ficaExempt) is the same class of
    // previously-admin-gated job fact that W-4/pay-schedule fields already
    // moved off of (Stage B); its AMOUNT already resolves via a
    // Contribution Profile's active fields at this same permission level,
    // so gating identity higher than the value that depends on it doesn't
    // make sense. delete stays admin — more destructive, not requested.
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
          .then((r) => r[0]),
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
          .then((r) => r[0]),
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
