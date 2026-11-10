import "../../helpers/setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as schema from "@/lib/db/schema-sqlite";
import {
  getLatestSnapshot,
  getLatestSnapshotId,
} from "@/server/data/snapshots";
import { createTestDb, type TestDbContext } from "../../helpers/db-harness";

// ---------------------------------------------------------------------------
// getLatestSnapshot (DB-dependent)
// ---------------------------------------------------------------------------

describe("getLatestSnapshot", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createTestDb();
  });

  afterAll(() => ctx.cleanup());

  it("returns null when no snapshots exist", async () => {
    const result = await getLatestSnapshot(ctx.rawDb);
    expect(result).toBeNull();
  });

  it("returns null for non-existent snapshot ID", async () => {
    const result = await getLatestSnapshot(ctx.rawDb, 99999);
    expect(result).toBeNull();
  });

  it("returns snapshot after seeding one", async () => {
    // Seed a snapshot
    ctx.db
      .insert(ctx.schema.portfolioSnapshots)
      .values({
        snapshotDate: "2025-12-31",
      })
      .run();

    const snap = ctx.db.select().from(ctx.schema.portfolioSnapshots).all()[0]!;

    // Seed an account
    ctx.db
      .insert(ctx.schema.portfolioAccounts)
      .values({
        snapshotId: snap.id,
        institution: "Vanguard",
        taxType: "taxFree",
        accountType: "ira",
        amount: "25000",
      })
      .run();

    const result = await getLatestSnapshot(ctx.rawDb);
    expect(result).not.toBeNull();
    expect(result!.snapshot.id).toBe(snap.id);
    expect(result!.accounts).toHaveLength(1);
    expect(result!.accounts[0]!.institution).toBe("Vanguard");
    expect(result!.accounts[0]!.amount).toBe(25000);
    expect(result!.total).toBe(25000);
  });

  it("returns latest snapshot by date when no ID specified", async () => {
    // Seed a newer snapshot
    ctx.db
      .insert(ctx.schema.portfolioSnapshots)
      .values({
        snapshotDate: "2026-03-15",
      })
      .run();

    const result = await getLatestSnapshot(ctx.rawDb);
    expect(result).not.toBeNull();
    expect(result!.snapshot.snapshotDate).toBe("2026-03-15");
  });

  it("returns specific snapshot by ID", async () => {
    const snaps = ctx.db.select().from(ctx.schema.portfolioSnapshots).all();
    const oldest = snaps.find((s) => s.snapshotDate === "2025-12-31")!;

    const result = await getLatestSnapshot(ctx.rawDb, oldest.id);
    expect(result).not.toBeNull();
    expect(result!.snapshot.snapshotDate).toBe("2025-12-31");
  });

  it("computes total from multiple accounts", async () => {
    const snap = ctx.db
      .select()
      .from(ctx.schema.portfolioSnapshots)
      .all()
      .find((s) => s.snapshotDate === "2026-03-15")!;

    ctx.db
      .insert(ctx.schema.portfolioAccounts)
      .values([
        {
          snapshotId: snap.id,
          institution: "Fidelity",
          taxType: "preTax",
          accountType: "401k",
          amount: "50000",
        },
        {
          snapshotId: snap.id,
          institution: "Schwab",
          taxType: "afterTax",
          accountType: "brokerage",
          amount: "30000",
        },
      ])
      .run();

    const result = await getLatestSnapshot(ctx.rawDb, snap.id);
    expect(result!.accounts).toHaveLength(2);
    expect(result!.total).toBe(80000);
  });
});

/**
 * `getLatestSnapshotId` (server/data/snapshots.ts): the one read
 * behind the "latest snapshot only" guards (editing or adding a balance,
 * resyncing to the budget API). Guards the data-write boundary (TESTING
 * keep rule 3): the latest is by snapshot date, not by id, and none is null.
 */
describe("getLatestSnapshotId", () => {
  let ctx: TestDbContext;
  beforeAll(async () => {
    ctx = await createTestDb();
  });
  afterAll(() => ctx.cleanup());

  it("is null with no snapshot, then the latest by date whatever the id order", async () => {
    expect(await getLatestSnapshotId(ctx.rawDb)).toBeNull();
    const snapshot = (snapshotDate: string) =>
      ctx.db
        .insert(schema.portfolioSnapshots)
        .values({ snapshotDate })
        .returning({ id: schema.portfolioSnapshots.id })
        .get().id;
    const later = snapshot("2026-03-31");
    snapshot("2025-12-31");
    expect(await getLatestSnapshotId(ctx.rawDb)).toBe(later);
  });
});
