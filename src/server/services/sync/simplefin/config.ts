/** The SimpleFIN connection's api_connections.config, as its writer stores it. */
import { z } from "zod/v4";
import { decryptJson } from "@/lib/crypto";

export type SimplefinConfig = {
  accessUrl: string;
};

const simplefinConfigShape: z.ZodType<SimplefinConfig> = z.object({
  accessUrl: z.string(),
});

/** The stored config decrypted and checked: a refused one is
 *  logged once and read as stored. */
export function readSimplefinConfig(stored: unknown): SimplefinConfig {
  return decryptJson(
    stored,
    "api_connections.config (simplefin)",
    simplefinConfigShape,
  );
}
