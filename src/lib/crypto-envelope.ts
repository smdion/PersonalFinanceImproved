// The AES-256-GCM envelope (format in crypto.ts) with its key passed in: the
// app keys it by ENCRYPTION_KEY (crypto.ts), the rotation tool by two keys.
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32; // 256 bits
const IV_BYTES = 12; // GCM standard
const FORMAT_VERSION = 1 as const;
const GENERATE_KEY =
  '`node -e \'console.log(require("crypto").randomBytes(32).toString("base64"))\'`';

export interface EncryptedEnvelope {
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
  const v: Partial<Record<keyof EncryptedEnvelope, unknown>> = value;
  return (
    v.v === FORMAT_VERSION &&
    typeof v.iv === "string" &&
    typeof v.tag === "string" &&
    typeof v.ct === "string"
  );
}

/** The key a base64 variable holds; throws, naming the variable, unless it is 32 bytes. */
export function parseEncryptionKey(
  raw: string | undefined,
  variable = "ENCRYPTION_KEY",
): Buffer {
  if (!raw) {
    throw new Error(
      `${variable} env var is not set. Generate one with ${GENERATE_KEY} ` +
        "and set it in the container environment. Required in production.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `${variable} must decode to exactly ${KEY_BYTES} bytes (got ${key.length}). ` +
        `Generate a fresh one with ${GENERATE_KEY}.`,
    );
  }
  return key;
}

/** Encrypt a UTF-8 string under `key`. */
export function encryptStringWithKey(
  key: Buffer,
  plaintext: string,
): EncryptedEnvelope {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: FORMAT_VERSION,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ct.toString("base64"),
  };
}

/** Decrypt an envelope under `key`. Throws on auth-tag mismatch or wrong key. */
export function decryptStringWithKey(
  key: Buffer,
  envelope: EncryptedEnvelope,
): string {
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ct = Buffer.from(envelope.ct, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
