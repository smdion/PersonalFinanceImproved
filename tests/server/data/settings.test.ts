import "../../helpers/setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { upsertSetting } from "@/server/data/settings";
import { createTestDb, type TestDbContext } from "../../helpers/db-harness";

describe("upsertSetting (SQLite)", () => {
  let ctx: TestDbContext;
  const read = (key: string) =>
    ctx.rawDb
      .select()
      .from(ctx.appSchema.appSettings)
      .where(eq(ctx.appSchema.appSettings.key, key));

  beforeAll(async () => {
    ctx = await createTestDb();
  });
  afterAll(() => ctx.cleanup());

  it("inserts a key that isn't stored", async () => {
    await upsertSetting(ctx.rawDb, "test_upsert_new", { a: 1 });
    expect((await read("test_upsert_new")).map((r) => r.value)).toEqual([
      { a: 1 },
    ]);
  });

  it("replaces the whole stored value, keeping one row", async () => {
    await upsertSetting(ctx.rawDb, "test_upsert_map", { a: 1, b: 2 });
    await upsertSetting(ctx.rawDb, "test_upsert_map", { c: 3 });
    expect((await read("test_upsert_map")).map((r) => r.value)).toEqual([
      { c: 3 },
    ]);
  });
});
