/**
 * SEC connection — the contact SEC requires in every request's User-Agent
 * (its fair-access policy). One api_connections row (service = "sec") with
 * the contact in an encrypted envelope, same pattern as Tiingo.
 */
import "server-only";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { encryptJson, decryptJson } from "@/lib/crypto";
import type { Db } from "@/lib/db";

const SEC_SERVICE = "sec";

type SecConfig = { contactEmail: string };
const secConfigShape: z.ZodType<SecConfig> = z.object({
  contactEmail: z.string(),
});

export async function getSecConnection(db: Db) {
  const rows = await db
    .select()
    .from(schema.apiConnections)
    .where(eq(schema.apiConnections.service, SEC_SERVICE))
    .limit(1);
  return rows[0] ?? null;
}

/** Decrypted contact, or null when SEC isn't set up. */
export async function getSecContact(db: Db): Promise<string | null> {
  const conn = await getSecConnection(db);
  if (!conn) return null;
  // A saved config may lack the field (logged, read as stored).
  return (
    decryptJson(conn.config, "api_connections.config (sec)", secConfigShape)
      .contactEmail ?? null
  );
}

export async function saveSecConnection(db: Db, contactEmail: string) {
  const config = encryptJson({ contactEmail } satisfies SecConfig);
  // eslint-disable-next-line no-restricted-syntax -- encrypted envelope stored in the generic ApiConfig jsonb column, same pattern as saveTiingoConnection()
  const storedConfig = config as unknown as schema.ApiConfig;
  await db
    .insert(schema.apiConnections)
    .values({ service: SEC_SERVICE, config: storedConfig })
    .onConflictDoUpdate({
      target: schema.apiConnections.service,
      set: { config: storedConfig },
    });
}

export async function removeSecConnection(db: Db) {
  await db
    .delete(schema.apiConnections)
    .where(eq(schema.apiConnections.service, SEC_SERVICE));
}
