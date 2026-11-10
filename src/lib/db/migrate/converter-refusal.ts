/** A converter's refusal to start, and the key a converter asks for: the
 *  migration stops in its transaction, so nothing is written, and the
 *  message holds declared words, row ids and field names, never a value. */

import { parseEncryptionKey } from "../../crypto-envelope";
import type { ConverterContext } from "./converter-rows";

/** Ids named per table; the rest are counted. */
const SHOWN = 50;

export type Refused = Readonly<Record<string, readonly number[]>>;

/** A refusal's words, declared beside its converter: what is wrong, the way
 *  out on an upgrade and on a restore, and the only field names it may name. */
export type RefusalText = {
  readonly problem: string;
  readonly upgradeFix: string;
  readonly restoreFix: string;
  readonly fields?: readonly string[];
};

/** A refusal code as a message may show it: an identifier, never text. */
const shownCode = (code: string) =>
  /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(code) ? code : "(not an identifier)";

/** What a converter throws: which declared refusal, and the rows (and
 *  declared fields) it names. Its own message is only the code. */
export class ConverterRefusal extends Error {
  constructor(
    readonly code: string,
    readonly refused: Refused,
    readonly fields: readonly string[] = [],
  ) {
    super(`Converter refusal ${shownCode(code)}`);
    this.name = "ConverterRefusal";
  }
}

/** Where a refusal stops: an upgrade's migration, or a backup's restore. */
export type RefusalPath = "upgrade" | "restore";

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

/** What reaches the log and the household: the declared words for its
 *  path, each table's row ids and the field names. */
export class MigrationRefusal extends Error {
  readonly refused: Refused;
  readonly fields: readonly string[];

  constructor(
    text: RefusalText,
    path: RefusalPath,
    refused: Refused = {},
    fields: readonly string[] = [],
  ) {
    const rows = Object.entries(refused)
      .filter(([, ids]) => ids.length > 0)
      .map(([table, ids]) => `${table} ${listed(ids)}`);
    const named = [
      ...(rows.length > 0 ? [`rows: ${rows.join("; ")}`] : []),
      ...(fields.length > 0
        ? [`fields: ${[...new Set(fields)].join(", ")}`]
        : []),
    ];
    const where = named.length > 0 ? ` (${named.join("; ")})` : "";
    super(
      path === "upgrade"
        ? `${text.problem}${where}. Nothing was changed. ${text.upgradeFix}`
        : `This backup can't be restored as it is: ${text.problem}${where}. Nothing was restored. ${text.restoreFix}`,
    );
    this.name = "MigrationRefusal";
    this.refused = refused;
    this.fields = fields;
  }
}

/** A converter's refusal checked against what it declared (the code, the
 *  tables it reads, the code's fields), as the household sees it. */
export function declaredRefusal(
  converter: {
    readonly tables: readonly string[];
    readonly refusals?: Readonly<Record<string, RefusalText>>;
  },
  e: ConverterRefusal,
  path: RefusalPath,
): MigrationRefusal {
  const declared = converter.refusals ?? {};
  const text = Object.hasOwn(declared, e.code) ? declared[e.code] : undefined;
  if (!text)
    throw new Error(`Converter refusal ${shownCode(e.code)} isn't declared`);
  if (Object.keys(e.refused).some((t) => !converter.tables.includes(t)))
    throw new Error(
      `Converter refusal ${shownCode(e.code)} names a table its converter doesn't read`,
    );
  if (e.fields.some((f) => !(text.fields ?? []).includes(f)))
    throw new Error(
      `Converter refusal ${shownCode(e.code)} names a field it doesn't declare`,
    );
  return new MigrationRefusal(text, path, e.refused, e.fields);
}

const KEY_REFUSAL: RefusalText = {
  problem:
    "Stored credentials must be encrypted, and ENCRYPTION_KEY is missing or isn't a base64 32-byte key",
  upgradeFix: "Set the key this install uses and start again.",
  restoreFix: "Set the key this install uses, restart Ledgr and restore again.",
};

/** ENCRYPTION_KEY as it is when a converter asks (db-migrate.ts has loaded
 *  .env by then); missing or malformed, the path is refused. */
export const keyContext = (path: RefusalPath): ConverterContext => ({
  encryptionKey: () => {
    try {
      return parseEncryptionKey(process.env["ENCRYPTION_KEY"]);
    } catch {
      throw new MigrationRefusal(KEY_REFUSAL, path);
    }
  },
});
