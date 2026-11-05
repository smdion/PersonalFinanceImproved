/**
 * The checked transport (lib/http/external-request.ts): every request's URL
 * is checked before it is sent, redirects are followed only on their own
 * host, a body never reaches a message, and a refused address is never
 * retried. fetch is stubbed, so nothing resolves or connects here
 * (tests/http/connect-check.test.ts covers the connected address).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod/v4";
import {
  externalRequest,
  fetchChecked,
  type ExternalService,
} from "@/lib/http/external-request";
import { BudgetApiError, externalErrorSentence } from "@/lib/budget-api/errors";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const redirect = (status: number, location: string) =>
  new Response(null, { status, headers: { location } });
const ok = (body: unknown = { ok: true }) =>
  new Response(JSON.stringify(body), { status: 200 });

let originalAllowlist: string | undefined;
beforeEach(() => {
  mockFetch.mockReset();
  originalAllowlist = process.env.ALLOWED_ACTUAL_HOSTS;
  delete process.env.ALLOWED_ACTUAL_HOSTS;
});
afterEach(() => {
  if (originalAllowlist === undefined) delete process.env.ALLOWED_ACTUAL_HOSTS;
  else process.env.ALLOWED_ACTUAL_HOSTS = originalAllowlist;
});

async function refusal(p: Promise<unknown>): Promise<BudgetApiError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BudgetApiError);
  expect((err as BudgetApiError).code).toBe("refused-url");
  return err as BudgetApiError;
}

/** Both budget apps, each with the header that carries its credential. */
const APPS: {
  service: ExternalService;
  base: string;
  auth: Record<string, string>;
}[] = [
  {
    service: "actual",
    base: "https://actual.example.com",
    auth: { "x-api-key": "actual-key" },
  },
  {
    service: "ynab",
    base: "https://api.ynab.com",
    auth: { Authorization: "Bearer ynab-token" },
  },
];

const send = (app: (typeof APPS)[number], path: string, init?: RequestInit) =>
  externalRequest({
    service: app.service,
    endpoint: path,
    url: `${app.base}${path}`,
    schema: z.unknown(),
    headers: app.auth,
    init,
  });

const headerOf = (call: number, name: string) =>
  new Headers((mockFetch.mock.calls[call]![1] as RequestInit).headers).get(
    name,
  );

describe.each(APPS)("redirects for $service", (app) => {
  const [authName, authValue] = Object.entries(app.auth)[0]!;

  it("follows a same-origin 307, resending the method, body and credential", async () => {
    mockFetch
      .mockResolvedValueOnce(redirect(307, `${app.base}/v1/moved`))
      .mockResolvedValueOnce(ok());
    await send(app, "/v1/items", { method: "POST", body: '{"a":1}' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1]![0]).toBe(`${app.base}/v1/moved`);
    const second = mockFetch.mock.calls[1]![1] as RequestInit;
    expect(second.method).toBe("POST");
    expect(second.body).toBe('{"a":1}');
    expect(headerOf(1, authName)).toBe(authValue);
  });

  it("refuses a cross-host 302 without sending anything there", async () => {
    mockFetch.mockResolvedValueOnce(
      redirect(302, "https://sso.example.net/login"),
    );
    const err = await refusal(send(app, "/v1/items"));
    expect(err.message).toContain('"sso.example.net"');
    expect(err.message).not.toContain("/login");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("refuses https to http on the same host", async () => {
    mockFetch.mockResolvedValueOnce(
      redirect(301, app.base.replace("https:", "http:") + "/v1/items"),
    );
    expect((await refusal(send(app, "/v1/items"))).message).toMatch(
      /https to http/,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each(["//[::ffff:7f00:1]/x", "http://169.254.169.254/latest"])(
    "resolves Location %s against the current URL and refuses it",
    async (location) => {
      mockFetch.mockResolvedValueOnce(redirect(302, location));
      await refusal(send(app, "/v1/items"));
      expect(mockFetch).toHaveBeenCalledTimes(1);
    },
  );

  it("follows a relative Location on the same origin", async () => {
    mockFetch
      .mockResolvedValueOnce(redirect(302, "/v1/elsewhere?x=1"))
      .mockResolvedValueOnce(ok());
    await send(app, "/v1/items");
    expect(mockFetch.mock.calls[1]![0]).toBe(`${app.base}/v1/elsewhere?x=1`);
  });

  it("refuses a 302 on a POST rather than resend it as a GET", async () => {
    mockFetch.mockResolvedValueOnce(redirect(302, `${app.base}/v1/moved`));
    const err = await refusal(
      send(app, "/v1/items", { method: "POST", body: "{}" }),
    );
    expect(err.message).toMatch(/POST with 302/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("refuses a fourth redirect", async () => {
    for (let i = 0; i < 4; i++)
      mockFetch.mockResolvedValueOnce(redirect(307, `${app.base}/v1/r${i}`));
    expect((await refusal(send(app, "/v1/items"))).message).toMatch(
      /more than 3 times/,
    );
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});

describe("http to https on the same host", () => {
  it("is followed for Actual", async () => {
    mockFetch
      .mockResolvedValueOnce(
        redirect(301, "https://actual.example.com/v1/budgets"),
      )
      .mockResolvedValueOnce(ok());
    await fetchChecked("http://actual.example.com/v1/budgets", {}, "actual");
    expect(mockFetch.mock.calls[1]![0]).toBe(
      "https://actual.example.com/v1/budgets",
    );
  });

  it("is followed for an allowlisted host, which keeps its own connections", async () => {
    process.env.ALLOWED_ACTUAL_HOSTS = "actual.example.com";
    mockFetch
      .mockResolvedValueOnce(
        redirect(308, "https://actual.example.com:443/v1/budgets"),
      )
      .mockResolvedValueOnce(ok());
    await fetchChecked("http://actual.example.com/v1/budgets", {}, "actual");
    const [first, second] = mockFetch.mock.calls.map(
      (c) => (c[1] as { dispatcher?: unknown }).dispatcher,
    );
    expect(first).toBeDefined();
    expect(second).toBe(first);
  });
});

describe("every request", () => {
  it("is sent with redirect: manual and a dispatcher; an allowlisted host gets its own", async () => {
    mockFetch.mockResolvedValue(ok());
    await fetchChecked("https://actual.example.com/x", {}, "actual");
    process.env.ALLOWED_ACTUAL_HOSTS = "actual.example.com";
    await fetchChecked("https://actual.example.com/x", {}, "actual");
    const inits = mockFetch.mock.calls.map(
      (c) => c[1] as RequestInit & { dispatcher?: unknown },
    );
    expect(inits.map((i) => i.redirect)).toEqual(["manual", "manual"]);
    expect(inits[0]!.dispatcher).toBeDefined();
    expect(inits[1]!.dispatcher).toBeDefined();
    expect(inits[1]!.dispatcher).not.toBe(inits[0]!.dispatcher);
  });

  it("reaches fetch with the caller's URL spelling unchanged", async () => {
    mockFetch.mockResolvedValueOnce(ok());
    await fetchChecked("https://api.ynab.com", {}, "ynab");
    expect(mockFetch.mock.calls[0]![0]).toBe("https://api.ynab.com");
  });
});

describe("a refused URL", () => {
  it("is never sent or retried, and its sentence names the allowlist for Actual", async () => {
    const err = await refusal(
      externalRequest({
        service: "actual",
        endpoint: "/v1/budgets",
        url: "http://actual-http-api:5007/v1/budgets",
        schema: z.unknown(),
      }),
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(err.isRetryable).toBe(false);
    expect(externalErrorSentence(err)).toBe(
      'Ledgr won\'t connect to Actual: "actual-http-api" is a single-label host (a local or Docker name). Add the host to ALLOWED_ACTUAL_HOSTS to allow it.',
    );
  });

  it("names no allowlist for another service", async () => {
    const err = await refusal(
      externalRequest({
        service: "simplefin",
        endpoint: "/accounts",
        url: "https://10.0.0.5/accounts",
        schema: z.unknown(),
      }),
    );
    expect(externalErrorSentence(err)).not.toMatch(/ALLOWED_ACTUAL_HOSTS/);
  });

  it("passes the sync fixtures, which nothing resolves under a stubbed fetch", async () => {
    mockFetch.mockResolvedValue(ok());
    await fetchChecked("http://actual.local/v1/budgets", {}, "actual");
    await fetchChecked("https://actual.baseline.example/v1", {}, "actual");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("an error answer", () => {
  it.each([401, 400, 502])(
    "%i: no body text in the message",
    async (status) => {
      mockFetch.mockResolvedValue(
        new Response("SECRET-BODY echoing the request", { status }),
      );
      const err = await externalRequest({
        service: "ynab",
        endpoint: "/budgets",
        url: "https://api.ynab.com/v1/budgets",
        schema: z.unknown(),
        maxAttempts: 1,
      }).then(
        () => null,
        (e: unknown) => e as BudgetApiError,
      );
      expect(err?.status).toBe(status);
      expect(err?.message).not.toContain("SECRET-BODY");
    },
  );
});
