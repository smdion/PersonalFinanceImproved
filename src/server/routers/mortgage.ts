/** Mortgage router for amortization calculations, extra payment tracking, loan/what-if/extra-payment CRUD, and what-if refinance scenarios across multiple loans. */
import { z } from "zod/v4";
import { asc, eq } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { zCalendarDate, zDecimal } from "@/lib/utils/zod-fields";
import { dropMappingsTo } from "@/server/data/delete-references";
import { firstRow } from "@/lib/utils/first-row";
import { computeMortgageActiveSummary } from "@/server/services/mortgage/active-summary";

// --- CRUD Zod schemas ---

const mortgageLoanInput = z.object({
  name: z.string().min(1),
  isActive: z.boolean().default(false),
  refinancedFromId: z.number().int().nullable().optional(),
  paidOffDate: zCalendarDate.nullable().optional(),
  principalAndInterest: zDecimal,
  pmi: zDecimal.default("0"),
  insuranceAndTaxes: zDecimal.default("0"),
  totalEscrow: zDecimal.default("0"),
  interestRate: zDecimal,
  termYears: z.number().int().min(1).max(50),
  originalLoanAmount: zDecimal,
  firstPaymentDate: zCalendarDate,
  propertyValuePurchase: zDecimal,
  propertyValueEstimated: zDecimal.nullable().optional(),
  usePurchaseOrEstimated: z.string().default("purchase"),
});

const mortgageWhatIfInput = z.object({
  loanId: z.number().int().nullable().optional(),
  label: z.string().min(1),
  extraMonthlyPrincipal: zDecimal,
  extraOneTimePayment: z.string().default("0"),
  refinanceRate: z.string().nullable().optional(),
  refinanceTerm: z.number().int().nullable().optional(),
  sortOrder: z.number().int().default(0),
});

const mortgageExtraPaymentInput = z.object({
  loanId: z.number().int(),
  paymentDate: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  amount: zDecimal,
  isActual: z.boolean().default(false),
  notes: z.string().nullable().optional(),
});

export const mortgageRouter = createTRPCRouter({
  computeActiveSummary: protectedProcedure.query(({ ctx }) =>
    computeMortgageActiveSummary(ctx),
  ),

  mortgageLoans: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.mortgageLoans)
        .orderBy(asc(schema.mortgageLoans.id)),
    ),
    create: adminProcedure
      .input(mortgageLoanInput)
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.mortgageLoans)
          .values(input)
          .returning()
          .then(firstRow),
      ),
    update: adminProcedure
      .input(z.object({ id: z.number().int() }).extend(mortgageLoanInput.shape))
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.mortgageLoans)
          .set(data)
          .where(eq(schema.mortgageLoans.id, id))
          .returning()
          .then(firstRow),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db.transaction(async (tx) => {
          await dropMappingsTo(tx, { loanId: input.id });
          await tx
            .delete(schema.mortgageLoans)
            .where(eq(schema.mortgageLoans.id, input.id));
        }),
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
      .input(mortgageWhatIfInput)
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.mortgageWhatIfScenarios)
          .values(input)
          .returning()
          .then(firstRow),
      ),
    update: adminProcedure
      .input(
        z.object({ id: z.number().int() }).extend(mortgageWhatIfInput.shape),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.mortgageWhatIfScenarios)
          .set(data)
          .where(eq(schema.mortgageWhatIfScenarios.id, id))
          .returning()
          .then(firstRow),
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
      .input(mortgageExtraPaymentInput)
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.mortgageExtraPayments)
          .values(input)
          .returning()
          .then(firstRow),
      ),
    update: adminProcedure
      .input(
        z
          .object({ id: z.number().int() })
          .extend(mortgageExtraPaymentInput.shape),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.mortgageExtraPayments)
          .set(data)
          .where(eq(schema.mortgageExtraPayments.id, id))
          .returning()
          .then(firstRow),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.mortgageExtraPayments)
          .where(eq(schema.mortgageExtraPayments.id, input.id)),
      ),
  }),
});
