/**
 * The one outbound URL check (src/lib/http/url-safety.ts): every bypass the
 * two older validators let through, every spelling `new URL` normalises,
 * the per-service schemes and the ALLOWED_ACTUAL_HOSTS allowlist.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const log = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logger", () => ({ log }));

import {
  checkOutboundUrl,
  isAllowlisted,
  isBlockedAddress,
  type OutboundService,
} from "@/lib/http/url-safety";

let originalAllowlist: string | undefined;

beforeEach(() => {
  originalAllowlist = process.env.ALLOWED_ACTUAL_HOSTS;
  delete process.env.ALLOWED_ACTUAL_HOSTS;
  log.mockClear();
});

afterEach(() => {
  if (originalAllowlist === undefined) delete process.env.ALLOWED_ACTUAL_HOSTS;
  else process.env.ALLOWED_ACTUAL_HOSTS = originalAllowlist;
});

const refused = (url: string, service: OutboundService = "actual") =>
  checkOutboundUrl(url, service).ok === false;
const reason = (url: string, service: OutboundService = "actual") => {
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
  ])("refuses http://%s", (host) => {
    expect(refused(`http://${host}/`)).toBe(true);
    expect(reason(`http://${host}/`)).toMatch(/private or local address/);
  });

  it.each(["[64:ff9b::808:808]", "[2606:4700::1111]", "[::ffff:808:808]"])(
    "allows the public address http://%s",
    (host) => {
      expect(checkOutboundUrl(`http://${host}/`, "actual").ok).toBe(true);
    },
  );
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
  ])("refuses http://%s", (host) => {
    expect(refused(`http://${host}/`)).toBe(true);
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
  ])("refuses http://%s", (host) => {
    expect(refused(`http://${host}/`)).toBe(true);
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
  ])("refuses %s as a local name", (host) => {
    expect(reason(`http://${host}:5006/`)).toMatch(/local name/);
  });

  it.each(["actual", "actual.", "actual-http-api"])(
    "refuses %s as a single-label host",
    (host) => {
      expect(reason(`http://${host}:5007/`)).toMatch(/single-label/);
    },
  );

  it("names ALLOWED_ACTUAL_HOSTS for Actual only", () => {
    expect(reason("http://actual:5007/", "actual")).toMatch(
      /ALLOWED_ACTUAL_HOSTS/,
    );
    expect(reason("https://actual/", "simplefin")).not.toMatch(
      /ALLOWED_ACTUAL_HOSTS/,
    );
  });
});

describe("checkOutboundUrl: credentials, schemes and invalid URLs", () => {
  it("refuses a URL with a user name or password, without echoing them", () => {
    expect(refused("http://a@h.example/")).toBe(true);
    const r = reason("http://u:p@h.example/");
    expect(r).toMatch(/user name or password/);
    expect(r).not.toContain("u:p");
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

  // The sync fixtures pass the string check with no allowlist: two labels,
  // not an IP, and no host is refused for its top-level domain. Their
  // fetch is stubbed, so no address is ever resolved for them.
  it.each(["http://actual.local", "https://actual.baseline.example"])(
    "allows the fixture %s with no allowlist",
    (url) => {
      expect(checkOutboundUrl(url, "actual").ok).toBe(true);
    },
  );
});

describe("ALLOWED_ACTUAL_HOSTS", () => {
  it("a bare host opens any port; host:port opens that port only", () => {
    process.env.ALLOWED_ACTUAL_HOSTS = "actual-http-api";
    expect(checkOutboundUrl("http://actual-http-api:5007", "actual").ok).toBe(
      true,
    );
    process.env.ALLOWED_ACTUAL_HOSTS = "actual-http-api:5007";
    expect(checkOutboundUrl("http://actual-http-api:5007", "actual").ok).toBe(
      true,
    );
    process.env.ALLOWED_ACTUAL_HOSTS = "actual-http-api:5006";
    expect(checkOutboundUrl("http://actual-http-api:5007", "actual").ok).toBe(
      false,
    );
  });

  it("an entry's port compares against the scheme's default port", () => {
    process.env.ALLOWED_ACTUAL_HOSTS = "10.0.0.5:80";
    expect(isAllowlisted(new URL("http://10.0.0.5/"))).toBe(true);
    expect(isAllowlisted(new URL("https://10.0.0.5/"))).toBe(false);
    process.env.ALLOWED_ACTUAL_HOSTS = "10.0.0.5:443";
    expect(isAllowlisted(new URL("https://10.0.0.5/"))).toBe(true);
  });

  it("entries are normalised: brackets, case, trailing dot, IPv4 spelling", () => {
    process.env.ALLOWED_ACTUAL_HOSTS =
      "10.0.0.5, [fd00::5] ,ACTUAL.LAN.,fd00::6,0x7f.1";
    for (const url of [
      "http://10.0.0.5:5006",
      "http://[fd00::5]",
      "http://actual.lan",
      "http://actual.lan.:5006",
      "http://[fd00::6]:5006",
      "http://127.0.0.1",
    ]) {
      expect(checkOutboundUrl(url, "actual").ok).toBe(true);
    }
    expect(checkOutboundUrl("http://10.0.0.6", "actual").ok).toBe(false);
  });

  it("opens localhost and private literals when listed", () => {
    process.env.ALLOWED_ACTUAL_HOSTS = "localhost,10.10.10.50";
    expect(checkOutboundUrl("http://localhost:5006", "actual").ok).toBe(true);
    expect(checkOutboundUrl("http://10.10.10.50:5006", "actual").ok).toBe(true);
    expect(checkOutboundUrl("http://10.10.10.51:5006", "actual").ok).toBe(
      false,
    );
  });

  it("never opens another service", () => {
    process.env.ALLOWED_ACTUAL_HOSTS = "10.0.0.5";
    for (const service of ["simplefin", "ynab", "tiingo", "sec"] as const) {
      expect(checkOutboundUrl("https://10.0.0.5", service).ok).toBe(false);
    }
  });

  it("is read on every call", () => {
    expect(checkOutboundUrl("http://10.0.0.5", "actual").ok).toBe(false);
    process.env.ALLOWED_ACTUAL_HOSTS = "10.0.0.5";
    expect(checkOutboundUrl("http://10.0.0.5", "actual").ok).toBe(true);
    delete process.env.ALLOWED_ACTUAL_HOSTS;
    expect(checkOutboundUrl("http://10.0.0.5", "actual").ok).toBe(false);
  });

  it("skips an entry that isn't a host, and logs it once", () => {
    process.env.ALLOWED_ACTUAL_HOSTS = "http://actual:5006,u@h,10.0.0.5";
    expect(checkOutboundUrl("http://10.0.0.5", "actual").ok).toBe(true);
    expect(checkOutboundUrl("http://actual:5006", "actual").ok).toBe(false);
    const warned = log.mock.calls.filter(
      (c) => c[1] === "allowed_actual_hosts_entry_ignored",
    );
    expect(warned.map((c) => (c[2] as { entry: string }).entry)).toEqual([
      "http://actual:5006",
      "u@h",
    ]);
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
