/**
 * Credentials never reach the change log: logMutation (server/trpc.ts)
 * logs a mutation's input through redactSecrets.
 */
import { describe, it, expect } from "vitest";
import {
  REDACTED,
  SECRET_INPUT_KEYS,
  redactSecrets,
} from "@/lib/utils/redact-secrets";

describe("redactSecrets", () => {
  it("replaces each service's credential, keeping what the audit trail needs", () => {
    expect(
      redactSecrets({
        service: "actual",
        serverUrl: "https://budget.example",
        apiKey: "k",
        budgetSyncId: "b",
      }),
    ).toEqual({
      service: "actual",
      serverUrl: "https://budget.example",
      apiKey: REDACTED,
      budgetSyncId: "b",
    });
    expect(redactSecrets({ service: "ynab", accessToken: "t" })).toEqual({
      service: "ynab",
      accessToken: REDACTED,
    });
    expect(redactSecrets({ setupToken: "s" })).toEqual({
      setupToken: REDACTED,
    });
  });

  it("at any depth, in arrays too; a whole config object goes", () => {
    expect(
      redactSecrets({
        id: 3,
        config: { token: "t", url: "u" },
        items: [{ password: "p", name: "n" }],
      }),
    ).toEqual({
      id: 3,
      config: REDACTED,
      items: [{ password: REDACTED, name: "n" }],
    });
  });

  it("leaves everything else, primitives and null alone", () => {
    expect(redactSecrets({ id: 1, amount: 5, note: null })).toEqual({
      id: 1,
      amount: 5,
      note: null,
    });
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets("x")).toBe("x");
  });

  it("the keys the scrub migration covers are the same list", () => {
    // drizzle/0007 and drizzle-sqlite/0007 scrub these keys from rows logged
    // before v0.9.5 — keep them in step with SECRET_INPUT_KEYS.
    expect(SECRET_INPUT_KEYS).toContain("accessToken");
    expect(SECRET_INPUT_KEYS).toContain("apiKey");
    expect(SECRET_INPUT_KEYS).toContain("setupToken");
  });
});
