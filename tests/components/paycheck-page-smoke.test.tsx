/**
 * Smoke test for the Paycheck page (v0.10.4 commit 5a): each earner's pay
 * stub renders, and changing a W-4 filing status after unlocking sends
 * salaryProfile.patchEntry.
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
    (await import("@/app/(dashboard)/paycheck/paycheck-content"))
      .PaycheckContent,
);

describe("Paycheck page", () => {
  it("shows each earner's pay stub", async () => {
    await page.mount();
    expect(screen.getByRole("heading", { name: "Paycheck" })).toBeTruthy();
    expect(screen.getAllByText("Jordan").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Riley").length).toBeGreaterThan(0);
    expect(screen.getByText("$5,226.71")).toBeTruthy();
  });

  it("saves a W-4 filing status once unlocked", async () => {
    await page.mount();
    fireEvent.click(screen.getByRole("button", { name: "Unlock to edit" }));
    const [status] = screen.getAllByRole("combobox", {
      name: "W-4 filing status",
    });
    fireEvent.change(status!, { target: { value: "Single" } });
    const { ids } = page.household();
    expect(mutationCalls("salaryProfile.patchEntry")).toEqual([
      {
        id: ids.salaryProfile,
        jobId: ids.jobs.JA,
        fields: expect.objectContaining({ w4FilingStatus: "Single" }),
      },
    ]);
  });
});
