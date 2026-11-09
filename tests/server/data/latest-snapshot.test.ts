/**
 * `getLatestSnapshotId` (server/data/latest-snapshot.ts): the one read
 * behind the "latest snapshot only" guards (editing or adding a balance,
 * resyncing to the budget API). Guards the data-write boundary (TESTING
 * keep rule 3): the latest is by snapshot date, not by id, and none is null.
 */
import "../../helpers/setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as schema from "@/lib/db/schema-sqlite";
import { getLatestSnapshotId } from "@/server/data/latest-snapshot";
import { createTestDb, type TestDbContext } from "../../helpers/db-harness";

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
