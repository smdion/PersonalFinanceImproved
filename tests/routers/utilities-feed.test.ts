/**
 * Utilities cost feed (utilities router): mapping a service to a budget
 * category, previewing and applying a pull, and who wrote each cost.
 * Works the same for YNAB and Actual — both run here.
 */
import "./setup-mocks";
import { describe, it, expect } from "vitest";
import { createTestCaller, adminSession, viewerSession } from "./setup";
import * as schema from "@/lib/db/schema-sqlite";
import type { BudgetTransaction } from "@/lib/budget-api/types";

const txn = (
  date: string,
  amount: number,
  categoryId: string | null,
  subtransactions?: BudgetTransaction["subtransactions"],
): BudgetTransaction => ({
  id: `${date}-${amount}-${categoryId}`,
  date,
  amount,
  categoryId,
  categoryName: null,
  payeeName: null,
  memo: null,
  accountId: "acct",
  accountName: "Checking",
  cleared: true,
  approved: true,
  deleted: false,
  ...(subtransactions && { subtransactions }),
});

async function household(service: "ynab" | "actual") {
  const t = await createTestCaller(adminSession);
  const { db, caller } = t;
  db.insert(schema.appSettings)
    .values({ key: "active_budget_api", value: service })
    .run();
  db.insert(schema.budgetApiCache)
    .values([
      {
        service,
        cacheKey: "categories",
        data: [
          {
            id: "g",
            name: "Utilities",
            hidden: false,
            categories: [
              {
                id: "cat-gas",
                name: "Natural Gas",
                groupId: "g",
                groupName: "Utilities",
                hidden: false,
                budgeted: 0,
                activity: 0,
                balance: 0,
              },
              {
                id: "cat-water",
                name: "Water",
                groupId: "g",
                groupName: "Utilities",
                hidden: false,
                budgeted: 0,
                activity: 0,
                balance: 0,
              },
            ],
          },
        ],
      },
      {
        service,
        cacheKey: "transactions",
        data: [
          txn("2025-02-05", -140.1, "cat-gas"), // January's gas
          txn("2025-03-04", -120, "cat-gas"), // February's gas
          txn("2025-03-10", 15, "cat-gas"), // a refund: not a cost
          // Water inside a split, paid with another bill.
          txn("2025-02-20", -200, service === "ynab" ? null : "cat-other", [
            {
              categoryId: "cat-water",
              categoryName: "Water",
              amount: -64.5,
              memo: null,
            },
            {
              categoryId: "cat-other",
              categoryName: "Other",
              amount: -135.5,
              memo: null,
            },
          ]),
        ],
      },
    ])
    .run();
  await caller.utilities.upsertService({
    kind: "gas",
    providerName: "Atmos",
    usageUnit: "ccf",
  });
  await caller.utilities.upsertService({
    kind: "water",
    providerName: "City",
    usageUnit: "gallon",
  });
  const services = await caller.utilities.listServices();
  const gas = services.find((s) => s.kind === "gas")!;
  const water = services.find((s) => s.kind === "water")!;
  await caller.utilities.updateService({
    id: gas.id,
    budgetApiCategoryId: "cat-gas",
    billingLagMonths: 1,
  });
  await caller.utilities.updateService({
    id: water.id,
    budgetApiCategoryId: "cat-water",
    billingLagMonths: 1,
  });
  return { ...t, gas, water };
}

describe.each(["ynab", "actual"] as const)(
  "utilities cost feed (%s)",
  (service) => {
    it("lists the budget's categories for the mapping picker", async () => {
      const { caller, cleanup } = await household(service);
      try {
        const r = await caller.utilities.listBudgetApiCategories();
        expect(r.service).toBe(service);
        expect(r.categories).toEqual([
          { id: "cat-gas", groupName: "Utilities", name: "Natural Gas" },
          { id: "cat-water", groupName: "Utilities", name: "Water" },
        ]);
      } finally {
        cleanup();
      }
    });

    it("previews then writes costs by service month — split parts included, refunds and usage left out", async () => {
      const { caller, gas, water, cleanup } = await household(service);
      try {
        const plan = await caller.utilities.previewBudgetApiFeed();
        expect(plan.conflicts).toEqual([]);
        expect(
          plan.changes.map((c) => [
            c.serviceId,
            c.year,
            c.month,
            c.cost,
            c.previous,
          ]),
        ).toEqual([
          [gas.id, 2025, 2, 105, null], // 120 less the 15 refund
          [gas.id, 2025, 1, 140.1, null],
          [water.id, 2025, 1, 64.5, null],
        ]);
        expect(
          await caller.utilities.applyBudgetApiFeed({
            planHash: plan.planHash,
          }),
        ).toEqual({ written: 3 });
        const gasYear = (await caller.utilities.computeSummary()).summaries
          .find((s) => s.serviceId === gas.id)!
          .years.find((y) => y.year === 2025)!;
        expect(gasYear.readings.map((r) => [r.month, r.cost, r.usage])).toEqual(
          [
            [1, 140.1, null],
            [2, 105, null],
          ],
        );
        // Pulled again: nothing to do.
        expect((await caller.utilities.previewBudgetApiFeed()).changes).toEqual(
          [],
        );
      } finally {
        cleanup();
      }
    });

    it("never overwrites a cost typed in; a different one is a conflict to review", async () => {
      const { caller, gas, cleanup } = await household(service);
      try {
        await caller.utilities.upsertReading({
          serviceId: gas.id,
          year: 2025,
          month: 1,
          cost: "150",
          usage: "80",
        });
        const plan = await caller.utilities.previewBudgetApiFeed();
        expect(plan.conflicts).toEqual([
          expect.objectContaining({
            serviceId: gas.id,
            year: 2025,
            month: 1,
            cost: 140.1,
            previous: 150,
            previousSource: "manual",
          }),
        ]);
        await caller.utilities.applyBudgetApiFeed({
          planHash: (await caller.utilities.previewBudgetApiFeed()).planHash,
        });
        const jan = (await caller.utilities.computeSummary()).summaries
          .find((s) => s.serviceId === gas.id)!
          .years.find((y) => y.year === 2025)!
          .readings.find((r) => r.month === 1)!;
        expect([jan.cost, jan.usage]).toEqual([150, 80]);
      } finally {
        cleanup();
      }
    });
  },
);

describe("utilities cost feed — who wrote the cost", () => {
  it("adding usage to a fed month keeps it the feed's; changing the cost makes it typed in", async () => {
    const { caller, db, gas, cleanup } = await household("ynab");
    try {
      await caller.utilities.applyBudgetApiFeed({
        planHash: (await caller.utilities.previewBudgetApiFeed()).planHash,
      });
      const source = () =>
        db
          .select()
          .from(schema.utilityReading)
          .all()
          .find((r) => r.serviceId === gas.id && r.month === 1)!.source;
      expect(source()).toBe("ynab");
      await caller.utilities.upsertReading({
        serviceId: gas.id,
        year: 2025,
        month: 1,
        cost: "140.10",
        usage: "75",
      });
      expect(source()).toBe("ynab");
      await caller.utilities.upsertReading({
        serviceId: gas.id,
        year: 2025,
        month: 1,
        cost: "141",
        usage: "75",
      });
      expect(source()).toBe("manual");
    } finally {
      cleanup();
    }
  });

  it("nothing mapped or nothing synced: an empty plan; only an admin can pull", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      expect(await caller.utilities.previewBudgetApiFeed()).toMatchObject({
        changes: [],
        conflicts: [],
      });
      expect(
        (await caller.utilities.listBudgetApiCategories()).categories,
      ).toEqual([]);
    } finally {
      cleanup();
    }
    const viewer = await createTestCaller(viewerSession);
    try {
      await expect(
        viewer.caller.utilities.applyBudgetApiFeed({ planHash: "x" }),
      ).rejects.toThrow();
    } finally {
      viewer.cleanup();
    }
  });

  it("applies only the plan that was reviewed — a cost typed in since isn't overwritten", async () => {
    const { caller, gas, cleanup } = await household("ynab");
    try {
      const plan = await caller.utilities.previewBudgetApiFeed();
      // Someone types January's gas in after the review.
      await caller.utilities.upsertReading({
        serviceId: gas.id,
        year: 2025,
        month: 1,
        cost: "150",
      });
      await expect(
        caller.utilities.applyBudgetApiFeed({ planHash: plan.planHash }),
      ).rejects.toThrow(/changed since you reviewed/);
      const jan = (await caller.utilities.computeSummary()).summaries
        .find((s) => s.serviceId === gas.id)!
        .years.find((y) => y.year === 2025)!
        .readings.find((r) => r.month === 1)!;
      expect(jan.cost).toBe(150);
    } finally {
      cleanup();
    }
  });

  it("two utilities can't be fed from one category; an inactive utility isn't fed", async () => {
    const { caller, gas, water, cleanup } = await household("ynab");
    try {
      await expect(
        caller.utilities.updateService({
          id: water.id,
          budgetApiCategoryId: "cat-gas",
        }),
      ).rejects.toThrow(/already fed/);
      await caller.utilities.updateService({ id: gas.id, active: false });
      const plan = await caller.utilities.previewBudgetApiFeed();
      expect(plan.changes.every((c) => c.serviceId !== gas.id)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("a year's cost per unit counts only months with usage (fed months are cost-only)", async () => {
    const { caller, gas, cleanup } = await household("ynab");
    try {
      await caller.utilities.upsertReading({
        serviceId: gas.id,
        year: 2024,
        month: 1,
        cost: "100",
        usage: "50",
      });
      await caller.utilities.upsertReading({
        serviceId: gas.id,
        year: 2024,
        month: 2,
        cost: "300",
      });
      const y = (await caller.utilities.computeSummary()).summaries
        .find((s) => s.serviceId === gas.id)!
        .years.find((y) => y.year === 2024)!;
      expect(y.totalCost).toBe(400);
      expect(y.costPerUnit).toBe(2); // 100 / 50, not 400 / 50
    } finally {
      cleanup();
    }
  });
});
