/**
 * Settings/retirement router integration tests.
 *
 * Tests CRUD operations for:
 *   - settings.retirementSettings (list / upsert)
 *   - settings.retirementSalaryOverrides (list / create / update / delete)
 *   - settings.retirementBudgetOverrides (list / create / update / delete)
 *   - settings.retirementScenarios (list / create / update / delete)
 *   - settings.returnRates (list / upsert / delete)
 */
import "./setup-mocks";
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestCaller,
  seedPerson,
  viewerSession,
  adminSession,
} from "./setup";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// RETIREMENT SETTINGS
// ---------------------------------------------------------------------------

describe("settings.retirementSettings", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;
  let personId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    personId = await seedPerson(db);
  });

  afterAll(() => cleanup());

  const baseSettings = () => ({
    personId: personId,
    retirementAge: 65,
    endAge: 95,
    returnAfterRetirement: "0.04",
    annualInflation: "0.03",
    salaryAnnualIncrease: "0.03",
  });

  describe("list", () => {
    it("returns empty array initially", async () => {
      const rows = await caller.settings.retirementSettings.list();
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(0);
    });
  });

  describe("upsert (insert)", () => {
    it("inserts retirement settings for a person", async () => {
      const result =
        await caller.settings.retirementSettings.upsert(baseSettings());
      expect(result).toBeDefined();
      expect(result!.personId).toBe(personId);
      expect(result!.retirementAge).toBe(65);
      expect(result!.endAge).toBe(95);
    });

    it("list returns the inserted settings", async () => {
      const rows = await caller.settings.retirementSettings.list();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.personId).toBe(personId);
    });
  });

  describe("upsert (update)", () => {
    it("updates existing settings for the same person", async () => {
      const result = await caller.settings.retirementSettings.upsert({
        ...baseSettings(),
        retirementAge: 60,
        endAge: 90,
        withdrawalRate: "0.035",
      });
      expect(result!.retirementAge).toBe(60);
      expect(result!.endAge).toBe(90);
      expect(result!.withdrawalRate).toBe("0.035");
    });

    it("still only one row after update", async () => {
      const rows = await caller.settings.retirementSettings.list();
      expect(rows).toHaveLength(1);
    });
  });

  describe("upsert with optional fields", () => {
    it("accepts all optional fields", async () => {
      const result = await caller.settings.retirementSettings.upsert({
        ...baseSettings(),
        postRetirementInflation: "0.025",
        salaryCap: "200000",
        withdrawalRate: "0.04",
        taxMultiplier: "1.25",
        grossUpForTaxes: true,
        socialSecurityMonthly: "2500",
        ssStartAge: 67,
        filingStatus: "MFJ",
      });
      expect(result!.postRetirementInflation).toBe("0.025");
      expect(result!.salaryCap).toBe("200000");
      expect(result!.socialSecurityMonthly).toBe("2500");
      expect(result!.ssStartAge).toBe(67);
    });
  });

  describe("auth", () => {
    it("viewer can list retirement settings", async () => {
      const { caller: viewerCaller, cleanup: vc } =
        await createTestCaller(viewerSession);
      try {
        const rows = await viewerCaller.settings.retirementSettings.list();
        expect(Array.isArray(rows)).toBe(true);
      } finally {
        vc();
      }
    });

    it("viewer cannot upsert retirement settings", async () => {
      const { caller: viewerCaller, cleanup: vc } =
        await createTestCaller(viewerSession);
      try {
        await expect(
          viewerCaller.settings.retirementSettings.upsert(baseSettings()),
        ).rejects.toThrow();
      } finally {
        vc();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// RETIREMENT SALARY OVERRIDES
// ---------------------------------------------------------------------------

describe("settings.retirementSalaryOverrides", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;
  let personId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    personId = await seedPerson(db);
  });

  afterAll(() => cleanup());

  describe("CRUD", () => {
    let overrideId: number;

    it("list is empty initially", async () => {
      const rows = await caller.settings.retirementSalaryOverrides.list();
      expect(rows).toHaveLength(0);
    });

    it("creates a salary override", async () => {
      const created = await caller.settings.retirementSalaryOverrides.create({
        personId,
        projectionYear: 2030,
        overrideSalary: "150000",
        notes: "Promotion expected",
      });
      expect(created).toBeDefined();
      expect(created!.projectionYear).toBe(2030);
      expect(created!.overrideSalary).toBe("150000");
      expect(created!.createdBy).toContain("Test Admin");
      overrideId = created!.id;
    });

    it("creates a second override for a different year", async () => {
      await caller.settings.retirementSalaryOverrides.create({
        personId,
        projectionYear: 2035,
        overrideSalary: "180000",
      });
      const rows = await caller.settings.retirementSalaryOverrides.list();
      expect(rows.length).toBe(2);
    });

    it("list returns overrides ordered by projectionYear", async () => {
      const rows = await caller.settings.retirementSalaryOverrides.list();
      expect(rows[0]!.projectionYear).toBeLessThanOrEqual(
        rows[1]!.projectionYear,
      );
    });

    it("updates a salary override", async () => {
      const updated = await caller.settings.retirementSalaryOverrides.update({
        id: overrideId,
        personId,
        projectionYear: 2030,
        overrideSalary: "160000",
        notes: "Revised promotion",
      });
      expect(updated!.overrideSalary).toBe("160000");
      expect(updated!.updatedBy).toContain("Test Admin");
    });

    it("deletes a salary override", async () => {
      await caller.settings.retirementSalaryOverrides.delete({
        id: overrideId,
      });
      const rows = await caller.settings.retirementSalaryOverrides.list();
      expect(rows.every((r) => r.id !== overrideId)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// RETIREMENT BUDGET OVERRIDES
// ---------------------------------------------------------------------------

describe("settings.retirementBudgetOverrides", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;
  let personId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    personId = await seedPerson(db);
  });

  afterAll(() => cleanup());

  describe("CRUD", () => {
    let overrideId: number;

    it("list is empty initially", async () => {
      const rows = await caller.settings.retirementBudgetOverrides.list();
      expect(rows).toHaveLength(0);
    });

    it("creates a budget override", async () => {
      const created = await caller.settings.retirementBudgetOverrides.create({
        personId,
        projectionYear: 2032,
        overrideMonthlyBudget: "5000",
        notes: "Lower spending after mortgage paid off",
      });
      expect(created).toBeDefined();
      expect(created!.overrideMonthlyBudget).toBe("5000");
      expect(created!.createdBy).toContain("Test Admin");
      overrideId = created!.id;
    });

    it("list returns created overrides", async () => {
      const rows = await caller.settings.retirementBudgetOverrides.list();
      expect(rows.length).toBe(1);
    });

    it("updates a budget override", async () => {
      const updated = await caller.settings.retirementBudgetOverrides.update({
        id: overrideId,
        personId,
        projectionYear: 2032,
        overrideMonthlyBudget: "4500",
        notes: "Revised estimate",
      });
      expect(updated!.overrideMonthlyBudget).toBe("4500");
      expect(updated!.updatedBy).toContain("Test Admin");
    });

    it("deletes a budget override", async () => {
      await caller.settings.retirementBudgetOverrides.delete({
        id: overrideId,
      });
      const rows = await caller.settings.retirementBudgetOverrides.list();
      expect(rows).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// RETIREMENT SCENARIOS
// ---------------------------------------------------------------------------

describe("settings.retirementScenarios", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  describe("CRUD", () => {
    let scenarioId: number;

    it("list is empty initially", async () => {
      const rows = await caller.settings.retirementScenarios.list();
      expect(rows).toHaveLength(0);
    });

    it("creates a scenario", async () => {
      const created = await caller.settings.retirementScenarios.create({
        name: "Conservative",
        withdrawalRate: "0.035",
        targetAnnualIncome: "70000",
        annualInflation: "0.03",
        isSelected: true,
      });
      expect(created).toBeDefined();
      expect(created!.name).toBe("Conservative");
      expect(created!.withdrawalRate).toBe("0.035");
      expect(created!.isSelected).toBe(true);
      scenarioId = created!.id;
    });

    it("creates a second scenario with custom tax rates", async () => {
      const created = await caller.settings.retirementScenarios.create({
        name: "Aggressive",
        withdrawalRate: "0.05",
        targetAnnualIncome: "100000",
        annualInflation: "0.025",
        distributionTaxRateTraditional: "0.25",
        distributionTaxRateRoth: "0",
        distributionTaxRateHsa: "0",
        distributionTaxRateBrokerage: "0.15",
        isLtBrokerageEnabled: true,
        ltBrokerageAnnualContribution: "12000",
        notes: "Optimistic scenario",
      });
      expect(created!.distributionTaxRateTraditional).toBe("0.25");
      expect(created!.ltBrokerageAnnualContribution).toBe("12000");
    });

    it("list returns both scenarios ordered by id", async () => {
      const rows = await caller.settings.retirementScenarios.list();
      expect(rows.length).toBe(2);
      expect(rows[0]!.id).toBeLessThan(rows[1]!.id);
    });

    it("updates a scenario", async () => {
      const updated = await caller.settings.retirementScenarios.update({
        id: scenarioId,
        name: "Moderate Conservative",
        withdrawalRate: "0.038",
        targetAnnualIncome: "75000",
        annualInflation: "0.03",
        isSelected: false,
      });
      expect(updated!.name).toBe("Moderate Conservative");
      expect(updated!.withdrawalRate).toBe("0.038");
      expect(updated!.isSelected).toBe(false);
    });

    it("deletes a scenario", async () => {
      await caller.settings.retirementScenarios.delete({ id: scenarioId });
      const rows = await caller.settings.retirementScenarios.list();
      expect(rows.every((r) => r.id !== scenarioId)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// RETURN RATES
// ---------------------------------------------------------------------------

describe("settings.returnRates", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  describe("CRUD", () => {
    it("list is empty initially", async () => {
      const rows = await caller.settings.returnRates.list();
      expect(rows).toHaveLength(0);
    });

    it("upsert inserts a new return rate", async () => {
      const result = await caller.settings.returnRates.upsert({
        age: 30,
        rateOfReturn: "0.08",
      });
      expect(result).toBeDefined();
      expect(result!.age).toBe(30);
      expect(result!.rateOfReturn).toBe("0.08");
    });

    it("upsert inserts a second rate for a different age", async () => {
      await caller.settings.returnRates.upsert({
        age: 60,
        rateOfReturn: "0.05",
      });
      const rows = await caller.settings.returnRates.list();
      expect(rows.length).toBe(2);
    });

    it("list returns rates ordered by age", async () => {
      const rows = await caller.settings.returnRates.list();
      expect(rows[0]!.age).toBeLessThan(rows[1]!.age);
    });

    it("upsert updates an existing rate for the same age", async () => {
      const result = await caller.settings.returnRates.upsert({
        age: 30,
        rateOfReturn: "0.07",
      });
      expect(result!.rateOfReturn).toBe("0.07");

      // Still only two rows
      const rows = await caller.settings.returnRates.list();
      expect(rows.length).toBe(2);
    });

    it("deletes a return rate by id", async () => {
      const rows = await caller.settings.returnRates.list();
      const target = rows.find((r) => r.age === 60)!;
      await caller.settings.returnRates.delete({ id: target.id });
      const afterRows = await caller.settings.returnRates.list();
      expect(afterRows.length).toBe(1);
      expect(afterRows[0]!.age).toBe(30);
    });
  });

  describe("auth", () => {
    it("viewer can list return rates", async () => {
      const { caller: viewerCaller, cleanup: vc } =
        await createTestCaller(viewerSession);
      try {
        const rows = await viewerCaller.settings.returnRates.list();
        expect(Array.isArray(rows)).toBe(true);
      } finally {
        vc();
      }
    });

    it("viewer cannot upsert return rates", async () => {
      const { caller: viewerCaller, cleanup: vc } =
        await createTestCaller(viewerSession);
      try {
        await expect(
          viewerCaller.settings.returnRates.upsert({
            age: 40,
            rateOfReturn: "0.06",
          }),
        ).rejects.toThrow();
      } finally {
        vc();
      }
    });
  });
});
