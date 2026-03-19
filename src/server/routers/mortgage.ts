import { asc } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { calculateMortgage } from "@/lib/calculators/mortgage";
import { num, buildMortgageInputs } from "@/server/helpers";
import type { MortgageInput, MortgageWhatIf } from "@/lib/calculators/types";

export const mortgageRouter = createTRPCRouter({
  getActiveSummary: protectedProcedure.query(async ({ ctx }) => {
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
      extraMonthlyPrincipal: num(s.extraMonthlyPrincipal),
      extraOneTimePayment: num(s.extraOneTimePayment),
      refinanceRate: s.refinanceRate ? num(s.refinanceRate) : undefined,
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
    return { loans, result, whatIfScenarios: whatIfRows };
  }),
});
