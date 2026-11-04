/**
 * KNOWN_SCHEMA_VERSIONS takes the current line's tags from the drizzle
 * journal. The order is load-bearing (predatesAssetClassBuckets compares
 * positions), so the list starts with v0.10.0's hand list, element for
 * element, and ends with the journal's tags.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KNOWN_SCHEMA_VERSIONS } from "@/lib/db/backup-transforms";
import v0100 from "../fixtures/known-schema-versions-v0.10.0.json";

const journalTags = (dir: string): string[] =>
  (
    JSON.parse(
      readFileSync(path.join(process.cwd(), dir, "meta/_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] }
  ).entries.map((e) => e.tag);

describe("KNOWN_SCHEMA_VERSIONS from the journal", () => {
  it("starts with v0.10.0's hand list, element for element", () => {
    expect(KNOWN_SCHEMA_VERSIONS.slice(0, v0100.length)).toEqual(v0100);
  });

  it("ends with the PostgreSQL journal's tags, in journal order", () => {
    const tags = journalTags("drizzle");
    expect(KNOWN_SCHEMA_VERSIONS.slice(-tags.length)).toEqual(tags);
  });

  it("reads the same tags as the SQLite journal", () => {
    expect(journalTags("drizzle-sqlite")).toEqual(journalTags("drizzle"));
  });
});
