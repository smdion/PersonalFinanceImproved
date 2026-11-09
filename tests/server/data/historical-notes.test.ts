/**
 * `upsertHistoricalNote` (server/data/historical-notes.ts): the one write
 * behind both note procedures (assets.upsertNote, historical.upsertNote).
 * Guards the data-write boundary (TESTING keep rule 3): a note is saved per
 * (year, field), a second save replaces it, and a blank note deletes it.
 */
import "../../helpers/setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as schema from "@/lib/db/schema-sqlite";
import { upsertHistoricalNote } from "@/server/data/historical-notes";
import { createTestDb, type TestDbContext } from "../../helpers/db-harness";

describe("upsertHistoricalNote", () => {
  let ctx: TestDbContext;
  const notes = () =>
    ctx.db
      .select({
        year: schema.historicalNotes.year,
        field: schema.historicalNotes.field,
        note: schema.historicalNotes.note,
      })
      .from(schema.historicalNotes)
      .all();

  beforeAll(async () => {
    ctx = await createTestDb();
  });
  afterAll(() => ctx.cleanup());

  it("saves, replaces and, when blank, deletes the note on one year's field", async () => {
    await upsertHistoricalNote(ctx.rawDb, {
      year: 2024,
      field: "salary",
      note: "Raise",
    });
    await upsertHistoricalNote(ctx.rawDb, {
      year: 2025,
      field: "salary",
      note: "Kept",
    });
    await upsertHistoricalNote(ctx.rawDb, {
      year: 2024,
      field: "salary",
      note: "Promotion",
    });
    expect(notes()).toEqual([
      { year: 2024, field: "salary", note: "Promotion" },
      { year: 2025, field: "salary", note: "Kept" },
    ]);
    await upsertHistoricalNote(ctx.rawDb, {
      year: 2024,
      field: "salary",
      note: "  ",
    });
    expect(notes()).toEqual([{ year: 2025, field: "salary", note: "Kept" }]);
  });
});
