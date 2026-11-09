/** What a converter throws to refuse the start: the migration stops in its
 *  transaction, so nothing is written, and db-migrate.ts logs the ids. A
 *  missing encryption key refuses it too. */

import { parseEncryptionKey } from "../../crypto-envelope";
import type { ConverterContext } from "./converter-rows";

/** Field names a refusal may name: identifiers only, never a stored text. */
const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** Ids named per table; the rest are counted. */
const SHOWN = 50;

export type Refused = Readonly<Record<string, readonly number[]>>;

function listed(ids: readonly number[]): string {
  for (const id of ids)
    if (!Number.isSafeInteger(id))
      throw new Error(`A refusal names row ids only, not ${typeof id}`);
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const more = sorted.length - SHOWN;
  return (
    sorted.slice(0, SHOWN).join(", ") + (more > 0 ? ` and ${more} more` : "")
  );
}

/**
 * Rows a converter can't convert without changing what they read as. The
 * message names each table's row ids and, optionally, field names; never a
 * value. `fix` tells the household what to change before upgrading again.
 */
export class MigrationRefusal extends Error {
  readonly refused: Refused;
  readonly fields: readonly string[];

  constructor(r: {
    problem: string;
    refused?: Refused;
    fields?: readonly string[];
    fix: string;
  }) {
    const refused = r.refused ?? {};
    const rows = Object.entries(refused)
      .filter(([, ids]) => ids.length > 0)
      .map(([table, ids]) => `${table} ${listed(ids)}`);
    const fields = [...new Set(r.fields ?? [])].filter((f) => FIELD.test(f));
    const named = [
      ...(rows.length > 0 ? [`rows: ${rows.join("; ")}`] : []),
      ...(fields.length > 0 ? [`fields: ${fields.join(", ")}`] : []),
    ];
    super(
      `${r.problem}${named.length > 0 ? ` (${named.join("; ")})` : ""}. ` +
        `Nothing was changed. ${r.fix}`,
    );
    this.name = "MigrationRefusal";
    this.refused = refused;
    this.fields = fields;
  }
}

/** ENCRYPTION_KEY as it is when a converter asks (db-migrate.ts has loaded
 *  .env by then); missing or malformed, the start is refused. */
export const ENV_CONTEXT: ConverterContext = {
  encryptionKey: (purpose) => {
    try {
      return parseEncryptionKey(process.env["ENCRYPTION_KEY"]);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      throw new MigrationRefusal({
        problem: `ENCRYPTION_KEY is required to ${purpose}: ${why.replace(/\.$/, "")}`,
        fix: "Set it and start again.",
      });
    }
  },
};
