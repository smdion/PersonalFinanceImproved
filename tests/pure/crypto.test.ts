/**
 * Tests for src/lib/crypto.ts — AES-256-GCM at-rest encryption.
 *
 * These tests use a deterministic ENCRYPTION_KEY set in beforeAll/afterAll
 * so they don't pollute the rest of the suite.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { z } from "zod/v4";
import {
  encryptString,
  decryptString,
  encryptJson,
  decryptJson,
} from "@/lib/crypto";
import { isEncryptedEnvelope } from "@/lib/crypto-envelope";

const anything = z.unknown();
const tokenConfig = z.object({ accessToken: z.string(), budgetId: z.string() });

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
    expect(decryptJson(env, "test_config", anything)).toEqual(config);
  });

  it("round-trips nested objects + arrays", () => {
    const value = {
      nested: { a: 1, b: [1, 2, 3] },
      list: [{ x: "y" }, { x: "z" }],
    };
    const env = encryptJson(value);
    expect(decryptJson(env, "test_value", anything)).toEqual(value);
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

describe("decryptJson reads only an envelope", () => {
  it("decrypts an envelope", () => {
    const config = { accessToken: "encrypted-tok", budgetId: "abc" };
    const env = encryptJson(config);
    expect(decryptJson(env, "test_config", anything)).toEqual(config);
  });

  it("throws on anything else, naming the source and never the value", () => {
    const plain = { accessToken: "plain-tok", budgetId: "abc" };
    for (const stored of [plain, null, undefined, JSON.stringify(plain)]) {
      expect(() => decryptJson(stored, "test_plain", anything)).toThrow(
        /^test_plain is not an encrypted envelope/,
      );
      try {
        decryptJson(stored, "test_plain", anything);
      } catch (e) {
        expect(String(e)).not.toContain("plain-tok");
      }
    }
  });
});

describe("decryptJson checks the config against its shape", () => {
  it("reads a refused config as stored and warns once", () => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const partial = { accessToken: "tok" };
      expect(
        decryptJson(encryptJson(partial), "test_partial", tokenConfig),
      ).toEqual(partial);
      expect(
        decryptJson(encryptJson(partial), "test_partial", tokenConfig),
      ).toEqual(partial);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(logged.mock.calls[0]?.[0]))).toMatchObject({
        event: "stored_value_unexpected_shape",
        source: "test_partial",
        issues: [
          "budgetId: Invalid input: expected string, received undefined",
        ],
      });
    } finally {
      logged.mockRestore();
    }
  });
});
