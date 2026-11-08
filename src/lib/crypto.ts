/**
 * AES-256-GCM encryption for at-rest sensitive data (API tokens, secrets).
 *
 * Uses node:crypto (no extra deps). The encrypted format is self-describing,
 * so plaintext legacy values can be detected and read transparently before
 * the next write encrypts them. Reads NEVER fail on plaintext input.
 *
 * Format (JSON):
 *   {
 *     "v": 1,             // format version (bump if AAD/AEAD changes)
 *     "iv": "<base64>",   // 12-byte random IV
 *     "tag": "<base64>",  // 16-byte GCM auth tag
 *     "ct": "<base64>"    // ciphertext (UTF-8 plaintext encrypted)
 *   }
 *
 * Key:
 *   ENCRYPTION_KEY env var. Must be 32 bytes encoded as base64 (44 chars).
 *   Required in production by env.ts. Generate one with:
 *     node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))'
 *
 * Threat model:
 *   Defends against PostgreSQL backup leaks. Does
 *   NOT defend against an attacker with code execution on the running app
 *   (they have ENCRYPTION_KEY and can decrypt). It moves credentials from
 *   "anyone with a backup" to "anyone with the running container" — a
 *   meaningful reduction in blast radius for a self-hosted homelab.
 */

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

/**
 * Read a config value that may be either plaintext (legacy) or encrypted.
 * Returns the parsed config object regardless of format.
 *
 * On legacy plaintext: returns the value as-is (no decryption).
 * On encrypted envelope: decrypts and returns the parsed object.
 *
 * The next write should always re-encrypt via encryptJson() so legacy
 * values get upgraded transparently.
 */
export function readMaybeEncrypted<T>(storedValue: unknown): T {
  if (isEncryptedEnvelope(storedValue)) {
    return decryptJson<T>(storedValue);
  }
  return storedValue as T;
}
