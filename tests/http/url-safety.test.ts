/**
 * The one outbound URL check (src/lib/http/url-safety.ts): every bypass the
 * two older validators let through, every spelling `new URL` normalises,
 * the per-service schemes, and Actual's admin-saved host, private or not.
 */
import { describe, it, expect } from "vitest";
import {
  checkOutboundUrl,
  isBlockedAddress,
  type OutboundService,
} from "@/lib/http/url-safety";

/** The public-only services; Actual takes any host. */
const PUBLIC_ONLY = ["ynab", "simplefin", "tiingo", "sec"] as const;

// The host checks run for a public-only service, over https (its scheme).
const refused = (url: string, service: OutboundService = "sec") =>
  checkOutboundUrl(url, service).ok === false;
const reason = (url: string, service: OutboundService = "sec") => {
  const r = checkOutboundUrl(url, service);
  return r.ok ? null : r.reason;
};

describe("checkOutboundUrl: IPv6 literals", () => {
  it.each([
    "[::ffff:7f00:1]",
    "[::ffff:127.0.0.1]:5006",
    "[0:0:0:0:0:ffff:7f00:1]",
    "[::ffff:a00:1]",
    "[::ffff:c0a8:101]",
    "[::ffff:ac10:1]",
    "[::ffff:a9fe:a9fe]",
    "[::ffff:0:7f00:1]",
    "[::7f00:1]",
    "[::127.0.0.1]",
    "[::]",
    "[::1]",
    "[0:0:0:0:0:0:0:1]",
    "[fd12::1]",
    "[fc00::1]",
    "[fe80::1]",
    "[FE80::1]",
    "[fec0::1]",
    "[ff02::1]",
    "[2002:7f00:1::]",
    "[64:ff9b::a9fe:a9fe]",
    "[64:ff9b:1::a9fe:a9fe]",
    "[64:ff9b:1::808:808]",
    "[2001::1]",
    "[2001:0:4136:e378:8000:63bf:3fff:fdd2]",
    "[2001:db8::1]",
    "[100::1]",
  ])("refuses https://%s", (host) => {
    expect(refused(`https://${host}/`)).toBe(true);
    expect(reason(`https://${host}/`)).toMatch(/private or local address/);
  });

  it.each([
    "[64:ff9b::808:808]",
    "[2606:4700::1111]",
    "[::ffff:808:808]",
    "[2001:4860:4860::8888]",
  ])("allows the public address http://%s", (host) => {
    expect(checkOutboundUrl(`http://${host}/`, "actual").ok).toBe(true);
  });
});

describe("checkOutboundUrl: IPv4 spellings normalised before the check", () => {
  it.each([
    "2130706433",
    "0177.1",
    "0x7f.1",
    "127.1",
    "0x7f000001",
    "017700000001",
    "%31%32%37.0.0.1",
    "0",
    "0.0.0.0",
    "127.0.0.1.",
  ])("refuses https://%s", (host) => {
    expect(refused(`https://${host}/`)).toBe(true);
  });
});

describe("checkOutboundUrl: non-public IPv4", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "172.16.0.1",
    "172.31.255.254",
    "100.64.0.1",
    "198.18.0.1",
    "192.0.0.1",
    "192.0.2.1",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    "169.254.169.254",
  ])("refuses https://%s", (host) => {
    expect(refused(`https://${host}/`)).toBe(true);
  });

  it.each(["11.1.1.1", "172.32.0.1", "8.8.8.8"])(
    "allows the public address %s",
    (host) => {
      expect(checkOutboundUrl(`http://${host}/`, "actual").ok).toBe(true);
    },
  );
});

describe("checkOutboundUrl: local and single-label names", () => {
  it.each([
    "localhost",
    "localhost.",
    "LOCALHOST",
    "a.localhost.",
    "app.localhost",
    "localhost.localdomain.",
    "localhost..",
    "a.localhost..",
  ])("refuses %s as a local name", (host) => {
    expect(reason(`https://${host}:5006/`)).toMatch(/local name/);
  });

  it.each(["actual", "actual.", "actual-http-api"])(
    "refuses %s as a single-label host",
    (host) => {
      expect(reason(`https://${host}:5007/`)).toMatch(/single-label/);
    },
  );
});

describe("checkOutboundUrl: credentials, schemes and invalid URLs", () => {
  it("refuses a URL with a user name or password, without echoing them", () => {
    expect(refused("http://a@h.example/", "actual")).toBe(true);
    const r = reason("http://u:p@h.example/", "actual");
    expect(r).toMatch(/user name or password/);
    expect(r).not.toContain("u:p");
    // A private host opens nothing else for Actual.
    expect(reason("http://u:p@10.0.0.5:5006/", "actual")).toMatch(
      /user name or password/,
    );
    expect(reason("https://u:p@h.example/", "ynab")).toMatch(
      /user name or password/,
    );
  });

  it.each([
    "file:///etc/passwd",
    "ftp://h.example/",
    "data:text/plain,hi",
    "javascript:alert(1)",
    "blob:https://h.example/x",
    "ws://h.example/",
    "gopher://h.example/",
  ])("refuses %s", (url) => {
    expect(reason(url, "actual")).toMatch(/scheme/);
    expect(reason(url)).toMatch(/scheme/);
  });

  it.each<OutboundService>(["simplefin", "ynab", "tiingo", "sec"])(
    "refuses http: for %s",
    (service) => {
      expect(reason("http://h.example/", service)).toMatch(/must be https/);
      expect(checkOutboundUrl("https://h.example/", service).ok).toBe(true);
    },
  );

  it("allows http: and https: for Actual", () => {
    expect(checkOutboundUrl("http://h.example:8080/x", "actual").ok).toBe(true);
    expect(checkOutboundUrl("https://h.example/", "actual").ok).toBe(true);
  });

  it.each([
    "http://[fe80::1%25eth0]/",
    "http://1.2.3.4.5/",
    "http://256.0.0.1/",
    "not a url",
  ])("refuses %s as not a valid URL", (url) => {
    expect(reason(url)).toBe("Not a valid URL");
  });

  it("returns the parsed URL when it passes", () => {
    const r = checkOutboundUrl("https://api.ynab.com/v1/budgets", "ynab");
    expect(r.ok && r.url.href).toBe("https://api.ynab.com/v1/budgets");
  });
});

describe("checkOutboundUrl: the services' real hosts and the test fixtures", () => {
  it.each<[string, OutboundService]>([
    ["https://api.ynab.com/v1", "ynab"],
    ["https://api.tiingo.com/tiingo/daily/VTI/prices", "tiingo"],
    ["https://www.sec.gov/files/company_tickers_mf.json", "sec"],
    ["https://beta-bridge.simplefin.org/simplefin/claim/x", "simplefin"],
    ["https://actual.example.org", "actual"],
  ])("allows %s", (url, service) => {
    expect(checkOutboundUrl(url, service).ok).toBe(true);
  });

  // The sync fixtures' fetch is stubbed, so no address is ever resolved.
  it.each(["http://actual.local", "https://actual.baseline.example"])(
    "allows the fixture %s",
    (url) => {
      expect(checkOutboundUrl(url, "actual").ok).toBe(true);
    },
  );
});

describe("Actual's Server URL, as an admin saved it", () => {
  it.each([
    "http://10.0.0.5:5006",
    "http://192.168.1.20:5007/",
    "http://127.0.0.1:5006",
    "http://localhost:5006",
    "http://actual-http-api:5007",
    "http://[fd00::5]:5006",
  ])("allows %s for Actual and refuses it for every other service", (url) => {
    expect(checkOutboundUrl(url, "actual").ok).toBe(true);
    for (const service of PUBLIC_ONLY) {
      const https = url.replace(/^http:/, "https:");
      expect(checkOutboundUrl(https, service).ok).toBe(false);
    }
  });

  // A .local name passes the string check for every service; the connect
  // check (tests/http/connect-check.test.ts) refuses its LAN address for
  // the public-only ones.
  it("allows a .local name for Actual", () => {
    expect(checkOutboundUrl("http://actual.local:5006", "actual").ok).toBe(
      true,
    );
  });

  it("keeps Actual to http and https", () => {
    expect(reason("ftp://10.0.0.5/", "actual")).toMatch(/scheme/);
    expect(reason("file:///etc/passwd", "actual")).toMatch(/scheme/);
  });
});

describe("isBlockedAddress", () => {
  it("reads addresses as a resolver returns them", () => {
    expect(isBlockedAddress("10.0.0.5")).toBe(true);
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("fe80::1%eth0")).toBe(true);
    expect(isBlockedAddress("93.184.215.14")).toBe(false);
    expect(isBlockedAddress("2606:4700::1111")).toBe(false);
  });

  it("counts anything that isn't an IP address as blocked", () => {
    expect(isBlockedAddress("example.com")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });
});
