/**
 * Invented stored credentials for the credentials tag's tests: one
 * api_connections row per stored form a config can hold, and stored-version
 * copies of them. `reads` is what the app reads from the row after the tag
 * (decrypted); every row reads as it read before, except a config held as
 * text, which read as that text (a broken connection) and now reads as the
 * value the text holds.
 */
import { randomBytes } from "node:crypto";
import { expect } from "vitest";
import {
  decryptStringWithKey,
  encryptStringWithKey,
  isEncryptedEnvelope,
} from "@/lib/crypto-envelope";

/** The install's key: a test sets ENCRYPTION_KEY to KEY_TEXT. */
export const KEY = randomBytes(32);
export const KEY_TEXT = KEY.toString("base64");

const sealed = (value: unknown) => ({
  ...encryptStringWithKey(KEY, JSON.stringify(value)),
});

const HELD = { accessToken: "invented-held-token", budgetId: "invented-b" };
const HELD_ENVELOPE = sealed(HELD);
const WRAPPED = { apiKey: "invented-wrapped-key" };
const WRAPPED_ENVELOPE = sealed(WRAPPED);
const TEXT_OBJECT = { contactEmail: "invented@example.invalid" };

export type ConnectionCase = {
  readonly id: number;
  readonly service: string;
  /** The JSON value the column holds. */
  readonly stored: unknown;
  readonly after: "kept" | "unwrapped" | "encrypted";
  /** What the app reads after the tag. */
  readonly reads: unknown;
};

export const CONNECTIONS: readonly ConnectionCase[] = [
  {
    id: 1,
    service: "ynab",
    stored: { accessToken: "invented-token", budgetId: "invented-budget" },
    after: "encrypted",
    reads: { accessToken: "invented-token", budgetId: "invented-budget" },
  },
  {
    id: 2,
    service: "actual",
    stored: HELD_ENVELOPE,
    after: "kept",
    reads: HELD,
  },
  {
    id: 3,
    service: "tiingo",
    stored: JSON.stringify(WRAPPED_ENVELOPE),
    after: "unwrapped",
    reads: WRAPPED,
  },
  {
    id: 4,
    service: "sec",
    stored: JSON.stringify(TEXT_OBJECT),
    after: "encrypted",
    reads: TEXT_OBJECT,
  },
  {
    id: 5,
    service: "fmp",
    stored: { apiKey: "invented-fmp-key" },
    after: "encrypted",
    reads: { apiKey: "invented-fmp-key" },
  },
  {
    id: 6,
    service: "invented-list",
    stored: [1, "invented-two"],
    after: "encrypted",
    reads: [1, "invented-two"],
  },
  {
    id: 7,
    service: "invented-text",
    stored: "invented text, not JSON {",
    after: "encrypted",
    reads: "invented text, not JSON {",
  },
  {
    id: 8,
    service: "invented-null",
    stored: null,
    after: "encrypted",
    reads: null,
  },
];

/** Every invented secret: none may appear in a note or a refusal. */
export const SECRETS = [
  "invented-token",
  "invented-held-token",
  "invented-wrapped-key",
  "invented@example.invalid",
  "invented-fmp-key",
  "invented-two",
  "invented text",
  "invented-copy-key",
];

const COPY = { apiKey: "invented-copy-key" };

/** A stored version's api_connections copies (and another table's rows,
 *  left alone), each config in the form the version holds it. */
export const VERSION_COPIES = {
  /** PostgreSQL's form: the config as a value. */
  plaintextValue: { id: 11, service: "ynab", config: COPY },
  envelopeValue: { id: 12, service: "actual", config: HELD_ENVELOPE },
  /** SQLite's form: the config as its JSON text. */
  plaintextText: { id: 13, service: "sec", config: JSON.stringify(COPY) },
  envelopeText: {
    id: 14,
    service: "tiingo",
    config: JSON.stringify(HELD_ENVELOPE),
  },
};
export const OTHER_TABLE_ROWS = [{ id: 1, name: "Invented", config: COPY }];

/** What the app reads from a config after the tag: the envelope decrypted. */
export function readAfter(config: unknown): unknown {
  expect(isEncryptedEnvelope(config)).toBe(true);
  if (!isEncryptedEnvelope(config)) return undefined;
  const value: unknown = JSON.parse(decryptStringWithKey(KEY, config));
  return value;
}

/** Each case's config after the tag, checked against its case: an
 *  envelope that reads `reads`; a kept one byte-identical; an unwrapped one
 *  the very envelope its text held (never encrypted again). */
export function expectConverted(configs: ReadonlyMap<number, unknown>) {
  for (const c of CONNECTIONS) {
    const config = configs.get(c.id);
    expect(readAfter(config), c.service).toEqual(c.reads);
    if (c.after === "kept") expect(config).toEqual(c.stored);
    if (c.after === "unwrapped")
      expect(config).toEqual(JSON.parse(c.stored as string));
  }
}

/** The version copies after the tag: plaintext encrypted in its own form
 *  (text stays text), envelopes untouched. */
export function expectCopiesConverted(copies: readonly unknown[]) {
  const byId = new Map(
    copies.map((c) => [(c as { id: number }).id, c as { config: unknown }]),
  );
  const v = VERSION_COPIES;
  expect(readAfter(byId.get(v.plaintextValue.id)?.config)).toEqual(COPY);
  const text = byId.get(v.plaintextText.id)?.config;
  expect(typeof text).toBe("string");
  expect(readAfter(JSON.parse(text as string))).toEqual(COPY);
  expect(byId.get(v.envelopeValue.id)).toEqual(v.envelopeValue);
  expect(byId.get(v.envelopeText.id)).toEqual(v.envelopeText);
}
