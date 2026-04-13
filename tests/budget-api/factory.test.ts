import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";

// Mock the schema module to avoid SQLite schema require() issue
vi.mock("@/lib/db/schema", () => ({
  appSettings: { key: "key" },
  apiConnections: { service: "service" },
}));

// Mock drizzle-orm eq to return a simple comparator
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col, val) => val),
}));

// Set ENCRYPTION_KEY before importing factory.ts so the v0.5
// readMaybeEncrypted() decryption path can be exercised. Save and
// restore the original so this file doesn't bleed state.
const TEST_ENCRYPTION_KEY = randomBytes(32).toString("base64");
let originalKey: string | undefined;
beforeAll(() => {
  originalKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
});
afterAll(() => {
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalKey;
});

import {
  getActiveBudgetApi,
  getApiConnection,
  getBudgetAPIClient,
  getClientForService,
} from "@/lib/budget-api/factory";
import { encryptJson } from "@/lib/crypto";
import { YnabClient } from "@/lib/budget-api/ynab-client";
import { ActualClient } from "@/lib/budget-api/actual-client";

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

/**
 * getClientForService — exercises the at-rest encryption read path
 * (readMaybeEncrypted) that v0.5 introduced as the C1 security work.
 *
 * The factory accepts both legacy plaintext rows and v5 encrypted
 * envelopes transparently. Both paths must produce a working client
 * instance with the right credentials. A regression here = sync stops
 * working OR plaintext credentials get leaked into client constructors.
 */
describe("getClientForService — readMaybeEncrypted contract", () => {
  it("returns null when no api_connections row exists", async () => {
    const db = createMockDb([[]]);
    expect(await getClientForService(db, "ynab")).toBeNull();
  });

  describe("YNAB", () => {
    it("constructs a YnabClient from a plaintext-legacy config row", async () => {
      // Pre-v0.5 deployments stored config as raw JSON. The factory must
      // still read these — the next saveConnection upgrades them to
      // encrypted-at-rest.
      const plaintextConfig = {
        accessToken: "ynab-test-token",
        budgetId: "budget-uuid-1",
      };
      const db = createMockDb([[{ service: "ynab", config: plaintextConfig }]]);

      const client = await getClientForService(db, "ynab");
      expect(client).toBeInstanceOf(YnabClient);
    });

    it("constructs a YnabClient from a v5 encrypted envelope (decrypts on read)", async () => {
      const plaintextConfig = {
        accessToken: "ynab-encrypted-token",
        budgetId: "budget-uuid-2",
      };
      const envelope = encryptJson(plaintextConfig);
      // Sanity: this is a real envelope, not the plaintext object
      expect(envelope).toHaveProperty("v", 1);
      expect(envelope).toHaveProperty("iv");
      expect(envelope).toHaveProperty("tag");
      expect(envelope).toHaveProperty("ct");
      expect(envelope).not.toHaveProperty("accessToken");

      const db = createMockDb([[{ service: "ynab", config: envelope }]]);

      const client = await getClientForService(db, "ynab");
      expect(client).toBeInstanceOf(YnabClient);
    });

    it("returns null when the YNAB config is missing accessToken", async () => {
      const db = createMockDb([
        [{ service: "ynab", config: { budgetId: "x" } }],
      ]);
      expect(await getClientForService(db, "ynab")).toBeNull();
    });

    it("returns null when the YNAB config is missing budgetId", async () => {
      const db = createMockDb([
        [{ service: "ynab", config: { accessToken: "t" } }],
      ]);
      expect(await getClientForService(db, "ynab")).toBeNull();
    });
  });

  describe("Actual Budget", () => {
    it("constructs an ActualClient from a plaintext-legacy config row", async () => {
      const plaintextConfig = {
        serverUrl: "https://actual.test",
        apiKey: "actual-key",
        budgetSyncId: "sync-id-1",
      };
      const db = createMockDb([
        [{ service: "actual", config: plaintextConfig }],
      ]);

      const client = await getClientForService(db, "actual");
      expect(client).toBeInstanceOf(ActualClient);
    });

    it("constructs an ActualClient from a v5 encrypted envelope", async () => {
      const plaintextConfig = {
        serverUrl: "https://actual.test",
        apiKey: "encrypted-actual-key",
        budgetSyncId: "sync-id-2",
      };
      const envelope = encryptJson(plaintextConfig);
      // Sanity: not plaintext
      expect(envelope).not.toHaveProperty("apiKey");

      const db = createMockDb([[{ service: "actual", config: envelope }]]);

      const client = await getClientForService(db, "actual");
      expect(client).toBeInstanceOf(ActualClient);
    });

    it("returns null when serverUrl is missing", async () => {
      const db = createMockDb([
        [{ service: "actual", config: { apiKey: "k", budgetSyncId: "s" } }],
      ]);
      expect(await getClientForService(db, "actual")).toBeNull();
    });

    it("returns null when apiKey is missing", async () => {
      const db = createMockDb([
        [
          {
            service: "actual",
            config: { serverUrl: "https://x", budgetSyncId: "s" },
          },
        ],
      ]);
      expect(await getClientForService(db, "actual")).toBeNull();
    });

    it("returns null when budgetSyncId is missing", async () => {
      const db = createMockDb([
        [
          {
            service: "actual",
            config: { serverUrl: "https://x", apiKey: "k" },
          },
        ],
      ]);
      expect(await getClientForService(db, "actual")).toBeNull();
    });
  });
});

/**
 * getBudgetAPIClient — the high-level entry point used by router code.
 * Reads active_budget_api first, then delegates to getClientForService.
 * Two queries fire in sequence so the mock needs to return values in
 * the right order.
 */
describe("getBudgetAPIClient", () => {
  it("returns null when no API is active ('none')", async () => {
    // First query: active_budget_api lookup → empty (defaults to 'none')
    // Second query: never fires
    const db = createMockDb([[]]);
    expect(await getBudgetAPIClient(db)).toBeNull();
  });

  it("returns a YnabClient when active = 'ynab' and a valid connection exists", async () => {
    const db = createMockDb([
      [{ value: "ynab" }], // active_budget_api lookup
      [
        {
          service: "ynab",
          config: { accessToken: "tok", budgetId: "buid" },
        },
      ], // api_connections lookup
    ]);
    const client = await getBudgetAPIClient(db);
    expect(client).toBeInstanceOf(YnabClient);
  });

  it("returns null when active = 'ynab' but the connection row is missing", async () => {
    const db = createMockDb([
      [{ value: "ynab" }], // active is set
      [], // but no api_connections row
    ]);
    expect(await getBudgetAPIClient(db)).toBeNull();
  });

  it("returns an ActualClient when active = 'actual' with valid encrypted credentials", async () => {
    const envelope = encryptJson({
      serverUrl: "https://actual.test",
      apiKey: "k",
      budgetSyncId: "s",
    });
    const db = createMockDb([
      [{ value: "actual" }],
      [{ service: "actual", config: envelope }],
    ]);
    const client = await getBudgetAPIClient(db);
    expect(client).toBeInstanceOf(ActualClient);
  });
});
