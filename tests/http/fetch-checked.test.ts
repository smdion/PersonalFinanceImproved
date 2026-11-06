/**
 * The checked transport (lib/http/external-request.ts): every request's URL
 * is checked before it is sent, redirects are followed only on their own
 * host, a body never reaches a message, and a refused address is never
 * retried. fetch is stubbed, so nothing resolves or connects here
 * (tests/http/connect-check.test.ts covers the connected address).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { inspect } from "node:util";
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

beforeEach(() => {
  mockFetch.mockReset();
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

  it.each([301, 303])(
    "refuses a %i on a POST rather than resend it as a GET",
    async (status) => {
      mockFetch.mockResolvedValueOnce(redirect(status, `${app.base}/v1/moved`));
      await refusal(send(app, "/v1/items", { method: "POST", body: "{}" }));
      expect(mockFetch).toHaveBeenCalledTimes(1);
    },
  );

  it("follows a 303 on a GET", async () => {
    mockFetch
      .mockResolvedValueOnce(redirect(303, `${app.base}/v1/moved`))
      .mockResolvedValueOnce(ok());
    await send(app, "/v1/items");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("follows a 308 on a POST, resending its body", async () => {
    mockFetch
      .mockResolvedValueOnce(redirect(308, `${app.base}/v1/moved`))
      .mockResolvedValueOnce(ok());
    await send(app, "/v1/items", { method: "POST", body: '{"b":2}' });
    const second = mockFetch.mock.calls[1]![1] as RequestInit;
    expect(second.method).toBe("POST");
    expect(second.body).toBe('{"b":2}');
  });

  it("refuses a redirect to another port on the same host", async () => {
    mockFetch.mockResolvedValueOnce(redirect(302, `${app.base}:2375/v1/x`));
    expect((await refusal(send(app, "/v1/items"))).message).toMatch(
      /another port \(".*:2375"\)/,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("follows exactly 3 redirects", async () => {
    for (let i = 0; i < 3; i++)
      mockFetch.mockResolvedValueOnce(redirect(307, `${app.base}/v1/r${i}`));
    mockFetch.mockResolvedValueOnce(ok({ done: true }));
    expect(await send(app, "/v1/items")).toEqual({ done: true });
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("returns a 3xx with no Location as it is, unfollowed", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 302 }));
    const err = await send(app, "/v1/items").then(
      () => null,
      (e: unknown) => e as BudgetApiError,
    );
    expect(err?.code).toBe("unknown");
    expect(err?.status).toBe(302);
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
  it("keeps the port or moves to https's default; any other port is refused", async () => {
    mockFetch
      .mockResolvedValueOnce(redirect(301, "https://actual.example.com:5006/a"))
      .mockResolvedValueOnce(ok());
    await fetchChecked("http://actual.example.com:5006/a", {}, "actual");
    expect(mockFetch.mock.calls[1]![0]).toBe(
      "https://actual.example.com:5006/a",
    );

    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(
      redirect(301, "https://actual.example.com:8443/a"),
    );
    await refusal(
      fetchChecked("http://actual.example.com:5006/a", {}, "actual"),
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

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

  it("is followed for Actual, which keeps its own connections", async () => {
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
  it("is sent with redirect: manual and a dispatcher; Actual gets its own", async () => {
    mockFetch.mockResolvedValue(ok());
    await fetchChecked("https://api.ynab.com/x", {}, "ynab");
    await fetchChecked("https://actual.example.com/x", {}, "actual");
    const inits = mockFetch.mock.calls.map(
      (c) => c[1] as RequestInit & { dispatcher?: unknown },
    );
    expect(inits.map((i) => i.redirect)).toEqual(["manual", "manual"]);
    expect(inits[0]!.dispatcher).toBeDefined();
    expect(inits[1]!.dispatcher).toBeDefined();
    expect(inits[1]!.dispatcher).not.toBe(inits[0]!.dispatcher);
  });

  it.each([
    "http://10.0.0.5:5006/v1",
    "http://127.0.0.1:5006/v1",
    "http://actual-http-api:5007/v1",
    "http://actual.local/v1",
    "http://[fd00::5]:5006/v1",
  ])(
    "sends Actual's private host %s on Actual's own connections",
    async (url) => {
      mockFetch.mockResolvedValue(ok());
      await fetchChecked("https://api.ynab.com/x", {}, "ynab");
      await fetchChecked(url, {}, "actual");
      const [publicOnly, privateOpen] = mockFetch.mock.calls.map(
        (c) => (c[1] as { dispatcher?: unknown }).dispatcher,
      );
      expect(mockFetch.mock.calls[1]![0]).toBe(url);
      expect(privateOpen).toBeDefined();
      expect(privateOpen).not.toBe(publicOnly);
    },
  );

  it("refuses a redirect from Actual's private host to another host, sending nothing there", async () => {
    mockFetch.mockResolvedValueOnce(
      redirect(302, "http://10.0.0.6:5007/v1/budgets"),
    );
    const err = await refusal(
      fetchChecked(
        "http://actual-http-api:5007/v1/budgets",
        { headers: { "x-api-key": "actual-key" } },
        "actual",
      ),
    );
    expect(err.message).toMatch(/another host \("10\.0\.0\.6"\)/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("reaches fetch with the caller's URL spelling unchanged", async () => {
    mockFetch.mockResolvedValueOnce(ok());
    await fetchChecked("https://api.ynab.com", {}, "ynab");
    expect(mockFetch.mock.calls[0]![0]).toBe("https://api.ynab.com");
  });
});

describe("a refused URL", () => {
  it("is never sent or retried, and its sentence names the host", async () => {
    const err = await refusal(
      externalRequest({
        service: "simplefin",
        endpoint: "/accounts",
        url: "https://10.0.0.5/accounts",
        schema: z.unknown(),
      }),
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(err.isRetryable).toBe(false);
    expect(externalErrorSentence(err)).toBe(
      'Ledgr won\'t connect to SimpleFIN: "10.0.0.5" is a private or local address.',
    );
  });

  it("names the credential problem for Actual, whose private hosts are open", async () => {
    const err = await refusal(
      externalRequest({
        service: "actual",
        endpoint: "/v1/budgets",
        url: "http://u:p@actual-http-api:5007/v1/budgets",
        schema: z.unknown(),
      }),
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(err.message).toMatch(/user name or password/);
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

describe("Actual's error body", () => {
  it("is kept for the client to read, but no JSON or inspect of the error shows it", async () => {
    mockFetch.mockResolvedValue(
      new Response('{"error":"No budget file is open SECRET-BODY"}', {
        status: 404,
      }),
    );
    const err = await externalRequest({
      service: "actual",
      endpoint: "/v1/budgets/x/accounts",
      url: "https://actual.example.com/v1/budgets/x/accounts",
      schema: z.unknown(),
      maxAttempts: 1,
    }).then(
      () => null,
      (e: unknown) => e as BudgetApiError,
    );
    expect(err?.responseText).toMatch(/No budget file is open/);
    expect(JSON.stringify(err)).not.toContain("SECRET-BODY");
    expect(inspect(err)).not.toContain("SECRET-BODY");
    expect(Object.keys(err!)).not.toContain("responseText");
  });

  it("isn't kept for another service", async () => {
    mockFetch.mockResolvedValue(new Response("SECRET-BODY", { status: 404 }));
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
    expect(err?.responseText).toBeUndefined();
  });
});
