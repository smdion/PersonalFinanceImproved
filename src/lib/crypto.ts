/** AES-256-GCM at-rest encryption for secrets with ENCRYPTION_KEY (32 bytes, base64; envelope
 *  format in crypto-envelope.ts). Plaintext values still read. Defends against backup leaks,
 *  not against code execution in the running app. */

import "server-only";
import type { z } from "zod/v4";
import {
  passOnAsStored,
  readStoredShape,
  storedValueLog,
} from "@/lib/db/stored-shape";
import {
  decryptStringWithKey,
  encryptStringWithKey,
  isEncryptedEnvelope,
  parseEncryptionKey,
  type EncryptedEnvelope,
} from "./crypto-envelope";

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  cachedKey ??= parseEncryptionKey(process.env.ENCRYPTION_KEY);
  return cachedKey;
}

/** Encrypt a UTF-8 string. Throws if ENCRYPTION_KEY is missing/invalid. */
export function encryptString(plaintext: string): EncryptedEnvelope {
  return encryptStringWithKey(getKey(), plaintext);
}

/** Decrypt an envelope. Throws on auth-tag mismatch or wrong key. */
export function decryptString(envelope: EncryptedEnvelope): string {
  return decryptStringWithKey(getKey(), envelope);
}

/**
 * Encrypt a JSON-serializable object. Returns an envelope.
 * Use this for api_connections.config and similar JSONB columns.
 */
export function encryptJson(jsonPayload: unknown): EncryptedEnvelope {
  return encryptString(JSON.stringify(jsonPayload));
}

/**
 * Decrypt + JSON.parse, checked against `shape` (`readStoredConfig`). Throws if
 * the input isn't a valid envelope; isEncryptedEnvelope() detects plaintext.
 */
export function decryptJson<S extends z.ZodType>(
  envelope: EncryptedEnvelope,
  source: string,
  shape: S,
): z.output<S> {
  return readStoredConfig(source, JSON.parse(decryptString(envelope)), shape);
}

/** Read a config value stored as plaintext (returned as-is) or as an encrypted envelope
 *  (decrypted and parsed), checked against `shape` (`readStoredConfig`). Writes always go
 *  through encryptJson(). */
export function readMaybeEncrypted<S extends z.ZodType>(
  storedValue: unknown,
  source: string,
  shape: S,
): z.output<S> {
  if (isEncryptedEnvelope(storedValue))
    return decryptJson(storedValue, source, shape);
  return readStoredConfig(source, storedValue, shape);
}

/** A config value as read: a refused one is logged once per source and
 *  passed on as stored. */
function readStoredConfig<S extends z.ZodType>(
  source: string,
  value: unknown,
  shape: S,
): z.output<S> {
  return passOnAsStored(readStoredShape(value, shape, storedValueLog(source)));
}
