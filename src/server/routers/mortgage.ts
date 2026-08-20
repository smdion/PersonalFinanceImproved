/** Mortgage router for amortization calculations, extra payment tracking, loan/what-if/extra-payment CRUD, and what-if refinance scenarios across multiple loans. */
import { z } from "zod/v4";
import { asc, eq } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { calculateMortgage } from "@/lib/calculators/mortgage";
import {
  toNumber,
  buildMortgageInputs,
  getActiveMortgageLoan,
} from "@/server/helpers";
import type { MortgageInput, MortgageWhatIf } from "@/lib/calculators/types";
import { zDecimal } from "./settings/_shared";

// --- CRUD Zod schemas ---

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
  computeActiveSummary: protectedProcedure.query(async ({ ctx }) => {
    const [loans, extraPayments, whatIfRows] = await Promise.all([
      ctx.db
        .select()
        .from(schema.mortgageLoans)
        .orderBy(asc(schema.mortgageLoans.id)),
      ctx.db
        .select()
        .from(schema.mortgageExtraPayments)
        .orderBy(asc(schema.mortgageExtraPayments.paymentDate)),
      ctx.db
        .select()
        .from(schema.mortgageWhatIfScenarios)
        .orderBy(asc(schema.mortgageWhatIfScenarios.sortOrder)),
    ]);

    const { loanInputs, extras } = buildMortgageInputs(loans, extraPayments);

    const whatIfScenarios: MortgageWhatIf[] = whatIfRows.map((s) => ({
      id: s.id,
      label: s.label,
      extraMonthlyPrincipal: toNumber(s.extraMonthlyPrincipal),
      extraOneTimePayment: toNumber(s.extraOneTimePayment),
      refinanceRate: s.refinanceRate ? toNumber(s.refinanceRate) : undefined,
      refinanceTerm: s.refinanceTerm ?? undefined,
      loanId: s.loanId ?? undefined,
    }));

    const input: MortgageInput = {
      loans: loanInputs,
      extraPayments: extras,
      whatIfScenarios,
      asOfDate: new Date(),
    };

    const result = calculateMortgage(input);
    const activeLoan = getActiveMortgageLoan(loans);
    const activeLoanResult = activeLoan
      ? (result.loans.find((r) => r.loanId === activeLoan.id) ??
        result.loans[0])
      : result.loans[0];

    return {
      loans,
      result,
      whatIfScenarios: whatIfRows,
      activeLoanId: activeLoan?.id ?? null,
      activeLoanResult: activeLoanResult ?? null,
    };
  }),

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
      .input(mortgageWhatIfInput)
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.mortgageWhatIfScenarios)
          .values(input)
          .returning()
          .then((r) => r[0]),
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
      .input(mortgageExtraPaymentInput)
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.mortgageExtraPayments)
          .values(input)
          .returning()
          .then((r) => r[0]),
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
});
