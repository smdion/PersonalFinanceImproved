/**
 * The key-rotation cases, shared by the SQLite and PostgreSQL files: each
 * starts from a database the real migrator just set up, holding invented
 * credentials. Each file supplies `fresh()` for its database.
 */
import { it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import {
  decryptStringWithKey,
  encryptStringWithKey,
  isEncryptedEnvelope,
} from "@/lib/crypto-envelope";
import {
  RotationRefused,
  type RotationCounts,
  type RotationKeys,
} from "../../scripts/rotate-encryption-key";

export interface RotationDatabase {
  /** Stores a connection's config as the app does (an object for jsonb, JSON text on SQLite). */
  addConnection: (
    id: number,
    service: string,
    config: unknown,
  ) => Promise<void>;
  /** Stores a version whose `api_connections` table holds `rows`, as createVersion does. */
  addVersion: (versionId: number, rows: unknown[]) => Promise<void>;
  /** Each connection's config by id, parsed. */
  configs: () => Promise<Record<number, unknown>>;
  /** The stored versions' `api_connections` rows, parsed. */
  versionRows: () => Promise<{ config: unknown }[]>;
  rotate: (keys: RotationKeys, dryRun: boolean) => Promise<RotationCounts>;
}

const newKey = () => randomBytes(32);

/** The plaintext a stored config holds under `key` (config may be JSON text of an envelope). */
function open(key: Buffer, config: unknown): string {
  const value: unknown =
    typeof config === "string" ? JSON.parse(config) : config;
  if (!isEncryptedEnvelope(value)) throw new Error("not an envelope");
  return decryptStringWithKey(key, value);
}

const YNAB = JSON.stringify({ accessToken: "invented-ynab-token" });
const TIINGO = JSON.stringify({ apiKey: "invented-tiingo-key" });
const LEGACY = { contactEmail: "someone@example.invalid" };

export function keyRotationCases(
  label: string,
  fresh: () => Promise<RotationDatabase>,
  /** How a stored version holds a config on this dialect. */
  versionConfig: (envelope: unknown) => unknown,
): void {
  it(`${label}: re-encrypts every credential, versions included, under the new key`, async () => {
    const keys = { oldKey: newKey(), newKey: newKey() };
    const db = await fresh();
    await db.addConnection(1, "ynab", encryptStringWithKey(keys.oldKey, YNAB));
    await db.addConnection(
      2,
      "tiingo",
      encryptStringWithKey(keys.oldKey, TIINGO),
    );
    await db.addConnection(3, "sec", LEGACY);
    await db.addVersion(1, [
      {
        id: 1,
        service: "ynab",
        config: versionConfig(encryptStringWithKey(keys.oldKey, YNAB)),
      },
      { id: 3, service: "sec", config: versionConfig(LEGACY) },
    ]);

    expect(await db.rotate(keys, false)).toEqual({
      connections: 2,
      versionCredentials: 1,
      plaintext: 1,
    });

    const configs = await db.configs();
    expect(open(keys.newKey, configs[1])).toBe(YNAB);
    expect(open(keys.newKey, configs[2])).toBe(TIINGO);
    expect(() => open(keys.oldKey, configs[1])).toThrow();
    expect(configs[3]).toEqual(LEGACY);
    const [ynabRow, secRow] = await db.versionRows();
    expect(open(keys.newKey, ynabRow!.config)).toBe(YNAB);
    expect(typeof ynabRow!.config).toBe(typeof versionConfig({}));
    expect(secRow!.config).toEqual(versionConfig(LEGACY));
  });

  it(`${label}: a dry run counts and changes nothing`, async () => {
    const keys = { oldKey: newKey(), newKey: newKey() };
    const db = await fresh();
    await db.addConnection(1, "ynab", encryptStringWithKey(keys.oldKey, YNAB));
    await db.addVersion(1, [
      {
        id: 1,
        service: "ynab",
        config: versionConfig(encryptStringWithKey(keys.oldKey, YNAB)),
      },
    ]);
    const before = {
      configs: await db.configs(),
      rows: await db.versionRows(),
    };

    expect(await db.rotate(keys, true)).toEqual({
      connections: 1,
      versionCredentials: 1,
      plaintext: 0,
    });
    expect({
      configs: await db.configs(),
      rows: await db.versionRows(),
    }).toEqual(before);
  });

  it(`${label}: a credential the old key can't open changes nothing`, async () => {
    const keys = { oldKey: newKey(), newKey: newKey() };
    const db = await fresh();
    await db.addConnection(1, "ynab", encryptStringWithKey(keys.oldKey, YNAB));
    await db.addConnection(2, "tiingo", encryptStringWithKey(newKey(), TIINGO));
    const before = await db.configs();

    await expect(db.rotate(keys, false)).rejects.toThrow(RotationRefused);
    await expect(db.rotate(keys, false)).rejects.toThrow(
      /api_connections id 2 \(tiingo\)\. Nothing was changed/,
    );
    expect(await db.configs()).toEqual(before);
  });

  it(`${label}: a second run says the credentials are already under the new key`, async () => {
    const keys = { oldKey: newKey(), newKey: newKey() };
    const db = await fresh();
    await db.addConnection(1, "ynab", encryptStringWithKey(keys.oldKey, YNAB));
    await db.rotate(keys, false);
    const after = await db.configs();

    await expect(db.rotate(keys, false)).rejects.toThrow(
      "api_connections id 1 (ynab) (already under ENCRYPTION_KEY_NEW)",
    );
    expect(await db.configs()).toEqual(after);
  });
}
