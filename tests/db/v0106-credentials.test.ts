/**
 * The credentials tag's converter on the restore path: every plaintext
 * config in an older backup is encrypted with ENCRYPTION_KEY and reads as
 * it read, an envelope is left byte-identical, one held as text is
 * unwrapped (never encrypted twice); replayed over its own output it writes
 * nothing; the key is read only when there is plaintext, and missing it
 * the restore is refused before any write. No note or refusal carries a
 * stored value.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CREDENTIALS_CONVERTER,
  CREDENTIALS_TAG,
} from "@/lib/db/migrate/v0106-credentials";
import {
  MIGRATION_CONVERTERS,
  convertBackup,
  tagConverters,
} from "@/lib/db/migrate/migration-converters";
import { MATCH_VALUE_TAG } from "@/lib/db/migrate/v0102-match-value";
import { MigrationRefusal } from "@/lib/db/migrate/converter-refusal";
import pgJournal from "../../drizzle/meta/_journal.json";
import sqliteJournal from "../../drizzle-sqlite/meta/_journal.json";
import { expectRestoreReplaySafe } from "./converter-replay";
import {
  CONNECTIONS,
  KEY_TEXT,
  OTHER_TABLE_ROWS,
  SECRETS,
  VERSION_COPIES,
  expectConverted,
  expectCopiesConverted,
} from "./credentials-cases";

/** A backup's api_connections rows: a SQLite export holds each config as
 *  its JSON text, a PostgreSQL export as the value. */
const backupRows = (form: "sqlite" | "postgres") =>
  CONNECTIONS.map((c) => ({
    id: c.id,
    service: c.service,
    config: form === "sqlite" ? JSON.stringify(c.stored) : c.stored,
  }));

/** Each row's config as restored: a SQLite backup's JSON text parsed. */
const configsOf = (rows: readonly unknown[], form: "sqlite" | "postgres") =>
  new Map(
    rows.map((r): [number, unknown] => {
      const row = r as { id: number; config: unknown };
      const text = form === "sqlite" && typeof row.config === "string";
      return [row.id, text ? JSON.parse(row.config as string) : row.config];
    }),
  );

const NO_KEY = {
  encryptionKey: (): Buffer => {
    throw new Error("asked for a key");
  },
};

describe("the credentials converter", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = KEY_TEXT;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("is registered after 0017 in both journals, after the tag's SQL", () => {
    const registered = Object.keys(MIGRATION_CONVERTERS);
    expect(registered.indexOf(CREDENTIALS_TAG)).toBeGreaterThan(
      registered.indexOf(MATCH_VALUE_TAG),
    );
    expect(tagConverters(CREDENTIALS_TAG)[0]).toBe(CREDENTIALS_CONVERTER);
    expect(CREDENTIALS_CONVERTER.runs).toBe("afterSql");
    for (const journal of [pgJournal, sqliteJournal])
      expect(journal.entries.map((e) => e.tag)).toContain(CREDENTIALS_TAG);
  });

  it("converts a SQLite backup's configs, and a replay writes nothing", () => {
    const tables = expectRestoreReplaySafe([CREDENTIALS_CONVERTER], {
      api_connections: backupRows("sqlite"),
    });
    expectConverted(configsOf(tables["api_connections"]!, "sqlite"));
  });

  it("converts a PostgreSQL backup's configs; a text-held envelope there stays as the text it is", () => {
    const tables = expectRestoreReplaySafe([CREDENTIALS_CONVERTER], {
      api_connections: backupRows("postgres"),
    });
    const configs = configsOf(tables["api_connections"]!, "postgres");
    const wrapped = CONNECTIONS.find((c) => c.after === "unwrapped")!;
    // A PostgreSQL backup's string reads as SQLite's JSON text: an envelope.
    expect(configs.get(wrapped.id)).toBe(wrapped.stored);
    configs.set(wrapped.id, JSON.parse(wrapped.stored as string));
    expectConverted(configs);
  });

  it("encrypts the plaintext copies in stored versions in their own form, and only those", () => {
    const copies = Object.values(VERSION_COPIES);
    const tables = expectRestoreReplaySafe([CREDENTIALS_CONVERTER], {
      state_version_tables: [
        { id: 1, version_id: 1, table_name: "api_connections", data: copies },
        {
          id: 2,
          version_id: 1,
          table_name: "api_connections",
          data: JSON.stringify(copies),
        },
        { id: 3, version_id: 1, table_name: "people", data: OTHER_TABLE_ROWS },
      ],
    });
    const [asValue, asText, other] = tables["state_version_tables"] as {
      data: unknown;
    }[];
    expectCopiesConverted(asValue!.data as unknown[]);
    expectCopiesConverted(asText!.data as unknown[]);
    expect(other!.data).toEqual(OTHER_TABLE_ROWS);
  });

  it("never asks for the key when every credential is already an envelope", () => {
    const envelopes = CONNECTIONS.filter((c) => c.after === "kept");
    const result = CREDENTIALS_CONVERTER.convert(
      {
        api_connections: envelopes.map((c) => ({ ...c, config: c.stored })),
        state_version_tables: [
          {
            id: 1,
            table_name: "api_connections",
            data: [VERSION_COPIES.envelopeValue, VERSION_COPIES.envelopeText],
          },
        ],
      },
      NO_KEY,
    );
    expect(result.updates).toEqual([]);
  });

  it("leaves a later envelope format alone, replayed in either backup form", () => {
    const later = { v: 2, ct: "invented-later-ct", nonce: "invented-nonce" };
    const rows = [
      { id: 1, service: "ynab", config: later },
      { id: 2, service: "actual", config: JSON.stringify(later) },
    ];
    const tables = expectRestoreReplaySafe([CREDENTIALS_CONVERTER], {
      api_connections: structuredClone(rows),
    });
    expect(tables["api_connections"]).toEqual(rows);
    const result = CREDENTIALS_CONVERTER.convert(
      { api_connections: rows },
      NO_KEY,
    );
    expect(result.updates).toEqual([]);
  });

  it("unwraps a text-held envelope without the key", () => {
    const wrapped = CONNECTIONS.filter((c) => c.after === "unwrapped");
    const result = CREDENTIALS_CONVERTER.convert(
      {
        api_connections: wrapped.map((c) => ({
          id: c.id,
          config: JSON.stringify(c.stored),
        })),
      },
      NO_KEY,
    );
    expect(result.updates).toHaveLength(wrapped.length);
  });

  it("without a key, a restore with plaintext is refused before any write, naming no value", () => {
    delete process.env.ENCRYPTION_KEY;
    const tables = { api_connections: backupRows("sqlite") };
    const before = structuredClone(tables);
    let refusal: unknown = null;
    try {
      convertBackup(
        tables,
        { [CREDENTIALS_TAG]: [CREDENTIALS_CONVERTER] },
        CREDENTIALS_TAG,
      );
    } catch (e) {
      refusal = e;
    }
    expect(refusal).toBeInstanceOf(MigrationRefusal);
    const message = (refusal as Error).message;
    expect(message).toMatch(
      /^This backup can't be restored as it is: Stored credentials must be encrypted, and ENCRYPTION_KEY is missing .*Nothing was restored\./,
    );
    for (const secret of SECRETS) expect(message).not.toContain(secret);
    expect(tables).toEqual(before);
  });

  it("its notes count rows and name no value", () => {
    const result = CREDENTIALS_CONVERTER.convert(
      {
        api_connections: backupRows("sqlite"),
        state_version_tables: [
          {
            id: 1,
            table_name: "api_connections",
            data: Object.values(VERSION_COPIES),
          },
        ],
      },
      { encryptionKey: () => Buffer.from(KEY_TEXT, "base64") },
    );
    expect(result.notes).toEqual([
      "6 connection configs encrypted, 1 unwrapped from text; 2 stored-version copies encrypted",
    ]);
    for (const secret of SECRETS)
      expect(JSON.stringify(result.notes)).not.toContain(secret);
  });
});
