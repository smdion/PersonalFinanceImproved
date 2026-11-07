/**
 * Smoke test for the Savings page (v0.10.4 commit 5a): the summary and the
 * household's funds render, and the Manage tab's new-fund form sends
 * savings.savingsGoals.create.
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
  async () => (await import("@/app/(dashboard)/savings/page")).default,
);

describe("Savings page", () => {
  it("shows the summary and the household's funds", async () => {
    await page.mount();
    expect(screen.getByRole("heading", { name: "Savings" })).toBeTruthy();
    expect(screen.getAllByText("Emergency fund").length).toBeGreaterThan(0);
    expect(screen.getAllByText("New roof").length).toBeGreaterThan(0);
  });

  it("creates a fund from the form", async () => {
    await page.mount();
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    fireEvent.click(screen.getByRole("button", { name: "+ New Fund" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. Vacation, New Car"), {
      target: { value: "Vacation" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(mutationCalls("savings.savingsGoals.create")).toEqual([
      expect.objectContaining({
        name: "Vacation",
        parentGoalId: null,
        targetMode: "fixed",
        isActive: true,
        isEmergencyFund: false,
      }),
    ]);
  });
});
