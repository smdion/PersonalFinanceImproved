/**
 * Tests for src/lib/crypto.ts — AES-256-GCM at-rest encryption.
 *
 * These tests use a deterministic ENCRYPTION_KEY set in beforeAll/afterAll
 * so they don't pollute the rest of the suite.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import {
  encryptString,
  decryptString,
  encryptJson,
  decryptJson,
  isEncryptedEnvelope,
  readMaybeEncrypted,
} from "@/lib/crypto";

const TEST_KEY = randomBytes(32).toString("base64");
let originalKey: string | undefined;

beforeAll(() => {
  originalKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = TEST_KEY;
  // Force the module-level cached key to refresh on next call by re-importing.
  // The cache is per-process, so the first call after this line picks up TEST_KEY.
});

afterAll(() => {
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalKey;
});

describe("encryptString / decryptString", () => {
  it("round-trips a UTF-8 string", () => {
    const plain = "hunter2-with-special-chars-éñ漢";
    const env = encryptString(plain);
    expect(decryptString(env)).toBe(plain);
  });

  it("produces a different ciphertext each call (random IV)", () => {
    const plain = "same input";
    const a = encryptString(plain);
    const b = encryptString(plain);
    expect(a.ct).not.toBe(b.ct);
    expect(a.iv).not.toBe(b.iv);
    // Both still decrypt to the same plaintext.
    expect(decryptString(a)).toBe(plain);
    expect(decryptString(b)).toBe(plain);
  });

  it("envelope has the expected shape", () => {
    const env = encryptString("x");
    expect(env.v).toBe(1);
    expect(typeof env.iv).toBe("string");
    expect(typeof env.tag).toBe("string");
    expect(typeof env.ct).toBe("string");
  });

  it("decrypt throws on tampered ciphertext", () => {
    const env = encryptString("important secret");
    // Flip a byte in the ciphertext.
    const tamperedCt = Buffer.from(env.ct, "base64");
    tamperedCt[0] = tamperedCt[0]! ^ 0xff;
    expect(() =>
      decryptString({ ...env, ct: tamperedCt.toString("base64") }),
    ).toThrow();
  });

  it("decrypt throws on tampered auth tag", () => {
    const env = encryptString("important secret");
    const tamperedTag = Buffer.from(env.tag, "base64");
    tamperedTag[0] = tamperedTag[0]! ^ 0xff;
    expect(() =>
      decryptString({ ...env, tag: tamperedTag.toString("base64") }),
    ).toThrow();
  });
});

describe("encryptJson / decryptJson", () => {
  it("round-trips an object", () => {
    const config = {
      accessToken: "ynab-tok-abc123",
      budgetId: "deadbeef-1111-2222-3333-444455556666",
    };
    const env = encryptJson(config);
    expect(decryptJson<typeof config>(env)).toEqual(config);
  });

  it("round-trips nested objects + arrays", () => {
    const value = {
      nested: { a: 1, b: [1, 2, 3] },
      list: [{ x: "y" }, { x: "z" }],
    };
    const env = encryptJson(value);
    expect(decryptJson<typeof value>(env)).toEqual(value);
  });
});

describe("isEncryptedEnvelope", () => {
  it("recognizes a valid envelope", () => {
    const env = encryptString("test");
    expect(isEncryptedEnvelope(env)).toBe(true);
  });

  it("rejects plaintext objects (legacy api_connections.config)", () => {
    expect(
      isEncryptedEnvelope({
        accessToken: "plain-token",
        budgetId: "plain-id",
      }),
    ).toBe(false);
  });

  it("rejects partial envelopes (missing v)", () => {
    expect(isEncryptedEnvelope({ iv: "x", tag: "y", ct: "z" })).toBe(false);
  });

  it("rejects null and primitives", () => {
    expect(isEncryptedEnvelope(null)).toBe(false);
    expect(isEncryptedEnvelope(undefined)).toBe(false);
    expect(isEncryptedEnvelope("string")).toBe(false);
    expect(isEncryptedEnvelope(42)).toBe(false);
  });

  it("rejects envelope with wrong version", () => {
    expect(isEncryptedEnvelope({ v: 99, iv: "x", tag: "y", ct: "z" })).toBe(
      false,
    );
  });
});

describe("readMaybeEncrypted (legacy compatibility)", () => {
  it("decrypts an envelope", () => {
    const config = { accessToken: "encrypted-tok", budgetId: "abc" };
    const env = encryptJson(config);
    expect(readMaybeEncrypted<typeof config>(env)).toEqual(config);
  });

  it("returns plaintext as-is (legacy v4 api_connections.config)", () => {
    const legacy = { accessToken: "plain-tok", budgetId: "abc" };
    expect(readMaybeEncrypted<typeof legacy>(legacy)).toEqual(legacy);
  });

  it("preserves null/undefined", () => {
    expect(readMaybeEncrypted(null)).toBeNull();
    expect(readMaybeEncrypted(undefined)).toBeUndefined();
  });
});
