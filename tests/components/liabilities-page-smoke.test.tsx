/**
 * Smoke test for the Liabilities page (v0.10.4 commit 5a): the totals, the
 * active loan and other debts render, and a what-if scenario sends
 * mortgage.mortgageWhatIfScenarios.create.
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
    (await import("@/app/(dashboard)/liabilities/liabilities-content"))
      .LiabilitiesContent,
);

describe("Liabilities page", () => {
  it("shows the totals, the active loan and other debts", async () => {
    await page.mount();
    expect(screen.getByRole("heading", { name: "Liabilities" })).toBeTruthy();
    expect(screen.getByText("Total Liabilities")).toBeTruthy();
    expect(screen.getAllByText("$456,971.52").length).toBeGreaterThan(0);
    expect(screen.getByText("Other debts")).toBeTruthy();
  });

  it("adds a what-if scenario", async () => {
    await page.mount();
    fireEvent.click(screen.getByRole("button", { name: "+ Add scenario" }));
    fireEvent.change(screen.getByPlaceholderText("Label (e.g. +$200/mo)"), {
      target: { value: "+$300/mo" },
    });
    fireEvent.change(screen.getByPlaceholderText("Extra $/mo"), {
      target: { value: "300" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(mutationCalls("mortgage.mortgageWhatIfScenarios.create")).toEqual([
      {
        label: "+$300/mo",
        extraMonthlyPrincipal: "300",
        extraOneTimePayment: "0",
        sortOrder: 1,
      },
    ]);
  });
});
