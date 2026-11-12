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

  it("keeps what the service said, still out of the message and JSON", () => {
    const e = failure("bad-response");
    e.keepResponseText('{"error":"budget not found"}');
    const told = retold(e, "new message");
    expect(told.responseText).toBe('{"error":"budget not found"}');
    expect(JSON.stringify(told)).not.toContain("budget not found");
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
        url: "https://t.example.com/x",
        schema: z.object({ data: z.number() }),
      }),
    ).rejects.toMatchObject({
      code: "bad-response",
      service: "Tiingo",
      field: "data",
    });
  });
});

describe("externalRequest reports each request it sends", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Answers in turn; reading a body after the request was aborted fails,
   *  as it does on a real fetch. */
  function answering(...statuses: number[]) {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const status = statuses.shift()!;
      return {
        ok: status < 400,
        status,
        headers: new Headers(),
        text: async () => {
          if (init?.signal?.aborted)
            throw new DOMException("aborted", "AbortError");
          return status < 400 ? "{}" : "busy";
        },
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("once per attempt, retries included", async () => {
    vi.useFakeTimers();
    answering(503, 200);
    const attempts: Array<[number | null, string | null]> = [];
    const pending = externalRequest({
      service: "simplefin",
      endpoint: "/accounts",
      url: "https://sf.example.com/accounts",
      schema: z.unknown(),
      onAttempt: async ({ status, error }) => {
        attempts.push([status, error?.code ?? null]);
      },
    });
    await vi.runAllTimersAsync();
    await pending;
    expect(attempts).toEqual([
      [503, "server"],
      [200, null],
    ]);
  });

  it("a 200 that isn't JSON is reported as bad-response, with its status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => "<html>sign in</html>",
      })),
    );
    const attempts: Array<[number | null, string | null]> = [];
    await expect(
      externalRequest({
        service: "simplefin",
        endpoint: "/accounts",
        url: "https://sf.example.com/accounts",
        schema: z.unknown(),
        onAttempt: async ({ status, error }) => {
          attempts.push([status, error?.code ?? null]);
        },
      }),
    ).rejects.toMatchObject({ code: "bad-response" });
    expect(attempts).toEqual([[200, "bad-response"]]);
  });

  it("a slow report can't time the request out and send it again", async () => {
    vi.useFakeTimers();
    const fetchMock = answering(200, 200);
    const pending = externalRequest({
      service: "simplefin",
      endpoint: "/accounts",
      url: "https://sf.example.com/accounts",
      schema: z.unknown(),
      timeoutMs: 1_000,
      onAttempt: () => new Promise((r) => setTimeout(r, 5_000)),
    });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a failing report is not a failed request: nothing is sent again", async () => {
    const fetchMock = answering(200);
    await expect(
      externalRequest({
        service: "simplefin",
        endpoint: "/accounts",
        url: "https://sf.example.com/accounts",
        schema: z.unknown(),
        onAttempt: async () => {
          throw new Error("log write failed");
        },
      }),
    ).resolves.toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
