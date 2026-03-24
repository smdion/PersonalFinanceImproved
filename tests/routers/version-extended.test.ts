/* eslint-disable no-restricted-syntax -- as unknown as casts required for Drizzle ORM test type coercion */
/**
 * Version router extended integration tests.
 *
 * Tests list, getById, delete, retention settings, schedule settings,
 * upgrade banner procedures, getPreview, and seeded-data scenarios.
 * Note: create/restore/resetAllData use db.transaction() or db.execute()
 * which are not compatible with better-sqlite3 in tests.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller, seedAppSetting, viewerSession } from "./setup";
import * as sqliteSchema from "@/lib/db/schema-sqlite";

/**
 * Seed a state_versions row directly (not via version-logic which uses transactions).
 */
function seedStateVersion(
  db: Awaited<ReturnType<typeof createTestCaller>>["db"],
  overrides: Partial<typeof sqliteSchema.stateVersions.$inferInsert> = {},
): number {
  const result = db
    .insert(sqliteSchema.stateVersions)
    .values({
      name: "Test Version",
      versionType: "manual",
      schemaVersion: "0001",
      tableCount: 2,
      totalRows: 100,
      createdBy: "test",
      ...overrides,
    })
    .returning({ id: sqliteSchema.stateVersions.id })
    .get();
  return result.id;
}

/**
 * Seed a state_version_tables row.
 */
function seedStateVersionTable(
  db: Awaited<ReturnType<typeof createTestCaller>>["db"],
  versionId: number,
  tableName: string,
  data: unknown[],
) {
  db.insert(sqliteSchema.stateVersionTables)
    .values({
      versionId,
      tableName,
      rowCount: data.length,
      data,
    })
    .run();
}

describe("version router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  // ── LIST ──

  describe("list", () => {
    it("returns empty array when no versions exist", async () => {
      const result = await caller.version.list();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  // ── GET BY ID ──

  describe("getById", () => {
    it("returns null for non-existent version", async () => {
      const result = await caller.version.getById({ id: 99999 });
      expect(result).toBeNull();
    });
  });

  // ── DELETE ──

  describe("delete", () => {
    it("succeeds silently for non-existent version", async () => {
      const result = await caller.version.delete({ id: 99999 });
      expect(result).toEqual({ ok: true });
    });
  });

  // ── RETENTION SETTINGS ──

  describe("retention settings", () => {
    it("returns default retention count", async () => {
      const result = await caller.version.getRetention();
      expect(result).toEqual({ retentionCount: 30 });
    });

    it("updates retention count", async () => {
      const result = await caller.version.setRetention({ count: 10 });
      expect(result).toEqual({ ok: true, retentionCount: 10 });
    });

    it("returns updated retention count", async () => {
      const result = await caller.version.getRetention();
      expect(result).toEqual({ retentionCount: 10 });
    });

    it("validates min retention count", async () => {
      await expect(caller.version.setRetention({ count: 0 })).rejects.toThrow();
    });

    it("validates max retention count", async () => {
      await expect(
        caller.version.setRetention({ count: 999 }),
      ).rejects.toThrow();
    });
  });

  // ── SCHEDULE SETTINGS ──

  describe("schedule settings", () => {
    it("returns default schedule", async () => {
      const result = await caller.version.getSchedule();
      expect(result.schedule).toBe("daily");
      expect(result.cronExpression).toBe("0 2 * * *");
    });

    it("updates schedule to weekly", async () => {
      const result = await caller.version.setSchedule({ schedule: "weekly" });
      expect(result).toEqual({ ok: true, schedule: "weekly" });
    });

    it("returns updated schedule", async () => {
      const result = await caller.version.getSchedule();
      expect(result.schedule).toBe("weekly");
    });

    it("updates schedule with custom cron", async () => {
      const result = await caller.version.setSchedule({
        schedule: "custom",
        cronExpression: "0 3 * * 1",
      });
      expect(result).toEqual({ ok: true, schedule: "custom" });
    });

    it("returns custom cron expression", async () => {
      const result = await caller.version.getSchedule();
      expect(result.schedule).toBe("custom");
      expect(result.cronExpression).toBe("0 3 * * 1");
    });

    it("updates to off", async () => {
      const result = await caller.version.setSchedule({ schedule: "off" });
      expect(result).toEqual({ ok: true, schedule: "off" });
    });
  });

  // ── UPGRADE BANNER ──

  describe("upgrade banner", () => {
    it("returns null when no banner exists", async () => {
      const result = await caller.version.getUpgradeBanner();
      expect(result).toBeNull();
    });

    it("dismissUpgradeBanner succeeds even when no banner exists", async () => {
      const result = await caller.version.dismissUpgradeBanner();
      expect(result).toEqual({ ok: true });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEEDED DATA TESTS (separate DB to avoid cross-contamination)
// ─────────────────────────────────────────────────────────────────────────────

describe("version router — seeded data", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;
  let versionId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    // Seed a version with table data
    versionId = seedStateVersion(db, {
      name: "Seeded Version",
      description: "A test version with table data",
      versionType: "manual",
      schemaVersion: "0002",
      tableCount: 2,
      totalRows: 5,
      sizeEstimateBytes: 1024,
      createdBy: "test-harness",
    });
    seedStateVersionTable(db, versionId, "people", [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
    seedStateVersionTable(db, versionId, "jobs", [
      { id: 1, employer: "Acme", salary: 100000 },
      { id: 2, employer: "BigCo", salary: 150000 },
      { id: 3, employer: "StartUp", salary: 80000 },
    ]);
  });

  afterAll(() => cleanup());

  describe("list", () => {
    it("returns seeded versions", async () => {
      const result = await caller.version.list();
      expect(result.length).toBeGreaterThanOrEqual(1);
      const found = result.find((v: { id: number }) => v.id === versionId);
      expect(found).toBeDefined();
      expect(found!.name).toBe("Seeded Version");
      expect(found!.description).toBe("A test version with table data");
      expect(found!.versionType).toBe("manual");
      expect(found!.tableCount).toBe(2);
      expect(found!.totalRows).toBe(5);
      expect(found!.sizeEstimateBytes).toBe(1024);
    });

    it("list returns metadata only — no data field", async () => {
      const result = await caller.version.list();
      const found = result.find((v: { id: number }) => v.id === versionId);
      expect(found).toBeDefined();
      // list should NOT include the full JSONB data
      expect((found as Record<string, unknown>).data).toBeUndefined();
    });
  });

  describe("getById", () => {
    it("returns full version with table info", async () => {
      const result = await caller.version.getById({ id: versionId });
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Seeded Version");
      expect(result!.schemaVersion).toBe("0002");
      expect(result!.createdBy).toBe("test-harness");
      expect(result!.tables).toBeDefined();
      expect(result!.tables).toHaveLength(2);
    });

    it("tables have tableName and rowCount", async () => {
      const result = await caller.version.getById({ id: versionId });
      const peopleTbl = result!.tables.find(
        (t: { tableName: string }) => t.tableName === "people",
      );
      expect(peopleTbl).toBeDefined();
      expect(peopleTbl!.rowCount).toBe(2);

      const jobsTbl = result!.tables.find(
        (t: { tableName: string }) => t.tableName === "jobs",
      );
      expect(jobsTbl).toBeDefined();
      expect(jobsTbl!.rowCount).toBe(3);
    });
  });

  describe("getPreview", () => {
    it("returns rows for an existing table", async () => {
      const result = await caller.version.getPreview({
        versionId,
        tableName: "people",
      });
      expect(result.rowCount).toBe(2);
      expect(result.rows).toHaveLength(2);
      expect((result.rows[0] as Record<string, unknown>).name).toBe("Alice");
    });

    it("returns rows for jobs table", async () => {
      const result = await caller.version.getPreview({
        versionId,
        tableName: "jobs",
      });
      expect(result.rowCount).toBe(3);
      expect(result.rows).toHaveLength(3);
    });

    it("returns empty for non-existent table", async () => {
      const result = await caller.version.getPreview({
        versionId,
        tableName: "nonexistent_table",
      });
      expect(result).toEqual({ rows: [], rowCount: 0 });
    });

    it("returns empty for non-existent version", async () => {
      const result = await caller.version.getPreview({
        versionId: 99999,
        tableName: "people",
      });
      expect(result).toEqual({ rows: [], rowCount: 0 });
    });

    it("limits preview to 50 rows", async () => {
      // Seed a version with > 50 rows
      const bigVersionId = seedStateVersion(db, {
        name: "Big Version",
        tableCount: 1,
        totalRows: 100,
      });
      const manyRows = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `Person ${i + 1}`,
      }));
      seedStateVersionTable(db, bigVersionId, "big_table", manyRows);

      const result = await caller.version.getPreview({
        versionId: bigVersionId,
        tableName: "big_table",
      });
      expect(result.rowCount).toBe(100);
      expect(result.rows).toHaveLength(50);
    });
  });

  describe("delete with seeded data", () => {
    it("deletes a version and its table data via cascade", async () => {
      const delId = seedStateVersion(db, { name: "ToDelete" });
      seedStateVersionTable(db, delId, "t1", [{ a: 1 }]);

      const result = await caller.version.delete({ id: delId });
      expect(result).toEqual({ ok: true });

      const check = await caller.version.getById({ id: delId });
      expect(check).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UPGRADE BANNER — with data
// ─────────────────────────────────────────────────────────────────────────────

describe("version router — upgrade banner with data", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("returns banner data when pre_upgrade_backup setting exists", async () => {
    // Insert directly to store an object (not a string) since column is mode: "json"
    db.insert(sqliteSchema.appSettings)
      .values({
        key: "pre_upgrade_backup",
        value: {
          path: "/backups/pre-upgrade-2025.db",
          createdAt: "2025-06-01T10:00:00Z",
        } as unknown as string,
      })
      .run();

    const result = await caller.version.getUpgradeBanner();
    expect(result).not.toBeNull();
    expect(result!.backupPath).toBe("/backups/pre-upgrade-2025.db");
    expect(result!.createdAt).toBe("2025-06-01T10:00:00Z");
  });

  it("dismiss removes the banner", async () => {
    await caller.version.dismissUpgradeBanner();

    const result = await caller.version.getUpgradeBanner();
    expect(result).toBeNull();
  });

  it("returns null for malformed banner data (missing path)", async () => {
    const ctx2 = await createTestCaller();
    try {
      ctx2.db
        .insert(sqliteSchema.appSettings)
        .values({
          key: "pre_upgrade_backup",
          value: { createdAt: "2025-06-01" } as unknown as string,
        })
        .run();
      const result = await ctx2.caller.version.getUpgradeBanner();
      expect(result).toBeNull();
    } finally {
      ctx2.cleanup();
    }
  });

  it("returns null for malformed banner data (not an object)", async () => {
    const ctx2 = await createTestCaller();
    try {
      seedAppSetting(ctx2.db, "pre_upgrade_backup", "just a string");
      const result = await ctx2.caller.version.getUpgradeBanner();
      expect(result).toBeNull();
    } finally {
      ctx2.cleanup();
    }
  });

  it("returns null when banner setting has numeric value", async () => {
    const ctx2 = await createTestCaller();
    try {
      ctx2.db
        .insert(sqliteSchema.appSettings)
        .values({
          key: "pre_upgrade_backup",
          value: 42 as unknown as string,
        })
        .run();
      const result = await ctx2.caller.version.getUpgradeBanner();
      expect(result).toBeNull();
    } finally {
      ctx2.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RETENTION — cleanup of auto versions
// ─────────────────────────────────────────────────────────────────────────────

describe("version router — retention cleanup", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("setRetention trims excess auto versions", async () => {
    // Seed 5 auto versions
    for (let i = 0; i < 5; i++) {
      seedStateVersion(db, {
        name: `Auto ${i}`,
        versionType: "auto",
      });
    }
    // Also seed a manual version (should not be deleted)
    seedStateVersion(db, {
      name: "Manual Keep",
      versionType: "manual",
    });

    // Set retention to 2 — should delete 3 oldest auto versions
    const result = await caller.version.setRetention({ count: 2 });
    expect(result).toEqual({ ok: true, retentionCount: 2 });

    // Check that only 2 auto versions remain
    const versions = await caller.version.list();
    const autoVersions = versions.filter(
      (v: { versionType: string }) => v.versionType === "auto",
    );
    expect(autoVersions).toHaveLength(2);

    // Manual version should still exist
    const manualVersions = versions.filter(
      (v: { versionType: string }) => v.versionType === "manual",
    );
    expect(manualVersions.length).toBeGreaterThanOrEqual(1);
    expect(
      manualVersions.find((v: { name: string }) => v.name === "Manual Keep"),
    ).toBeDefined();
  });

  it("getRetention returns a number from the stored setting", async () => {
    const result = await caller.version.getRetention();
    expect(result.retentionCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULE — additional edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("version router — schedule edge cases", () => {
  it("setSchedule to monthly without cron keeps existing cron", async () => {
    const ctx = await createTestCaller();
    try {
      const result = await ctx.caller.version.setSchedule({
        schedule: "monthly",
      });
      expect(result).toEqual({ ok: true, schedule: "monthly" });

      const sched = await ctx.caller.version.getSchedule();
      expect(sched.schedule).toBe("monthly");
      // Default cron is returned when no custom cron was set
      expect(sched.cronExpression).toBe("0 2 * * *");
    } finally {
      ctx.cleanup();
    }
  });

  it("rejects invalid schedule enum", async () => {
    const ctx = await createTestCaller();
    try {
      await expect(
        (ctx.caller.version.setSchedule as (...args: unknown[]) => unknown)({
          schedule: "invalid_value",
        }),
      ).rejects.toThrow();
    } finally {
      ctx.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTH — version procedures require right session
// ─────────────────────────────────────────────────────────────────────────────

describe("version router — auth", () => {
  it("viewer can read list", async () => {
    const ctx = await createTestCaller(viewerSession);
    try {
      const result = await ctx.caller.version.list();
      expect(Array.isArray(result)).toBe(true);
    } finally {
      ctx.cleanup();
    }
  });

  it("viewer can read getById", async () => {
    const ctx = await createTestCaller(viewerSession);
    try {
      const result = await ctx.caller.version.getById({ id: 1 });
      expect(result).toBeNull();
    } finally {
      ctx.cleanup();
    }
  });

  it("viewer can read getRetention", async () => {
    const ctx = await createTestCaller(viewerSession);
    try {
      const result = await ctx.caller.version.getRetention();
      expect(result.retentionCount).toBe(30);
    } finally {
      ctx.cleanup();
    }
  });

  it("viewer can read getSchedule", async () => {
    const ctx = await createTestCaller(viewerSession);
    try {
      const result = await ctx.caller.version.getSchedule();
      expect(result.schedule).toBe("daily");
    } finally {
      ctx.cleanup();
    }
  });

  it("viewer can read getUpgradeBanner", async () => {
    const ctx = await createTestCaller(viewerSession);
    try {
      const result = await ctx.caller.version.getUpgradeBanner();
      expect(result).toBeNull();
    } finally {
      ctx.cleanup();
    }
  });

  it("viewer can read getPreview", async () => {
    const ctx = await createTestCaller(viewerSession);
    try {
      const result = await ctx.caller.version.getPreview({
        versionId: 1,
        tableName: "anything",
      });
      expect(result).toEqual({ rows: [], rowCount: 0 });
    } finally {
      ctx.cleanup();
    }
  });
});
