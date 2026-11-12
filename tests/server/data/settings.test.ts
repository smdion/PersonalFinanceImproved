import "../../helpers/setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { mergeSettingAtomically, upsertSetting } from "@/server/data/settings";
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

describe("mergeSettingAtomically (SQLite)", () => {
  let ctx: TestDbContext;
  const read = async (key: string) =>
    (
      await ctx.rawDb
        .select()
        .from(ctx.appSchema.appSettings)
        .where(eq(ctx.appSchema.appSettings.key, key))
    ).map((r) => r.value);

  beforeAll(async () => {
    ctx = await createTestDb();
  });
  afterAll(() => ctx.cleanup());

  it("a merge inside a yielding transaction and one outside it both finish", async () => {
    const inside = ctx.rawDb.transaction(async (tx) => {
      await new Promise((r) => setTimeout(r, 10));
      await mergeSettingAtomically(tx as never, "test_merge_inside", () => ({
        a: 1,
      }));
    });
    await new Promise((r) => setTimeout(r, 1));
    const outside = mergeSettingAtomically(
      ctx.rawDb,
      "test_merge_outside",
      () => ({ b: 2 }),
    );
    const hung = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("hung")), 2000),
    );
    await Promise.race([Promise.all([inside, outside]), hung]);
    expect(await read("test_merge_inside")).toEqual([{ a: 1 }]);
    expect(await read("test_merge_outside")).toEqual([{ b: 2 }]);
  });

  it("concurrent merges of one map both stick", async () => {
    await Promise.all(
      ["x", "y"].map((part) =>
        mergeSettingAtomically(ctx.rawDb, "test_merge_map", (stored) => ({
          ...(stored as Record<string, number> | null),
          [part]: 1,
        })),
      ),
    );
    expect(await read("test_merge_map")).toEqual([{ x: 1, y: 1 }]);
  });
});
