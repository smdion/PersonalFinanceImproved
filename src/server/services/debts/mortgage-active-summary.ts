import type { Db } from "@/lib/db";
import type { RequestScope } from "@/server/data/request-scope";
import { asc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { calculateMortgage } from "@/lib/pure/debts/mortgage";
import {
  buildMortgageInputs,
  getActiveMortgageLoan,
} from "@/lib/pure/debts/mortgage-balance";
import { toNumber } from "@/lib/utils/numbers";
import type {
  MortgageInput,
  MortgageWhatIf,
} from "@/lib/pure/debts/mortgage.types";

export async function computeMortgageActiveSummary(ctx: {
  db: Db;
  scope: RequestScope;
}) {
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
    asOfDate: ctx.scope.asOf,
  };

  const result = calculateMortgage(input);
  const activeLoan = getActiveMortgageLoan(loans);
  const activeLoanResult = activeLoan
    ? (result.loans.find((r) => r.loanId === activeLoan.id) ?? result.loans[0])
    : result.loans[0];

  return {
    loans,
    result,
    whatIfScenarios: whatIfRows,
    activeLoanId: activeLoan?.id ?? null,
    activeLoanResult: activeLoanResult ?? null,
  };
}
