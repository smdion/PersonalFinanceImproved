/**
 * Smoke test for the Versions page (v0.10.4 commit 5a): the schedule,
 * retention, backup and version list render, and the create dialog sends
 * version.create.
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
  async () => (await import("@/app/(dashboard)/versions/page")).default,
);

describe("Versions page", () => {
  it("shows the schedule, backup and the empty version list", async () => {
    await page.mount();
    expect(screen.getByRole("heading", { name: "Versions" })).toBeTruthy();
    expect(screen.getByText("Auto Schedule")).toBeTruthy();
    expect(screen.getByText("Backup / Restore")).toBeTruthy();
    expect(screen.getByText("No versions yet")).toBeTruthy();
  });

  it("creates a version from the dialog", async () => {
    await page.mount();
    fireEvent.click(screen.getByRole("button", { name: "Create Version" }));
    fireEvent.change(
      screen.getByPlaceholderText("e.g. Before budget restructure"),
      { target: { value: "Before the move" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(mutationCalls("version.create")).toEqual([
      { name: "Before the move", description: undefined },
    ]);
  });
});
