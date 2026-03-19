import { z } from "zod/v4";
import { eq, asc } from "drizzle-orm";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { zDecimal } from "./_shared";

// --- Zod schemas ---

const mortgageLoanInput = z.object({
  name: z.string().min(1),
  isActive: z.boolean().default(false),
  refinancedFromId: z.number().int().nullable().optional(),
  paidOffDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  principalAndInterest: zDecimal,
  pmi: zDecimal.default("0"),
  insuranceAndTaxes: zDecimal.default("0"),
  totalEscrow: zDecimal.default("0"),
  interestRate: zDecimal,
  termYears: z.number().int(),
  originalLoanAmount: zDecimal,
  firstPaymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  propertyValuePurchase: zDecimal,
  propertyValueEstimated: zDecimal.nullable().optional(),
  usePurchaseOrEstimated: z.string().default("purchase"),
});

// --- Procedures ---

export const mortgageProcedures = {
  mortgageLoans: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.mortgageLoans)
        .orderBy(asc(schema.mortgageLoans.id)),
    ),
    create: adminProcedure.input(mortgageLoanInput).mutation(({ ctx, input }) =>
      ctx.db
        .insert(schema.mortgageLoans)
        .values(input)
        .returning()
        .then((r) => r[0]),
    ),
    update: adminProcedure
      .input(z.object({ id: z.number().int() }).extend(mortgageLoanInput.shape))
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.mortgageLoans)
          .set(data)
          .where(eq(schema.mortgageLoans.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.mortgageLoans)
          .where(eq(schema.mortgageLoans.id, input.id)),
      ),
  }),

  mortgageWhatIfScenarios: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.mortgageWhatIfScenarios)
        .orderBy(asc(schema.mortgageWhatIfScenarios.sortOrder)),
    ),
    create: adminProcedure
      .input(
        z.object({
          loanId: z.number().int().nullable().optional(),
          label: z.string().min(1),
          extraMonthlyPrincipal: zDecimal,
          extraOneTimePayment: z.string().default("0"),
          refinanceRate: z.string().nullable().optional(),
          refinanceTerm: z.number().int().nullable().optional(),
          sortOrder: z.number().int().default(0),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.mortgageWhatIfScenarios)
          .values(input)
          .returning()
          .then((r) => r[0]),
      ),
    update: adminProcedure
      .input(
        z.object({
          id: z.number().int(),
          loanId: z.number().int().nullable().optional(),
          label: z.string().min(1),
          extraMonthlyPrincipal: zDecimal,
          extraOneTimePayment: z.string().default("0"),
          refinanceRate: z.string().nullable().optional(),
          refinanceTerm: z.number().int().nullable().optional(),
          sortOrder: z.number().int().default(0),
        }),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.mortgageWhatIfScenarios)
          .set(data)
          .where(eq(schema.mortgageWhatIfScenarios.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.mortgageWhatIfScenarios)
          .where(eq(schema.mortgageWhatIfScenarios.id, input.id)),
      ),
  }),

  mortgageExtraPayments: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.mortgageExtraPayments)
        .orderBy(asc(schema.mortgageExtraPayments.paymentDate)),
    ),
    create: adminProcedure
      .input(
        z.object({
          loanId: z.number().int(),
          paymentDate: z.string().nullable().optional(),
          startDate: z.string().nullable().optional(),
          endDate: z.string().nullable().optional(),
          amount: zDecimal,
          isActual: z.boolean().default(false),
          notes: z.string().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.mortgageExtraPayments)
          .values(input)
          .returning()
          .then((r) => r[0]),
      ),
    update: adminProcedure
      .input(
        z.object({
          id: z.number().int(),
          loanId: z.number().int(),
          paymentDate: z.string().nullable().optional(),
          startDate: z.string().nullable().optional(),
          endDate: z.string().nullable().optional(),
          amount: zDecimal,
          isActual: z.boolean().default(false),
          notes: z.string().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.mortgageExtraPayments)
          .set(data)
          .where(eq(schema.mortgageExtraPayments.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.mortgageExtraPayments)
          .where(eq(schema.mortgageExtraPayments.id, input.id)),
      ),
  }),
};
