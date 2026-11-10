/**
 * The credentials tag's mapping step on the restore path: every mapping of
 * mapping-ids-cases.ts gets the typed id its prefix or asset name names,
 * an unmatched plain name is left and reported by position only; replayed
 * over its own output it writes nothing. The restore-only label step links
 * a name a portfolio label matches, only for a backup from before the tag.
 */
import { describe, it, expect } from "vitest";
import { MAPPING_IDS_CONVERTER } from "@/lib/db/migrate/v0106-mapping-ids";
import { CREDENTIALS_TAG } from "@/lib/db/migrate/v0106-credentials";
import { tagConverters } from "@/lib/db/migrate/migration-converters";
import { restoreLinks } from "@/lib/db/backup/restore-links";
import { expectRestoreReplaySafe } from "./converter-replay";
import { AFTER, ASSETS, CONNECTIONS, MAPPING_CASES } from "./mapping-ids-cases";

const backup = (form: "sqlite" | "postgres") => ({
  api_connections: CONNECTIONS.map((c) => ({
    id: c.id,
    service: c.service,
    account_mappings:
      form === "sqlite" && c.mappings !== null
        ? JSON.stringify(c.mappings)
        : c.mappings,
  })),
  other_asset_items: ASSETS.map((a) => ({ ...a })),
});

const mappingsOf = (tables: Record<string, unknown[]>, id: number) => {
  const row = (tables["api_connections"] as Record<string, unknown>[]).find(
    (c) => c["id"] === id,
  )!;
  const v = row["account_mappings"];
  const parsed: unknown = typeof v === "string" ? JSON.parse(v) : v;
  return parsed;
};

describe("the mapping-ids converter", () => {
  it("runs second in the credentials tag", () => {
    expect(tagConverters(CREDENTIALS_TAG)[1]).toBe(MAPPING_IDS_CONVERTER);
  });

  it.each(["sqlite", "postgres"] as const)(
    "types every mapping in a %s backup, and a replay writes nothing",
    (form) => {
      const tables = expectRestoreReplaySafe(
        [MAPPING_IDS_CONVERTER],
        backup(form),
      );
      MAPPING_CASES.forEach((c, i) =>
        expect((mappingsOf(tables, 1) as unknown[])[i], c.what).toEqual(
          c.after,
        ),
      );
      expect(mappingsOf(tables, 2)).toBeNull();
      expect(mappingsOf(tables, 3)).toEqual([]);
    },
  );

  it("reports an unmatched name or a malformed id by connection and position, never by name", () => {
    const result = MAPPING_IDS_CONVERTER.convert(backup("postgres"));
    const name = MAPPING_CASES.findIndex((c) =>
      c.what.startsWith("a plain name no asset"),
    );
    const malformed = MAPPING_CASES.findIndex(
      (c) => c.what === "a malformed id (reported to re-map)",
    );
    expect(result.notes).toEqual([
      `${AFTER.filter((a, i) => a !== MAPPING_CASES[i]!.before).length} account mappings given their typed id`,
      `2 mappings name no Ledgr account (a name no asset holds, or a malformed id), left to re-map (connection#mapping): 1#${name}, 1#${malformed}`,
    ]);
    expect(JSON.stringify(result.notes)).not.toContain("Invented");
  });
});

describe("the restore-only label step", () => {
  const tables = (schemaVersion: string) => {
    const t: Record<string, unknown[]> = {
      api_connections: [
        {
          id: 1,
          service: "ynab",
          account_mappings: JSON.stringify([
            {
              localName: "Invented brokerage",
              remoteAccountId: "r",
              syncDirection: "push",
            },
            {
              localName: "Invented boat",
              remoteAccountId: "s",
              syncDirection: "pull",
            },
          ]),
        },
      ],
      performance_accounts: [
        { id: 5, account_label: "Invented brokerage", display_name: null },
        { id: 6, account_label: "Invented boat", display_name: null },
      ],
      other_asset_items: ASSETS.map((a) => ({ ...a })),
    };
    restoreLinks(t, schemaVersion);
    return mappingsOf(t, 1) as Record<string, unknown>[];
  };

  it("links a name a label matches and no asset holds, before the tag", () => {
    const [brokerage, boat] = tables("0017_v0102_match_value");
    expect(brokerage).toMatchObject({
      localId: "performance:5",
      performanceAccountId: 5,
    });
    expect(boat).not.toHaveProperty("localId");
  });

  it("leaves a backup from the tag on alone", () => {
    const [brokerage] = tables(CREDENTIALS_TAG);
    expect(brokerage).not.toHaveProperty("localId");
  });
});
