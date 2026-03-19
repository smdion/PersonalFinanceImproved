/**
 * Password hashing and verification using Node.js built-in crypto.
 *
 * Uses scrypt (memory-hard KDF) with a random 32-byte salt.
 * Storage format: "salt:hash" (both hex-encoded, 64-byte derived key).
 *
 * No external dependencies — uses only `node:crypto`.
 */

import { scrypt, randomBytes, timingSafeEqual } from "crypto";

const SALT_LENGTH = 32;
const KEY_LENGTH = 64;

/** Hash a plaintext password. Returns "salt:hash" string for DB storage. */
export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(SALT_LENGTH);
    scrypt(password, salt, KEY_LENGTH, (err, derived) => {
      if (err) return reject(err);
      resolve(`${salt.toString("hex")}:${derived.toString("hex")}`);
    });
  });
}

/** Verify a plaintext password against a stored "salt:hash" string. */
export function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [saltHex, hashHex] = storedHash.split(":");
    if (!saltHex || !hashHex) return resolve(false);

    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");

    scrypt(password, salt, KEY_LENGTH, (err, derived) => {
      if (err) return reject(err);
      resolve(timingSafeEqual(derived, expected));
    });
  });
}
