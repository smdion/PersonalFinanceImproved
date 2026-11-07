/**
 * Smoke test for the House page (v0.10.4 commit 5a): home value, mortgage
 * summary and improvements render, and adding an improvement sends
 * assets.addHomeImprovement.
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
    (await import("@/app/(dashboard)/house/house-content")).HouseContent,
);

describe("House page", () => {
  it("shows the home value, the mortgage summary and improvements", async () => {
    await page.mount();
    expect(screen.getByRole("heading", { name: "House" })).toBeTruthy();
    expect(screen.getByText("$680,000.00")).toBeTruthy();
    expect(screen.getByText("Mortgage Summary")).toBeTruthy();
    expect(screen.getByText("No home improvements recorded.")).toBeTruthy();
  });

  it("adds a home improvement", async () => {
    await page.mount();
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    fireEvent.change(screen.getByPlaceholderText("Description"), {
      target: { value: "New windows" },
    });
    fireEvent.change(screen.getByPlaceholderText("Cost"), {
      target: { value: "12000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mutationCalls("assets.addHomeImprovement")).toEqual([
      { year: 2026, description: "New windows", cost: 12000 },
    ]);
  });
});
