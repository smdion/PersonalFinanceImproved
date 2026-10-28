/**
 * Tiingo connection storage — one api_connections row (service = "tiingo")
 * holding the API key in an encrypted envelope, same pattern as
 * saveSimplefinConnection in lib/simplefin/sync.ts.
 */
import "server-only";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { encryptJson, readMaybeEncrypted } from "@/lib/crypto";

type Db = typeof import("@/lib/db").db;

const TIINGO_SERVICE = "tiingo";

type TiingoConfig = { apiKey: string };

export async function getTiingoConnection(db: Db) {
  const rows = await db
    .select()
    .from(schema.apiConnections)
    .where(eq(schema.apiConnections.service, TIINGO_SERVICE))
    .limit(1);
  return rows[0] ?? null;
}

/** Decrypted API key, or null when no connection is configured. */
export async function getTiingoApiKey(db: Db): Promise<string | null> {
  const conn = await getTiingoConnection(db);
  if (!conn) return null;
  return readMaybeEncrypted<TiingoConfig>(conn.config).apiKey ?? null;
}

export async function saveTiingoConnection(db: Db, apiKey: string) {
  const config = encryptJson({ apiKey } satisfies TiingoConfig);
  // eslint-disable-next-line no-restricted-syntax -- encrypted envelope stored in the generic ApiConfig jsonb column, same pattern as saveSimplefinConnection() in simplefin/sync.ts
  const storedConfig = config as unknown as schema.ApiConfig;
  await db
    .insert(schema.apiConnections)
    .values({ service: TIINGO_SERVICE, config: storedConfig })
    .onConflictDoUpdate({
      target: schema.apiConnections.service,
      set: { config: storedConfig },
    });
}

export async function removeTiingoConnection(db: Db) {
  await db
    .delete(schema.apiConnections)
    .where(eq(schema.apiConnections.service, TIINGO_SERVICE));
}
