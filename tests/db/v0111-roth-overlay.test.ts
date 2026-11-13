/**
 * The Roth-overlay tag (v0111-roth-overlay.ts) as the restore step runs it:
 * a row saved before the switch existed gets the overlay on, an empty target
 * the 12% it always read, a row with a switch stays as stored, and a replay
 * writes nothing.
 */
import { describe, it, expect } from "vitest";
import {
  ROTH_OVERLAY_CONVERTER,
  ROTH_OVERLAY_TAG,
} from "@/lib/db/migrate/v0111-roth-overlay";
import { tagConverters } from "@/lib/db/migrate/migration-converters";
import { transformBackupToCurrentSchema } from "@/lib/db/backup/backup-transforms";
import pgJournal from "../../drizzle/meta/_journal.json";
import sqliteJournal from "../../drizzle-sqlite/meta/_journal.json";
import { expectRestoreReplaySafe } from "./converter-replay";
import { ROWS, WRITTEN } from "./roth-overlay-cases";

type Tables = Record<string, Record<string, unknown>[]>;
const TAGS = pgJournal.entries.map((e) => e.tag);

/** A backup's rows; `older` leaves the switch column out, as a backup
 *  from before the tag has none. */
const backup = (older = false): Tables => ({
  retirement_settings: ROWS.filter(
    (c) => !older || c.overlay === undefined,
  ).map((c) => ({
    id: c.id,
    person_id: 62,
    roth_bracket_target: c.target,
    ...(older ? {} : { roth_bracket_overlay: c.overlay ?? null }),
  })),
});
const settingsOf = (t: Record<string, unknown[]>) =>
  (t["retirement_settings"] ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      target: Number(row["roth_bracket_target"]),
      overlay: row["roth_bracket_overlay"],
    };
  });

describe("the Roth-overlay tag", () => {
  it("is the journal's tag after the job-entries tag in both dialects, its converter after the SQL", () => {
    expect(TAGS.indexOf(ROTH_OVERLAY_TAG)).toBe(
      TAGS.indexOf("0021_v0110_job_entries") + 1,
    );
    expect(sqliteJournal.entries.map((e) => e.tag)).toEqual(TAGS);
    expect(tagConverters(ROTH_OVERLAY_TAG)).toEqual([ROTH_OVERLAY_CONVERTER]);
    expect(ROTH_OVERLAY_CONVERTER.runs).toBe("afterSql");
  });

  it("turns the overlay on where no switch is stored, and a replay writes nothing", () => {
    const tables = expectRestoreReplaySafe(ROTH_OVERLAY_CONVERTER, backup());
    expect(settingsOf(tables)).toEqual(ROWS.map((c) => c.after));
  });

  it("writes only the rows with no switch", () => {
    const r = ROTH_OVERLAY_CONVERTER.convert(backup());
    expect(r.updates.map((u) => u.id)).toEqual(WRITTEN);
  });

  it("a backup from before the tag, with no switch column, converts the same", () => {
    const before = TAGS[TAGS.indexOf(ROTH_OVERLAY_TAG) - 1]!;
    const { tables } = transformBackupToCurrentSchema(
      backup(true),
      before,
      TAGS.at(-1)!,
    );
    expect(settingsOf(tables)).toEqual(
      ROWS.filter((c) => c.overlay === undefined).map((c) => c.after),
    );
  });
});
