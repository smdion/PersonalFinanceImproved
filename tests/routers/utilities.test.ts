/**
 * Utilities router integration tests.
 *
 * Covers service CRUD, reading upsert/update/delete, the computeSummary derived
 * math ($/unit, avg/min/max, YoY), cost-only (null usage) rows, admin gating,
 * and input bounds. Uses an isolated SQLite database per test suite.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller, viewerSession } from "./setup";

describe("utilities router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  // ── COMPUTE SUMMARY SHAPE ──

  describe("computeSummary", () => {
    it("returns an empty summaries array when no services exist", async () => {
      const result = await caller.utilities.computeSummary();
      expect(result).toHaveProperty("summaries");
      expect(Array.isArray(result.summaries)).toBe(true);
      expect(result.summaries).toHaveLength(0);
    });
  });

  // ── SERVICE CRUD ──

  describe("service CRUD", () => {
    let serviceId: number;

    it("creates a service via upsertService", async () => {
      const result = await caller.utilities.upsertService({
        kind: "gas",
        providerName: "Atmos",
        usageUnit: "ccf",
        sortOrder: 0,
      });
      expect(result).toEqual({ success: true });
    });

    it("listServices returns the new service", async () => {
      const services = await caller.utilities.listServices();
      const found = services.find((s) => s.kind === "gas");
      expect(found).toBeDefined();
      expect(found!.providerName).toBe("Atmos");
      expect(found!.usageUnit).toBe("ccf");
      serviceId = found!.id;
    });

    it("upsertService on the same kind updates (idempotent by kind)", async () => {
      await caller.utilities.upsertService({
        kind: "gas",
        providerName: "Atmos Energy",
        usageUnit: "ccf",
      });
      const services = await caller.utilities.listServices();
      const gas = services.filter((s) => s.kind === "gas");
      expect(gas).toHaveLength(1); // still one row
      expect(gas[0]!.providerName).toBe("Atmos Energy");
    });

    it("updateService edits provider/sortOrder/active by id", async () => {
      await caller.utilities.updateService({
        id: serviceId,
        providerName: "Atmos (renamed)",
        sortOrder: 5,
        active: false,
      });
      const services = await caller.utilities.listServices();
      const found = services.find((s) => s.id === serviceId);
      expect(found!.providerName).toBe("Atmos (renamed)");
      expect(found!.sortOrder).toBe(5);
      expect(found!.active).toBe(false);
    });
  });

  // ── READING UPSERT / UPDATE / DELETE ──

  describe("reading CRUD", () => {
    let serviceId: number;

    beforeAll(async () => {
      await caller.utilities.upsertService({
        kind: "electric",
        providerName: "MTEMC",
        usageUnit: "kWh",
        sortOrder: 2,
      });
      const services = await caller.utilities.listServices();
      serviceId = services.find((s) => s.kind === "electric")!.id;
    });

    it("upsertReading creates a reading", async () => {
      const result = await caller.utilities.upsertReading({
        serviceId,
        year: 2023,
        month: 1,
        cost: "120.50",
        usage: "800",
      });
      expect(result).toEqual({ success: true });
    });

    it("upsertReading on the same (serviceId, year, month) updates in place", async () => {
      await caller.utilities.upsertReading({
        serviceId,
        year: 2023,
        month: 1,
        cost: "130.00",
        usage: "850",
      });
      const { summaries } = await caller.utilities.computeSummary();
      const svc = summaries.find((s) => s.serviceId === serviceId)!;
      const year = svc.years.find((y) => y.year === 2023)!;
      expect(year.readingCount).toBe(1); // single row, not two
      expect(year.readings[0]!.cost).toBe(130);
      expect(year.readings[0]!.usage).toBe(850);
    });

    it("cost-only reading (null usage) persists with null costPerUnit", async () => {
      await caller.utilities.upsertReading({
        serviceId,
        year: 2023,
        month: 2,
        cost: "90.00",
        usage: null,
      });
      const { summaries } = await caller.utilities.computeSummary();
      const svc = summaries.find((s) => s.serviceId === serviceId)!;
      const year = svc.years.find((y) => y.year === 2023)!;
      const feb = year.readings.find((r) => r.month === 2)!;
      expect(feb.usage).toBeNull();
      expect(feb.costPerUnit).toBeNull();
    });

    it("updateReading edits values by id", async () => {
      const { summaries } = await caller.utilities.computeSummary();
      const svc = summaries.find((s) => s.serviceId === serviceId)!;
      const feb = svc.years
        .find((y) => y.year === 2023)!
        .readings.find((r) => r.month === 2)!;
      await caller.utilities.updateReading({
        id: feb.id,
        cost: "95.00",
        note: "estimated",
      });
      const after = await caller.utilities.computeSummary();
      const febAfter = after.summaries
        .find((s) => s.serviceId === serviceId)!
        .years.find((y) => y.year === 2023)!
        .readings.find((r) => r.month === 2)!;
      expect(febAfter.cost).toBe(95);
      expect(febAfter.note).toBe("estimated");
    });

    it("deleteReading removes the row", async () => {
      const { summaries } = await caller.utilities.computeSummary();
      const svc = summaries.find((s) => s.serviceId === serviceId)!;
      const feb = svc.years
        .find((y) => y.year === 2023)!
        .readings.find((r) => r.month === 2)!;
      await caller.utilities.deleteReading({ id: feb.id });
      const after = await caller.utilities.computeSummary();
      const year = after.summaries
        .find((s) => s.serviceId === serviceId)!
        .years.find((y) => y.year === 2023)!;
      expect(year.readings.find((r) => r.month === 2)).toBeUndefined();
    });
  });

  // ── DERIVED MATH ($/unit, avg/min/max, YoY) ──

  describe("computeSummary derived math", () => {
    let serviceId: number;

    beforeAll(async () => {
      await caller.utilities.upsertService({
        kind: "water",
        providerName: "City",
        usageUnit: "gallon",
        sortOrder: 1,
      });
      serviceId = (await caller.utilities.listServices()).find(
        (s) => s.kind === "water",
      )!.id;

      // 2022: two months — total cost 300, total usage 20 → $/unit 15
      await caller.utilities.upsertReading({
        serviceId,
        year: 2022,
        month: 1,
        cost: "100",
        usage: "10",
      });
      await caller.utilities.upsertReading({
        serviceId,
        year: 2022,
        month: 2,
        cost: "200",
        usage: "10",
      });
      // 2023: one month — total cost 400 → YoY (400-300)/300
      await caller.utilities.upsertReading({
        serviceId,
        year: 2023,
        month: 1,
        cost: "400",
        usage: "20",
      });
    });

    it("computes total/avg/min/max cost and $/unit per year", async () => {
      const { summaries } = await caller.utilities.computeSummary();
      const svc = summaries.find((s) => s.serviceId === serviceId)!;
      const y2022 = svc.years.find((y) => y.year === 2022)!;
      expect(y2022.totalCost).toBe(300);
      expect(y2022.avgCost).toBe(150);
      expect(y2022.minCost).toBe(100);
      expect(y2022.maxCost).toBe(200);
      expect(y2022.totalUsage).toBe(20);
      expect(y2022.costPerUnit).toBe(15);
    });

    it("computes per-reading $/unit", async () => {
      const { summaries } = await caller.utilities.computeSummary();
      const svc = summaries.find((s) => s.serviceId === serviceId)!;
      const y2022 = svc.years.find((y) => y.year === 2022)!;
      const jan = y2022.readings.find((r) => r.month === 1)!;
      const feb = y2022.readings.find((r) => r.month === 2)!;
      expect(jan.costPerUnit).toBe(10); // 100 / 10
      expect(feb.costPerUnit).toBe(20); // 200 / 10
    });

    it("computes YoY cost change (null for the first year)", async () => {
      const { summaries } = await caller.utilities.computeSummary();
      const svc = summaries.find((s) => s.serviceId === serviceId)!;
      const y2022 = svc.years.find((y) => y.year === 2022)!;
      const y2023 = svc.years.find((y) => y.year === 2023)!;
      expect(y2022.yoyCostPct).toBeNull();
      expect(y2023.yoyCostPct).toBeCloseTo((400 - 300) / 300, 5);
    });

    it("exposes latest-year rollups on the service summary", async () => {
      const { summaries } = await caller.utilities.computeSummary();
      const svc = summaries.find((s) => s.serviceId === serviceId)!;
      expect(svc.latestYear).toBe(2023);
      expect(svc.latestYearTotalCost).toBe(400);
      expect(svc.latestCostPerUnit).toBe(20); // 400 / 20
    });
  });

  // ── ADMIN GATING ──

  describe("permission gating", () => {
    it("non-admin caller cannot upsertReading (FORBIDDEN)", async () => {
      const { caller: viewer, cleanup: vCleanup } =
        await createTestCaller(viewerSession);
      try {
        await expect(
          viewer.utilities.upsertReading({
            serviceId: 1,
            year: 2023,
            month: 1,
            cost: "100",
          }),
        ).rejects.toThrow();
      } finally {
        vCleanup();
      }
    });

    it("non-admin caller can still read computeSummary", async () => {
      const { caller: viewer, cleanup: vCleanup } =
        await createTestCaller(viewerSession);
      try {
        const result = await viewer.utilities.computeSummary();
        expect(result).toHaveProperty("summaries");
      } finally {
        vCleanup();
      }
    });
  });

  // ── INPUT BOUNDS ──

  describe("input validation", () => {
    it("rejects an out-of-range month", async () => {
      await expect(
        caller.utilities.upsertReading({
          serviceId: 1,
          year: 2023,
          month: 13,
          cost: "100",
        }),
      ).rejects.toThrow();
    });

    it("rejects an out-of-range year", async () => {
      await expect(
        caller.utilities.upsertReading({
          serviceId: 1,
          year: 1800,
          month: 1,
          cost: "100",
        }),
      ).rejects.toThrow();
    });

    it("rejects a non-numeric cost (zDecimal)", async () => {
      await expect(
        caller.utilities.upsertReading({
          serviceId: 1,
          year: 2023,
          month: 1,
          cost: "not-a-number",
        }),
      ).rejects.toThrow();
    });

    it("rejects an invalid kind on upsertService", async () => {
      await expect(
        // @ts-expect-error — invalid kind rejected at the zod layer
        caller.utilities.upsertService({ kind: "internet", providerName: "X" }),
      ).rejects.toThrow();
    });
  });
});
