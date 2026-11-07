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
      .UtilitiesContent,
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

  it("opens a month's reading for editing from its month button", async () => {
    const caller = page.household().caller;
    await caller.utilities.upsertService({
      kind: "gas",
      providerName: "Example Gas Co",
      usageUnit: "ccf",
    });
    const [service] = await caller.utilities.listServices();
    await caller.utilities.upsertReading({
      serviceId: service!.id,
      year: 2026,
      month: 2,
      cost: "61.25",
      usage: "48",
    });
    page.fresh();
    await page.mount();
    expect(screen.queryByRole("button", { name: "Feb" })).toBeNull();
    fireEvent.click(screen.getByTitle("Unlock to edit"));
    fireEvent.click(screen.getByRole("button", { name: "Feb" }));
    expect(screen.getByDisplayValue("61.25")).toBeTruthy();
    expect(screen.getByDisplayValue("48")).toBeTruthy();
  });
});
