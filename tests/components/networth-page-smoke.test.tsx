/**
 * Smoke test for the Net worth (Trends) page (v0.10.4 commit 5a): net
 * worth, its location and composition render, and editing cash sends
 * settings.appSettings.upsert.
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
  async () => (await import("@/app/(dashboard)/networth/page")).default,
);

describe("Net worth page", () => {
  it("shows net worth, its location and composition", async () => {
    await page.mount();
    expect(screen.getByRole("heading", { name: "Trends" })).toBeTruthy();
    expect(screen.getAllByText("$881,028.48").length).toBeGreaterThan(0);
    expect(screen.getByText("Net Worth Composition")).toBeTruthy();
    expect(screen.getByText("Financial Independence")).toBeTruthy();
  });

  it("saves an edited cash balance", async () => {
    await page.mount();
    const cash = screen
      .getAllByTitle("Click to edit")
      .find((el) => el.textContent?.includes("$40,000.00"))!;
    fireEvent.click(cash);
    const input = screen.getByDisplayValue("40000");
    fireEvent.change(input, { target: { value: "45000" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mutationCalls("settings.appSettings.upsert")).toEqual([
      { key: "current_cash", value: 45000 },
    ]);
  });
});
