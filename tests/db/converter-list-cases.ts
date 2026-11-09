/**
 * Invented converters over app_settings for the converter-list tests on
 * both dialects: three idempotent ones that update, insert and delete, one
 * that changes its own output, and one that asks for the encryption key.
 */
import type {
  ConverterResult,
  ConverterTables,
  DataConverter,
} from "@/lib/db/migrate/migration-converters";
import {
  encryptStringWithKey,
  isEncryptedEnvelope,
} from "@/lib/crypto-envelope";

type Setting = { id: number; key: string; value: string };
const settingsOf = (t: ConverterTables) =>
  (t["app_settings"] ?? []) as Setting[];

/** A converter over app_settings whose result `make` builds from them. */
export const over = (
  make: (rows: Setting[]) => Omit<ConverterResult, "notes">,
  runs: DataConverter["runs"] = "afterSql",
): DataConverter => ({
  tables: ["app_settings"],
  runs,
  convert: (t) => ({ ...make(settingsOf(t)), notes: [] }),
});

/** Renames each `invented_*` key to `moved_*` (a projection). */
export const renames = over((rows) => ({
  updates: rows
    .filter((r) => r.key.startsWith("invented_"))
    .map((r) => ({
      table: "app_settings",
      id: r.id,
      set: { key: r.key.replace("invented_", "moved_") },
    })),
}));
/** Records how many `moved_*` rows it read, once (a count row). */
export const counts = over((rows) => ({
  updates: [],
  inserts: rows.some((r) => r.key === "moved_count")
    ? []
    : [
        {
          table: "app_settings",
          row: {
            key: "moved_count",
            value: String(
              rows.filter((r) => r.key.startsWith("moved_")).length,
            ),
          },
        },
      ],
}));
/** Deletes every `retired_*` row. */
export const purges = over((rows) => ({
  updates: [],
  deletes: rows
    .filter((r) => r.key.startsWith("retired_"))
    .map((r) => ({ table: "app_settings", id: r.id })),
}));
/** Appends "!" to every value: not idempotent. */
export const appends = over((rows) => ({
  updates: rows.map((r) => ({
    table: "app_settings",
    id: r.id,
    set: { value: `${r.value}!` },
  })),
}));

/** Encrypts each `secret_*` setting's text, asking for the key only then. */
export const encrypts: DataConverter = {
  tables: ["app_settings"],
  runs: "afterSql",
  convert: (tables, context) => {
    const plain = settingsOf(tables).filter(
      (r) =>
        r.key.startsWith("secret_") &&
        !isEncryptedEnvelope(JSON.parse(r.value)),
    );
    if (plain.length === 0) return { updates: [], notes: [] };
    const key = context.encryptionKey(
      `encrypt ${plain.length} invented credential(s)`,
    );
    return {
      updates: plain.map((r) => ({
        table: "app_settings",
        id: r.id,
        set: { value: encryptStringWithKey(key, r.value) },
      })),
      notes: [],
    };
  },
};
