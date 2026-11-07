/**
 * Smoke test for the Utilities page (v0.10.4 commit 5a): a utility's card
 * renders, and adding a month's reading sends utilities.upsertReading.
 */
// The page mounted on a seeded baseline household, its queries answered by
// the router (tests/baseline/screen-mount.tsx); mutations are recorded by
// trpc-mock, not run.
import "../routers/setup-mocks";
import "../baseline/mocks";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { seededPage } from "../baseline/screen-mount";
import { mutationCalls } from "./trpc-mock";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("../baseline/screen-mount")).screenTrpc(
    (await import("./trpc-mock")).trpc,
  ),
}));

const page = seededPage(
  "e2e-b",
  async () =>
    (await import("@/app/(dashboard)/upkeep/utilities/utilities-content"))
      .default,
);

describe("Utilities page", () => {
  it("shows the empty state with no utility", async () => {
    await page.mount();
    expect(screen.getByRole("heading", { name: "Utilities" })).toBeTruthy();
    expect(screen.getByText("No utility data yet")).toBeTruthy();
  });

  it("adds a month's reading to a utility", async () => {
    // An invented gas service, written through the app's own procedure.
    await page.household().caller.utilities.upsertService({
      kind: "gas",
      providerName: "Example Gas Co",
      usageUnit: "ccf",
    });
    page.fresh();
    await page.mount();
    expect(screen.getByText("Gas — Example Gas Co")).toBeTruthy();
    fireEvent.click(screen.getByTitle("Unlock to edit"));
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    fireEvent.change(screen.getByPlaceholderText("Cost"), {
      target: { value: "84.50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mutationCalls("utilities.upsertReading")).toEqual([
      {
        serviceId: expect.any(Number),
        year: 2026,
        month: 1,
        cost: "84.50",
        usage: null,
        note: null,
      },
    ]);
  });
});
