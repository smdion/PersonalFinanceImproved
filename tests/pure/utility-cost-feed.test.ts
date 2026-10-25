/**
 * Utilities cost feed: the month's cost per utility from the synced budget,
 * shifted by the billing lag, never overwriting someone else's cost.
 */
import { describe, it, expect } from "vitest";
import {
  feedMonths,
  reconcileFeed,
  serviceMonth,
} from "@/lib/pure/utility-cost-feed";
import type { BudgetTransaction } from "@/lib/budget-api/types";

const tx = (
  o: Partial<BudgetTransaction> & Pick<BudgetTransaction, "date" | "amount">,
): BudgetTransaction => ({
  id: Math.random().toString(),
  accountId: "a",
  accountName: "Checking",
  payeeName: null,
  categoryId: null,
  categoryName: null,
  memo: null,
  cleared: true,
  approved: true,
  deleted: false,
  ...o,
});

const services = [
  { serviceId: 1, categoryId: "gas", billingLagMonths: 1 },
  { serviceId: 2, categoryId: "water", billingLagMonths: 1 },
  { serviceId: 3, categoryId: "electric", billingLagMonths: 0 },
];

describe("serviceMonth", () => {
  it("shifts back the lag, across a year boundary", () => {
    expect(serviceMonth(2025, 2, 1)).toEqual({ year: 2025, month: 1 });
    expect(serviceMonth(2025, 1, 1)).toEqual({ year: 2024, month: 12 });
    expect(serviceMonth(2025, 3, 0)).toEqual({ year: 2025, month: 3 });
  });
});

describe("feedMonths", () => {
  it("sums outflows per service month; refunds and other categories are ignored", () => {
    const months = feedMonths(
      [
        tx({ date: "2025-02-05", amount: -140.1, categoryId: "gas" }),
        tx({ date: "2025-02-20", amount: -9.9, categoryId: "gas" }),
        tx({ date: "2025-02-21", amount: 20, categoryId: "gas" }), // refund
        tx({ date: "2025-02-22", amount: -50, categoryId: "groceries" }),
        tx({ date: "2025-02-23", amount: -60, categoryId: "electric" }),
        tx({
          date: "2025-02-24",
          amount: -99,
          categoryId: "gas",
          deleted: true,
        }),
      ],
      services,
    );
    expect(months).toEqual(
      expect.arrayContaining([
        { serviceId: 1, year: 2025, month: 1, cost: 150 },
        { serviceId: 3, year: 2025, month: 2, cost: 60 },
      ]),
    );
    expect(months).toHaveLength(2);
  });

  it("counts a split's parts (water inside a split); the parent counts only unsplit", () => {
    const months = feedMonths(
      [
        tx({
          date: "2025-03-04",
          amount: -140,
          categoryId: "water", // Actual keeps the parent's category
          subtransactions: [
            {
              categoryId: "water",
              categoryName: null,
              amount: -90,
              memo: null,
            },
            {
              categoryId: "trash",
              categoryName: null,
              amount: -50,
              memo: null,
            },
          ],
        }),
      ],
      services,
    );
    expect(months).toEqual([{ serviceId: 2, year: 2025, month: 2, cost: 90 }]);
  });
});

describe("reconcileFeed", () => {
  const months = [
    { serviceId: 1, year: 2025, month: 1, cost: 150 },
    { serviceId: 1, year: 2025, month: 2, cost: 120 },
    { serviceId: 1, year: 2025, month: 3, cost: 110 },
    { serviceId: 1, year: 2025, month: 4, cost: 100 },
  ];
  const existing = [
    { serviceId: 1, year: 2025, month: 2, cost: 100, source: "ynab" as const },
    {
      serviceId: 1,
      year: 2025,
      month: 3,
      cost: 105,
      source: "manual" as const,
    },
    { serviceId: 1, year: 2025, month: 4, cost: 100, source: null },
  ];

  it("fills empty months and refreshes its own; others' different costs are conflicts", () => {
    const { changes, conflicts } = reconcileFeed(months, existing, "ynab");
    expect(changes).toEqual([
      { serviceId: 1, year: 2025, month: 1, cost: 150, previous: null },
      { serviceId: 1, year: 2025, month: 2, cost: 120, previous: 100 },
    ]);
    expect(conflicts).toEqual([
      {
        serviceId: 1,
        year: 2025,
        month: 3,
        cost: 110,
        previous: 105,
        previousSource: "manual",
      },
    ]);
  });

  it("after switching budget services, the old service's months are conflicts", () => {
    const { changes, conflicts } = reconcileFeed(months, existing, "actual");
    expect(changes.map((c) => c.month)).toEqual([1]);
    expect(conflicts.map((c) => [c.month, c.previousSource])).toEqual([
      [2, "ynab"],
      [3, "manual"],
    ]);
  });
});
