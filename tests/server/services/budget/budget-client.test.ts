import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "@/lib/db";

const m = vi.hoisted(() => ({
  active: "none" as string,
  client: null as object | null,
  profile: undefined as object | undefined,
}));

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: async () => m.active,
  getClientForService: async () => m.client,
}));
vi.mock("@/server/data/budget-profiles", () => ({
  resolveTargetBudgetProfile: async () => m.profile,
}));
vi.mock("@/server/data/budget-profile-lock", () => ({
  lockedTargetBudgetProfile: async () => m.profile,
}));

import {
  requireActiveBudgetApi,
  requireBudgetClient,
  requireBudgetProfile,
} from "@/server/services/budget/budget-client";

const db = {} as Db;

beforeEach(() => {
  m.active = "none";
  m.client = null;
  m.profile = undefined;
});

describe("requireActiveBudgetApi", () => {
  it("refuses when no budget API is active", async () => {
    await expect(requireActiveBudgetApi(db)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "No budget API active",
    });
  });

  it("returns the active service", async () => {
    m.active = "ynab";
    expect(await requireActiveBudgetApi(db)).toBe("ynab");
  });
});

describe("requireBudgetClient", () => {
  it("refuses when no budget API is active", async () => {
    m.client = {};
    await expect(requireBudgetClient(db)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "No budget API active",
    });
  });

  it("refuses a missing client with the default or the caller's message", async () => {
    m.active = "actual";
    await expect(requireBudgetClient(db)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Budget API client not available",
    });
    await expect(
      requireBudgetClient(db, "No budget API active"),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "No budget API active",
    });
  });

  it("returns the service and its client", async () => {
    const client = { name: "c" };
    m.active = "actual";
    m.client = client;
    expect(await requireBudgetClient(db)).toEqual({
      service: "actual",
      client,
    });
  });
});

describe("requireBudgetProfile", () => {
  it("refuses when there is no target profile", async () => {
    await expect(requireBudgetProfile(db, 3)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "No active profile",
    });
  });

  it("returns the target profile", async () => {
    m.profile = { id: 3 };
    expect(await requireBudgetProfile(db, 3)).toEqual({ id: 3 });
  });
});
