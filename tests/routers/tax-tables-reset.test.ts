/**
 * Reset to shipped, for the four bracket tables (the contribution limits'
 * own case is in tax-limits.test.ts): a shipped 2026 row the household
 * changed becomes the household's; Reset to shipped hands it back to the
 * tax-data file, which puts the shipped figures back. On SQLite, like every
 * mutation (mutations-on-sqlite.test.ts).
 */
import "./setup-mocks";
import { describe, expect, it, vi } from "vitest";
import { adminSession, createTestCaller } from "./setup";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

type Caller = Awaited<ReturnType<typeof createTestCaller>>["caller"];
type FplAmounts = Parameters<
  Caller["settings"]["fplByHousehold"]["update"]
>[0]["amounts"];

async function withCaller(run: (caller: Caller) => Promise<void>) {
  const { caller, cleanup } = await createTestCaller(adminSession);
  try {
    await run(caller);
  } finally {
    cleanup();
  }
}

describe("Reset to shipped puts each table's shipped figures back", () => {
  it("settings.taxBrackets", () =>
    withCaller(async (caller) => {
      const find = async () =>
        (await caller.settings.taxBrackets.list()).find(
          (r) =>
            r.taxYear === 2026 && r.filingStatus === "Single" && !r.w4Checkbox,
        )!;
      const row = await find();
      const shipped = row.brackets;
      await caller.settings.taxBrackets.update({
        id: row.id,
        taxYear: 2026,
        filingStatus: "Single",
        w4Checkbox: false,
        brackets: [{ threshold: 0, baseWithholding: 0, rate: 0.5 }],
      });
      expect(await find()).toMatchObject({ origin: "user" });
      await caller.settings.taxBrackets.resetToShipped({ id: row.id });
      expect(await find()).toMatchObject({
        origin: "seed",
        brackets: shipped,
      });
    }));

  it("settings.ltcgBrackets", () =>
    withCaller(async (caller) => {
      const find = async () =>
        (await caller.settings.ltcgBrackets.list()).find(
          (r) => r.taxYear === 2026 && r.filingStatus === "Single",
        )!;
      const row = await find();
      const shipped = row.brackets;
      await caller.settings.ltcgBrackets.update({
        id: row.id,
        taxYear: 2026,
        filingStatus: "Single",
        brackets: [{ threshold: null, rate: 0.5 }],
      });
      expect(await find()).toMatchObject({ origin: "user" });
      await caller.settings.ltcgBrackets.resetToShipped({ id: row.id });
      expect(await find()).toMatchObject({
        origin: "seed",
        brackets: shipped,
      });
    }));

  it("settings.irmaaBrackets", () =>
    withCaller(async (caller) => {
      const find = async () =>
        (await caller.settings.irmaaBrackets.list()).find(
          (r) => r.taxYear === 2026 && r.filingStatus === "Single",
        )!;
      const row = await find();
      const shipped = row.brackets;
      await caller.settings.irmaaBrackets.update({
        id: row.id,
        taxYear: 2026,
        filingStatus: "Single",
        brackets: [{ magiThreshold: 0, annualSurcharge: 1 }],
      });
      expect(await find()).toMatchObject({ origin: "user" });
      await caller.settings.irmaaBrackets.resetToShipped({ id: row.id });
      expect(await find()).toMatchObject({
        origin: "seed",
        brackets: shipped,
      });
    }));

  it("settings.fplByHousehold", () =>
    withCaller(async (caller) => {
      const find = async () =>
        (await caller.settings.fplByHousehold.list()).find(
          (r) => r.taxYear === 2026,
        )!;
      const row = await find();
      const shipped = row.amounts;
      await caller.settings.fplByHousehold.update({
        id: row.id,
        taxYear: 2026,
        amounts: {
          ...(shipped as FplAmounts),
          "1": (shipped as FplAmounts)["1"] + 1,
        },
      });
      expect(await find()).toMatchObject({ origin: "user" });
      await caller.settings.fplByHousehold.resetToShipped({ id: row.id });
      expect(await find()).toMatchObject({ origin: "seed", amounts: shipped });
    }));
});
