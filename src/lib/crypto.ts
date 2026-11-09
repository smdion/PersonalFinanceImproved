/** AES-256-GCM at-rest encryption for secrets with ENCRYPTION_KEY (32 bytes, base64; envelope
 *  format in crypto-envelope.ts). Plaintext values still read. Defends against backup leaks,
 *  not against code execution in the running app. */

import "server-only";
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
 * Decrypt + JSON.parse. Throws if the input isn't a valid envelope.
 * Use isEncryptedEnvelope() to detect plaintext legacy values first.
 */
export function decryptJson<T>(envelope: EncryptedEnvelope): T {
  return JSON.parse(decryptString(envelope)) as T;
}

/** Read a config value stored as plaintext (returned as-is) or as an encrypted envelope
 *  (decrypted and parsed). Writes always go through encryptJson(). */
export function readMaybeEncrypted<T>(storedValue: unknown): T {
  if (isEncryptedEnvelope(storedValue)) {
    return decryptJson<T>(storedValue);
  }
  return storedValue as T;
}
