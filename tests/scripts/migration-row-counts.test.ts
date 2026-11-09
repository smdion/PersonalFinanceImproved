/**
 * scripts/migration-row-counts.ts: the row-count changes test-migration.sh
 * allows come from the converters of the tags the database hasn't
 * recorded, as each declares them, and from no other tag.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import type { DataConverter } from "@/lib/db/migrate/migration-converters";
import { rowCountAllowances } from "../../scripts/migration-row-counts";

const converter = (rowCounts: DataConverter["rowCounts"]): DataConverter => ({
  tables: [],
  runs: "afterSql",
  rowCounts,
  convert: () => ({ updates: [], notes: [] }),
});

describe("rowCountAllowances", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A journal of `tags`, each file holding its own tag as SQL. */
  function journal(tags: string[]): string {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-row-counts-"));
    fs.mkdirSync(path.join(dir, "meta"));
    fs.writeFileSync(
      path.join(dir, "meta", "_journal.json"),
      JSON.stringify({ entries: tags.map((tag) => ({ tag })) }),
    );
    for (const tag of tags)
      fs.writeFileSync(path.join(dir, `${tag}.sql`), `-- ${tag}`);
    return dir;
  }
  const hash = (tag: string) =>
    createHash("sha256").update(`-- ${tag}`).digest("hex");

  it("lists the pending tags' declared tables, each once, sorted", () => {
    const folder = journal(["0001_a", "0002_b", "0003_c"]);
    const registry = {
      "0001_a": converter({ grows: ["applied_table"] }),
      "0002_b": [
        converter({
          grows: ["savings_monthly"],
          shrinks: ["budget_api_cache"],
        }),
        converter({ shrinks: ["budget_api_cache"] }),
      ],
      "0003_c": converter(undefined),
    };
    expect(
      rowCountAllowances(folder, new Set([hash("0001_a")]), registry),
    ).toEqual(["budget_api_cache|shrinks", "savings_monthly|grows"]);
  });

  it("allows nothing when every tag is recorded or declares nothing", () => {
    const folder = journal(["0001_a"]);
    const registry = { "0001_a": converter({ grows: ["t"] }) };
    expect(
      rowCountAllowances(folder, new Set([hash("0001_a")]), registry),
    ).toEqual([]);
    expect(rowCountAllowances(folder, new Set(), {})).toEqual([]);
  });
});
