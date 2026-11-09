/** The budget apps' api_connections.config as read (plaintext or
 *  encrypted), checked against the shape its writer stores. */
import "server-only";
import { z } from "zod/v4";
import { readMaybeEncrypted } from "@/lib/crypto";
import type { ActualConfig, YnabConfig } from "./types";

const ynabConfigShape: z.ZodType<YnabConfig> = z.object({
  accessToken: z.string(),
  budgetId: z.string(),
});

const actualConfigShape: z.ZodType<ActualConfig> = z.object({
  serverUrl: z.string(),
  apiKey: z.string(),
  budgetSyncId: z.string(),
  externalUrl: z.string().optional(),
});

/** A refused config is logged once and read as stored. */
export function readYnabConfig(stored: unknown): YnabConfig {
  return readMaybeEncrypted(
    stored,
    "api_connections.config (ynab)",
    ynabConfigShape,
  );
}

/** A refused config is logged once and read as stored. */
export function readActualConfig(stored: unknown): ActualConfig {
  return readMaybeEncrypted(
    stored,
    "api_connections.config (actual)",
    actualConfigShape,
  );
}
