/** The SimpleFIN connection's api_connections.config, as its writer stores it. */
import { z } from "zod/v4";
import { readMaybeEncrypted } from "@/lib/crypto";

export type SimplefinConfig = {
  accessUrl: string;
};

const simplefinConfigShape: z.ZodType<SimplefinConfig> = z.object({
  accessUrl: z.string(),
});

/** The stored config (plaintext or encrypted), checked: a refused one is
 *  logged once and read as stored. */
export function readSimplefinConfig(stored: unknown): SimplefinConfig {
  return readMaybeEncrypted(
    stored,
    "api_connections.config (simplefin)",
    simplefinConfigShape,
  );
}
