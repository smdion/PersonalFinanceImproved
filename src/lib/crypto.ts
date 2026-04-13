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
 *   Defends against PostgreSQL backup leaks (the audit's C1 finding). Does
 *   NOT defend against an attacker with code execution on the running app
 *   (they have ENCRYPTION_KEY and can decrypt). It moves credentials from
 *   "anyone with a backup" to "anyone with the running container" — a
 *   meaningful reduction in blast radius for a self-hosted homelab.
 */

import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  type CipherGCM,
  type DecipherGCM,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32; // 256 bits
const IV_BYTES = 12; // GCM standard
const FORMAT_VERSION = 1 as const;

interface EncryptedEnvelope {
  v: typeof FORMAT_VERSION;
  iv: string; // base64
  tag: string; // base64
  ct: string; // base64
}

/** True if the value looks like an encrypted envelope (has v + iv + tag + ct). */
export function isEncryptedEnvelope(
  value: unknown,
): value is EncryptedEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === FORMAT_VERSION &&
    typeof v.iv === "string" &&
    typeof v.tag === "string" &&
    typeof v.ct === "string"
  );
}

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY env var is not set. Generate one with " +
        '`node -e \'console.log(require("crypto").randomBytes(32).toString("base64"))\'` ' +
        "and set it in the container environment. Required in production.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (got ${key.length}). ` +
        "Generate a fresh one with " +
        '`node -e \'console.log(require("crypto").randomBytes(32).toString("base64"))\'`.',
    );
  }
  cachedKey = key;
  return key;
}

/** Encrypt a UTF-8 string. Throws if ENCRYPTION_KEY is missing/invalid. */
export function encryptString(plaintext: string): EncryptedEnvelope {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv) as CipherGCM;
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: FORMAT_VERSION,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ct.toString("base64"),
  };
}

/** Decrypt an envelope. Throws on auth-tag mismatch or wrong key. */
export function decryptString(envelope: EncryptedEnvelope): string {
  const key = getKey();
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ct = Buffer.from(envelope.ct, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv) as DecipherGCM;
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

/**
 * Encrypt a JSON-serializable object. Returns an envelope.
 * Use this for api_connections.config and similar JSONB columns.
 */
export function encryptJson(value: unknown): EncryptedEnvelope {
  return encryptString(JSON.stringify(value));
}

/**
 * Decrypt + JSON.parse. Throws if the input isn't a valid envelope.
 * Use isEncryptedEnvelope() to detect plaintext legacy values first.
 */
export function decryptJson<T>(envelope: EncryptedEnvelope): T {
  return JSON.parse(decryptString(envelope)) as T;
}

/**
 * Read a config value that may be either plaintext (legacy) or encrypted
 * (post-v0.5). Returns the parsed config object regardless of format.
 *
 * On legacy plaintext: returns the value as-is (no decryption).
 * On encrypted envelope: decrypts and returns the parsed object.
 *
 * The next write should always re-encrypt via encryptJson() so legacy
 * values get upgraded transparently.
 */
export function readMaybeEncrypted<T>(value: unknown): T {
  if (isEncryptedEnvelope(value)) {
    return decryptJson<T>(value);
  }
  return value as T;
}
