/**
 * The address check at connect time: the lookups the transport's
 * dispatchers use (with an injected resolver), then real requests through
 * the global fetch to a server on 127.0.0.1, with node:dns answering for
 * example.com names. Nothing leaves the machine.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { LookupAddress } from "node:dns";
import {
  BlockedAddressError,
  guardedLookup,
  plainLookup,
} from "@/lib/http/url-safety";
import { externalRequest, fetchChecked } from "@/lib/http/external-request";
import { z } from "zod/v4";
import { BudgetApiError } from "@/lib/budget-api/errors";

const ANSWERS: Record<string, LookupAddress[]> = {
  "private.example.com": [{ address: "10.0.0.5", family: 4 }],
  "mixed.example.com": [
    { address: "93.184.215.14", family: 4 },
    { address: "10.0.0.5", family: 4 },
  ],
  "mapped.example.com": [{ address: "::ffff:7f00:1", family: 6 }],
  "public.example.com": [{ address: "93.184.215.14", family: 4 }],
  // The one private address a test can listen on stands in for a LAN one.
  "lan.example.com": [{ address: "127.0.0.1", family: 4 }],
  "actual-http-api": [{ address: "127.0.0.1", family: 4 }],
  "actual.local": [{ address: "127.0.0.1", family: 4 }],
  "empty.example.com": [],
};

vi.mock("node:dns", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:dns")>();
  const lookup = (
    hostname: string,
    options: { all?: boolean },
    callback: (...args: unknown[]) => void,
  ) => {
    const answer = ANSWERS[hostname];
    if (!answer) {
      callback(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }));
      return;
    }
    if (options.all) callback(null, answer);
    else callback(null, answer[0]!.address, answer[0]!.family);
  };
  return { ...real, default: { ...real, lookup }, lookup };
});

type Answer = { err: Error | null; address: unknown; family?: number };

function ask(
  lookup: ReturnType<typeof guardedLookup>,
  hostname: string,
  all: boolean,
): Promise<Answer> {
  return new Promise((resolve) =>
    lookup(hostname, { all }, (err, address, family) =>
      resolve({ err, address, family }),
    ),
  );
}

const fakeResolve = (addresses: LookupAddress[]) =>
  vi.fn(
    (
      _h: string,
      _o: unknown,
      cb: (e: NodeJS.ErrnoException | null, a: LookupAddress[]) => void,
    ) => cb(null, addresses),
  );

describe("guardedLookup", () => {
  it.each([
    [[{ address: "10.0.0.5", family: 4 }]],
    [
      [
        { address: "93.184.215.14", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ],
    ],
    [[{ address: "::ffff:7f00:1", family: 6 }]],
    [[{ address: "fd00::5", family: 6 }]],
  ])("refuses a name when any address is blocked: %j", async (addresses) => {
    const r = await ask(
      guardedLookup(fakeResolve(addresses)),
      "x.example.com",
      true,
    );
    expect(r.err).toBeInstanceOf(BlockedAddressError);
    expect(r.err?.message).toBe(
      '"x.example.com" resolves to a private or local address.',
    );
  });

  it("answers a public name in both shapes net asks for", async () => {
    const addresses = [{ address: "93.184.215.14", family: 4 }];
    const resolve = fakeResolve(addresses);
    expect(await ask(guardedLookup(resolve), "x.example.com", true)).toEqual({
      err: null,
      address: addresses,
      family: undefined,
    });
    expect(await ask(guardedLookup(resolve), "x.example.com", false)).toEqual({
      err: null,
      address: "93.184.215.14",
      family: 4,
    });
    // Always resolves every address, so none can hide behind the first.
    expect(
      resolve.mock.calls.every((c) => (c[1] as { all: boolean }).all),
    ).toBe(true);
  });

  it("passes a resolver error through", async () => {
    const failing = vi.fn(
      (
        _h: string,
        _o: unknown,
        cb: (e: NodeJS.ErrnoException | null, a: LookupAddress[]) => void,
      ) => cb(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }), []),
    );
    const r = await ask(guardedLookup(failing), "nowhere.example.com", false);
    expect(r.err?.message).toBe("ENOTFOUND");
  });
});

describe("plainLookup (Actual, open to private hosts)", () => {
  it("answers a private address", async () => {
    const r = await ask(
      plainLookup(fakeResolve([{ address: "10.0.0.5", family: 4 }])),
      "actual.example.com",
      false,
    );
    expect(r).toEqual({ err: null, address: "10.0.0.5", family: 4 });
  });
});

describe("the real fetch, through the transport's dispatchers", () => {
  let server: Server;
  let port: number;
  let connections = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/start") {
        res.writeHead(302, { location: "/done" }).end();
        return;
      }
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });
    server.on("connection", () => connections++);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  /** A public-only service: the lookup refuses before any TCP connect, so
   *  https needs no TLS server here. */
  const refusedBefore = async (url: string) => {
    const before = connections;
    const err = await fetchChecked(url, {}, "tiingo").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BudgetApiError);
    expect((err as BudgetApiError).code).toBe("refused-url");
    expect(connections).toBe(before);
    return err as Error;
  };

  it.each(["lan", "private", "mixed", "mapped"])(
    "refuses %s.example.com for a public-only service before connecting",
    async (name) => {
      const err = await refusedBefore(`https://${name}.example.com:${port}/`);
      expect(err.message).toMatch(/resolves to a private or local address/);
    },
  );

  it("an IP literal is refused by the URL check, never reaching connect", async () => {
    await refusedBefore(`https://127.0.0.1:${port}/`);
  });

  it.each(["lan.example.com", "127.0.0.1", "actual-http-api", "actual.local"])(
    "connects Actual to %s, a private host",
    async (host) => {
      const res = await fetchChecked(`http://${host}:${port}/`, {}, "actual");
      expect(await res.json()).toEqual({ ok: true, path: "/" });
    },
  );

  it("follows a same-origin redirect: the real fetch exposes Location under redirect: manual", async () => {
    const res = await fetchChecked(
      `http://actual-http-api:${port}/start`,
      {},
      "actual",
    );
    expect(await res.json()).toEqual({ ok: true, path: "/done" });
  });

  it.each(["nowhere", "empty"])(
    "%s.example.com, which resolves to nothing, is a network error, not a refusal",
    async (name) => {
      const err = await externalRequest({
        service: "actual",
        endpoint: "/",
        url: `http://${name}.example.com:${port}/`,
        schema: z.unknown(),
        maxAttempts: 1,
      }).then(
        () => null,
        (e: unknown) => e as BudgetApiError,
      );
      expect(err?.code).toBe("network");
      expect(err?.isRetryable).toBe(true);
    },
  );
});
