/**
 * Smoke test for the Historical page (v0.10.4 commit 5a, before 16 moves
 * it): the year-end table renders with the current year and a past one,
 * and editing a past year's cell sends historical.update.
 */
// The page mounted on a seeded baseline household, its queries answered by
// the router (tests/baseline/screen-mount.tsx); mutations are recorded by
// trpc-mock, not run.
import "../routers/setup-mocks";
import "../baseline/mocks";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import * as schema from "@/lib/db/schema-sqlite";
import { invalidateYearEndCache } from "@/server/services/net-worth/year-end-history";
import { seededPage } from "../baseline/screen-mount";
import { mutationCalls } from "./trpc-mock";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("../baseline/screen-mount")).screenTrpc(
    (await import("./trpc-mock")).trpc,
  ),
}));

const page = seededPage(
  "e2e-b",
  async () => (await import("@/app/(dashboard)/historical/page")).default,
);

describe("Historical page", () => {
  it("shows the year-end table with the current year", async () => {
    await page.mount();
    expect(screen.getByRole("heading", { name: "Historical" })).toBeTruthy();
    expect(screen.getByText("2026")).toBeTruthy();
    expect(screen.getAllByText("$881,028.48").length).toBeGreaterThan(0);
  });

  it("saves a past year's edited cell", async () => {
    // A finalized 2025 (the seeder writes only today's snapshot).
    page
      .household()
      .db.insert(schema.netWorthAnnual)
      .values({
        yearEndDate: "2025-12-31",
        grossIncome: "250000",
        combinedAgi: "0",
        cash: "0",
        houseValue: "0",
        retirementTotal: "0",
        hsa: "0",
        ltBrokerage: "0",
        espp: "0",
        rBrokerage: "0",
        otherAssets: "0",
        mortgageBalance: "0",
        otherLiabilities: "0",
        taxFreeTotal: "0",
        taxDeferredTotal: "0",
        portfolioTotal: "0",
        portfolioByTaxLocation: { retirement: {}, portfolio: {} },
      })
      .run();
    invalidateYearEndCache();
    page.fresh();
    await page.mount();
    const row = screen.getByText("2025").closest("tr")!;
    const cell = within(row).getAllByTitle("Double-click to edit")[0]!;
    fireEvent.doubleClick(cell);
    const input = within(row).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "1234" } });
    fireEvent.blur(input);
    expect(mutationCalls("historical.update")).toEqual([
      { year: 2025, fields: { otherLiabilities: 1234 } },
    ]);
  });
});
