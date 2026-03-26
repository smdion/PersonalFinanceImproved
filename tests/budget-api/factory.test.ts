import { describe, it, expect, vi } from "vitest";

// Mock the schema module to avoid SQLite schema require() issue
vi.mock("@/lib/db/schema", () => ({
  appSettings: { key: "key" },
  apiConnections: { service: "service" },
}));

// Mock drizzle-orm eq to return a simple comparator
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col, val) => val),
}));

import { getActiveBudgetApi, getApiConnection } from "@/lib/budget-api/factory";

// Create mock DB that simulates Drizzle query builder chain
function createMockDb(selectResults: unknown[][] = [[]]) {
  let callIndex = 0;
  const mockLimit = vi.fn().mockImplementation(() => {
    const result = selectResults[callIndex] ?? [];
    callIndex++;
    return Promise.resolve(result);
  });
  const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
  // eslint-disable-next-line no-restricted-syntax -- mock DB object for testing factory logic without real Drizzle
  return { select: mockSelect } as unknown as Parameters<
    typeof getActiveBudgetApi
  >[0];
}

describe("getActiveBudgetApi", () => {
  it("returns 'none' when no setting exists", async () => {
    const db = createMockDb([[]]);
    expect(await getActiveBudgetApi(db)).toBe("none");
  });

  it("returns 'ynab' when setting is ynab", async () => {
    const db = createMockDb([[{ value: "ynab" }]]);
    expect(await getActiveBudgetApi(db)).toBe("ynab");
  });

  it("returns 'actual' when setting is actual", async () => {
    const db = createMockDb([[{ value: "actual" }]]);
    expect(await getActiveBudgetApi(db)).toBe("actual");
  });

  it("returns 'none' for invalid values", async () => {
    const db = createMockDb([[{ value: "invalid" }]]);
    expect(await getActiveBudgetApi(db)).toBe("none");
  });
});

describe("getApiConnection", () => {
  it("returns null when no connection exists", async () => {
    const db = createMockDb([[]]);
    expect(await getApiConnection(db, "ynab")).toBeNull();
  });

  it("returns connection row when it exists", async () => {
    const conn = { service: "ynab", config: { accessToken: "tok" } };
    const db = createMockDb([[conn]]);
    expect(await getApiConnection(db, "ynab")).toEqual(conn);
  });
});
