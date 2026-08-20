/**
 * Settings/mortgage router integration tests.
 *
 * Tests CRUD operations for:
 *   - settings.mortgageLoans (list / create / update / delete)
 *   - settings.mortgageWhatIfScenarios (list / create / update / delete)
 *   - settings.mortgageExtraPayments (list / create / update / delete)
 */
import "./setup-mocks";
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller, viewerSession, adminSession } from "./setup";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// MORTGAGE LOANS
// ---------------------------------------------------------------------------

describe("settings.mortgageLoans", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  const baseLoan = {
    name: "Primary Mortgage",
    isActive: true,
    principalAndInterest: "1770.09",
    interestRate: "0.065",
    termYears: 30,
    originalLoanAmount: "280000",
    firstPaymentDate: "2022-09-01",
    propertyValuePurchase: "350000",
  };

  describe("list", () => {
    it("returns empty array initially", async () => {
      const rows = await caller.settings.mortgageLoans.list();
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(0);
    });
  });

  describe("create", () => {
    it("creates a mortgage loan and returns it", async () => {
      const created = await caller.settings.mortgageLoans.create(baseLoan);
      expect(created).toBeDefined();
      expect(created!.name).toBe("Primary Mortgage");
      expect(created!.isActive).toBe(true);
      expect(created!.termYears).toBe(30);
      expect(created!.principalAndInterest).toBe("1770.09");
    });

    it("creates a second loan", async () => {
      const created = await caller.settings.mortgageLoans.create({
        ...baseLoan,
        name: "Rental Property",
        isActive: false,
        originalLoanAmount: "200000",
      });
      expect(created!.name).toBe("Rental Property");
    });

    it("list returns both loans", async () => {
      const rows = await caller.settings.mortgageLoans.list();
      expect(rows.length).toBe(2);
    });
  });

  describe("update", () => {
    it("updates a loan name and returns the updated row", async () => {
      const rows = await caller.settings.mortgageLoans.list();
      const loan = rows[0]!;
      const updated = await caller.settings.mortgageLoans.update({
        id: loan.id,
        ...baseLoan,
        name: "Updated Mortgage",
      });
      expect(updated!.name).toBe("Updated Mortgage");
      expect(updated!.id).toBe(loan.id);
    });
  });

  describe("delete", () => {
    it("deletes a loan", async () => {
      const rows = await caller.settings.mortgageLoans.list();
      const beforeCount = rows.length;
      await caller.settings.mortgageLoans.delete({ id: rows[0]!.id });
      const afterRows = await caller.settings.mortgageLoans.list();
      expect(afterRows.length).toBe(beforeCount - 1);
    });
  });

  describe("auth", () => {
    it("viewer can list mortgage loans", async () => {
      const { caller: viewerCaller, cleanup: vc } =
        await createTestCaller(viewerSession);
      try {
        const rows = await viewerCaller.settings.mortgageLoans.list();
        expect(Array.isArray(rows)).toBe(true);
      } finally {
        vc();
      }
    });

    it("viewer cannot create a mortgage loan", async () => {
      const { caller: viewerCaller, cleanup: vc } =
        await createTestCaller(viewerSession);
      try {
        await expect(
          viewerCaller.settings.mortgageLoans.create(baseLoan),
        ).rejects.toThrow();
      } finally {
        vc();
      }
    });
  });

  describe("create with optional fields", () => {
    it("creates a loan with refinancedFromId and paidOffDate", async () => {
      // Create first loan to reference
      const first = await caller.settings.mortgageLoans.create(baseLoan);
      const created = await caller.settings.mortgageLoans.create({
        ...baseLoan,
        name: "Refi Loan",
        refinancedFromId: first!.id,
        paidOffDate: "2024-06-01",
        pmi: "50.00",
        insuranceAndTaxes: "200.00",
        totalEscrow: "300.00",
        propertyValueEstimated: "400000",
      });
      expect(created!.refinancedFromId).toBe(first!.id);
      expect(created!.paidOffDate).toBe("2024-06-01");
      expect(created!.pmi).toBe("50.00");
    });
  });
});

// ---------------------------------------------------------------------------
// MORTGAGE WHAT-IF SCENARIOS
// ---------------------------------------------------------------------------

describe("settings.mortgageWhatIfScenarios", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;
  let loanId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;

    // Seed a loan for FK references
    const loan = await caller.settings.mortgageLoans.create({
      name: "Test Loan",
      isActive: true,
      principalAndInterest: "1500",
      interestRate: "0.06",
      termYears: 30,
      originalLoanAmount: "250000",
      firstPaymentDate: "2023-01-01",
      propertyValuePurchase: "300000",
    });
    loanId = loan!.id;
  });

  afterAll(() => cleanup());

  describe("list", () => {
    it("returns empty array initially", async () => {
      const rows = await caller.settings.mortgageWhatIfScenarios.list();
      expect(rows).toHaveLength(0);
    });
  });

  describe("CRUD", () => {
    let scenarioId: number;

    it("creates a what-if scenario", async () => {
      const created = await caller.settings.mortgageWhatIfScenarios.create({
        loanId,
        label: "+$200/month",
        extraMonthlyPrincipal: "200",
        sortOrder: 1,
      });
      expect(created).toBeDefined();
      expect(created!.label).toBe("+$200/month");
      scenarioId = created!.id;
    });

    it("creates scenario without loanId (applies to all)", async () => {
      const created = await caller.settings.mortgageWhatIfScenarios.create({
        label: "Global +$500/month",
        extraMonthlyPrincipal: "500",
        sortOrder: 2,
      });
      expect(created!.loanId).toBeNull();
    });

    it("list returns created scenarios", async () => {
      const rows = await caller.settings.mortgageWhatIfScenarios.list();
      expect(rows.length).toBe(2);
    });

    it("updates a scenario", async () => {
      const updated = await caller.settings.mortgageWhatIfScenarios.update({
        id: scenarioId,
        loanId,
        label: "+$300/month",
        extraMonthlyPrincipal: "300",
        sortOrder: 1,
      });
      expect(updated!.label).toBe("+$300/month");
      expect(updated!.extraMonthlyPrincipal).toBe("300");
    });

    it("deletes a scenario", async () => {
      await caller.settings.mortgageWhatIfScenarios.delete({ id: scenarioId });
      const rows = await caller.settings.mortgageWhatIfScenarios.list();
      expect(rows.every((r) => r.id !== scenarioId)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// MORTGAGE EXTRA PAYMENTS
// ---------------------------------------------------------------------------

describe("settings.mortgageExtraPayments", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;
  let loanId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;

    const loan = await caller.settings.mortgageLoans.create({
      name: "EP Test Loan",
      isActive: true,
      principalAndInterest: "1500",
      interestRate: "0.06",
      termYears: 30,
      originalLoanAmount: "250000",
      firstPaymentDate: "2023-01-01",
      propertyValuePurchase: "300000",
    });
    loanId = loan!.id;
  });

  afterAll(() => cleanup());

  describe("CRUD", () => {
    let paymentId: number;

    it("list is empty initially", async () => {
      const rows = await caller.settings.mortgageExtraPayments.list();
      expect(rows).toHaveLength(0);
    });

    it("creates a one-time extra payment", async () => {
      const created = await caller.settings.mortgageExtraPayments.create({
        loanId,
        paymentDate: "2023-06-15",
        amount: "5000",
        isActual: true,
        notes: "Bonus payment",
      });
      expect(created).toBeDefined();
      expect(created!.amount).toBe("5000");
      expect(created!.isActual).toBe(true);
      paymentId = created!.id;
    });

    it("creates a recurring extra payment range", async () => {
      const created = await caller.settings.mortgageExtraPayments.create({
        loanId,
        startDate: "2024-01-01",
        endDate: "2024-12-01",
        amount: "200",
        isActual: false,
      });
      expect(created!.startDate).toBe("2024-01-01");
      expect(created!.endDate).toBe("2024-12-01");
    });

    it("list returns created payments", async () => {
      const rows = await caller.settings.mortgageExtraPayments.list();
      expect(rows.length).toBe(2);
    });

    it("updates an extra payment", async () => {
      const updated = await caller.settings.mortgageExtraPayments.update({
        id: paymentId,
        loanId,
        paymentDate: "2023-07-15",
        amount: "7500",
        isActual: true,
        notes: "Updated bonus",
      });
      expect(updated!.amount).toBe("7500");
      expect(updated!.paymentDate).toBe("2023-07-15");
    });

    it("deletes an extra payment", async () => {
      await caller.settings.mortgageExtraPayments.delete({ id: paymentId });
      const rows = await caller.settings.mortgageExtraPayments.list();
      expect(rows.every((r) => r.id !== paymentId)).toBe(true);
    });
  });
});
