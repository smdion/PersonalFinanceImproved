import "../../../../routers/setup-mocks";
import { describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import {
  currentLoan,
  loadExpenseEndings,
} from "@/server/services/projection/engine-payload/expense-endings";

const loan = (id: number, over: Record<string, unknown> = {}) =>
  ({
    id,
    name: `Loan ${id}`,
    isActive: true,
    refinancedFromId: null,
    paidOffDate: null,
    principalAndInterest: "1000.00",
    interestRate: "0.05",
    termYears: 20,
    originalLoanAmount: "150000.00",
    firstPaymentDate: "2020-01-01",
    apiBalance: null,
    apiBalanceDate: null,
    ...over,
  }) as typeof schema.mortgageLoans.$inferSelect;
const item = (id: number, profileId: number, monthly: number, loanId: number) =>
  ({
    id,
    profileId,
    amounts: [monthly],
    mortgageLoanId: loanId,
  }) as typeof schema.budgetItems.$inferSelect;
const fakeDb = (loans: unknown[]) =>
  ({
    select: () => ({
      from: (t: unknown) =>
        Promise.resolve(t === schema.mortgageLoans ? loans : []),
    }),
  }) as never;
const profile = { id: 1, columnLabels: ["Only"], columnMonths: null };
const phase = (over = {}) => ({
  profile,
  column: 0,
  annual: 60000,
  typed: false,
  ...over,
});
const asOfDate = new Date("2026-01-01");

describe("currentLoan", () => {
  it("follows refinances to the loan that replaced it", () => {
    const loans = [
      loan(1, { isActive: false }),
      loan(2, { isActive: false, refinancedFromId: 1 }),
      loan(3, { refinancedFromId: 2 }),
    ];
    expect(currentLoan(loans, 1)?.id).toBe(3);
  });
  it("a loan that's gone is no loan", () => {
    expect(currentLoan([loan(1)], 9)).toBeNull();
  });
});

describe("loadExpenseEndings", () => {
  const run = (
    items: never[] | ReturnType<typeof item>[],
    loans = [loan(1)],
    dec = {},
  ) =>
    loadExpenseEndings(fakeDb(loans), {
      items,
      accumulation: phase(),
      decumulation: phase(dec),
      asOfDate,
    });

  it("no link, no endings", async () => {
    expect(await run([])).toEqual([]);
  });

  it("ends the year after payoff, as a share of each phase's budget", async () => {
    const [e] = await run([item(1, 1, 1000, 1)]);
    expect(e!.year).toBeGreaterThan(2026);
    expect(e!.accumulation).toBeCloseTo(0.2);
    expect(e!.decumulation).toBeCloseTo(0.2);
  });

  it("a line holding escrow too gives up only principal and interest", async () => {
    const [e] = await run([item(1, 1, 1400, 1)]);
    expect(e!.accumulation).toBeCloseTo(0.2);
  });

  it("typed-in retirement spending has no lines to end", async () => {
    const [e] = await run([item(1, 1, 1000, 1)], [loan(1)], { typed: true });
    expect(e!.accumulation).toBeCloseTo(0.2);
    expect(e!.decumulation).toBe(0);
  });

  it("a different retirement budget profile uses its own linked line", async () => {
    const [e] = await run([item(1, 1, 1000, 1)], [loan(1)], {
      profile: { ...profile, id: 2 },
    });
    expect(e!.decumulation).toBe(0);
  });

  it("uses a paid-off date when the loan has one", async () => {
    const [e] = await run(
      [item(1, 1, 1000, 1)],
      [loan(1, { paidOffDate: "2030-06-15", isActive: false })],
    );
    expect(e!.year).toBe(2031);
  });

  it("two loans end separately", async () => {
    const endings = await run(
      [item(1, 1, 500, 1), item(2, 1, 500, 2)],
      [loan(1), loan(2, { name: "HELOC" })],
    );
    expect(endings).toHaveLength(2);
  });
});
