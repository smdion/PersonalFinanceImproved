/**
 * What a user is told when a service fails: each error names its service
 * (and a bad response its field), and the sentence for it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod/v4";
import {
  BudgetApiError,
  WriteStopped,
  externalErrorSentence,
  nothingChanged,
  retold,
  userMessageFor,
} from "@/lib/budget-api/errors";
import { externalRequest } from "@/lib/http/external-request";

function failure(code: ConstructorParameters<typeof BudgetApiError>[1]) {
  const e = new BudgetApiError("raw", code, null);
  e.service = "YNAB";
  return e;
}

describe("externalErrorSentence", () => {
  it.each([
    [
      "auth",
      "YNAB didn't accept Ledgr's credentials — reconnect it in Settings.",
    ],
    [
      "rate-limit",
      "YNAB asked Ledgr to slow down — try again in a few minutes.",
    ],
    ["client", "YNAB refused Ledgr's request."],
    ["timeout", "Ledgr couldn't reach YNAB — try again."],
    ["network", "Ledgr couldn't reach YNAB — try again."],
    ["server", "YNAB didn't answer properly — try again."],
    ["conflict", "YNAB has a setting Ledgr won't overwrite."],
  ] as const)("%s", (code, sentence) => {
    expect(externalErrorSentence(failure(code))).toBe(sentence);
  });

  it("names the field of a bad response", () => {
    const e = failure("bad-response");
    e.field = "data.month.income";
    expect(externalErrorSentence(e)).toBe(
      "YNAB sent something Ledgr doesn't understand (data.month.income).",
    );
  });
});

describe("retold", () => {
  it("keeps the code, the service and the field", () => {
    const e = failure("bad-response");
    e.field = "data.0.amount";
    expect(retold(e, "new message")).toMatchObject({
      message: "new message",
      code: "bad-response",
      service: "YNAB",
      field: "data.0.amount",
    });
  });
});

describe("userMessageFor", () => {
  it("a service failure alone claims nothing about what changed", () => {
    expect(
      userMessageFor(new Error("wrap", { cause: failure("timeout") })),
    ).toBe("Ledgr couldn't reach YNAB — try again.");
  });

  it("a site that wrote nothing yet says so", () => {
    expect(userMessageFor(nothingChanged(failure("timeout")))).toBe(
      "Ledgr couldn't reach YNAB — try again. Nothing was changed.",
    );
  });

  it("a write stopped partway says what landed", () => {
    expect(
      userMessageFor(new WriteStopped("x", "Pushed 1 of 2.", failure("auth"))),
    ).toBe(
      "YNAB didn't accept Ledgr's credentials — reconnect it in Settings. Pushed 1 of 2.",
    );
    expect(userMessageFor(new WriteStopped("x", "Deleted 2."))).toBe(
      "Something went wrong. Deleted 2.",
    );
  });

  it("no service and no stopped write: nothing to say", () => {
    expect(userMessageFor(new Error("db down"))).toBeNull();
  });
});

describe("externalRequest names the service on every failure", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a refused request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        headers: new Headers(),
        text: async () => "",
      })),
    );
    await expect(
      externalRequest({
        service: "actual",
        endpoint: "/accounts",
        url: "http://actual.local/accounts",
        schema: z.unknown(),
      }),
    ).rejects.toMatchObject({ code: "auth", service: "Actual" });
  });

  it("a response that doesn't fit, with its field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: "1" }),
      })),
    );
    await expect(
      externalRequest({
        service: "tiingo",
        endpoint: "/x",
        url: "http://t.local/x",
        schema: z.object({ data: z.number() }),
      }),
    ).rejects.toMatchObject({
      code: "bad-response",
      service: "Tiingo",
      field: "data",
    });
  });
});
