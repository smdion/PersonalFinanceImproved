/**
 * The migrator names an older install's schema by the hash of the last
 * migration it applied (db-migrate.ts's detectSchemaEra). The current line's
 * hashes come from the drizzle journal; this pins the map to v0.10.1's hand
 * list, entry for entry and in order, and checks each journal file is covered.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrationTagsByHash } from "../../db-migrate";
import v0101 from "../fixtures/v08-migration-hashes-v0.10.1.json";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

describe("migration tags by hash", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  /** A migrations folder with one journal entry per tag; `files` get SQL. */
  function folder(tags: string[], files: string[]): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledgr-tags-"));
    fs.mkdirSync(path.join(dir, "meta"));
    fs.writeFileSync(
      path.join(dir, "meta/_journal.json"),
      JSON.stringify({ entries: tags.map((tag, idx) => ({ idx, tag })) }),
    );
    for (const tag of files)
      fs.writeFileSync(path.join(dir, `${tag}.sql`), `-- ${tag}\n`);
    return dir;
  }

  it("equal v0.10.1's hand list, element for element", () => {
    expect(
      Object.entries(migrationTagsByHash("./drizzle")).slice(0, v0101.length),
    ).toEqual(v0101);
  });

  it("map every PostgreSQL journal file's hash to its tag", () => {
    const journal = JSON.parse(
      fs.readFileSync("drizzle/meta/_journal.json", "utf8"),
    ) as { entries: { tag: string }[] };
    const tags = migrationTagsByHash("./drizzle");
    const missing = journal.entries
      .map((e) => {
        const hash = createHash("sha256")
          .update(fs.readFileSync(`drizzle/${e.tag}.sql`))
          .digest("hex");
        return tags[hash] === e.tag ? null : e.tag;
      })
      .filter(Boolean);
    expect(missing).toEqual([]);
  });

  it("gives a journal entry with no SQL file no hash, without throwing", () => {
    const tags = migrationTagsByHash(folder(["0000_a", "0001_b"], ["0000_a"]));
    expect(tags[sha("-- 0000_a\n")]).toBe("0000_a");
    expect(Object.values(tags)).not.toContain("0001_b");
  });

  it("throws when the journal is missing", () => {
    const empty = folder([], []);
    fs.rmSync(path.join(empty, "meta/_journal.json"));
    expect(() => migrationTagsByHash(empty)).toThrow();
  });
});
