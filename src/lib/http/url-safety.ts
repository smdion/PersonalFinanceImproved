/** Where Ledgr may send a request: a scheme the service takes, no user name
 *  or password, and a public host as `new URL` normalises it. A private or
 *  local host opens only for Actual, through ALLOWED_ACTUAL_HOSTS. */
import "server-only";
import {
  lookup as dnsLookup,
  type LookupAddress,
  type LookupAllOptions,
} from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { log } from "@/lib/logger";

export type OutboundService =
  "ynab" | "actual" | "simplefin" | "tiingo" | "sec";

type UrlPolicy = {
  schemes: readonly ("http:" | "https:")[];
  /** Whether ALLOWED_ACTUAL_HOSTS may open a private or local host. */
  allowlist: boolean;
};

const HTTPS_ONLY: UrlPolicy = { schemes: ["https:"], allowlist: false };

// http: is open for Actual: a LAN server often has no TLS, so its
// x-api-key crosses that network in cleartext.
const URL_POLICIES: Record<OutboundService, UrlPolicy> = {
  actual: { schemes: ["http:", "https:"], allowlist: true },
  ynab: HTTPS_ONLY,
  simplefin: HTTPS_ONLY,
  tiingo: HTTPS_ONLY,
  sec: HTTPS_ONLY,
};

const IPV4_BLOCKED: readonly [string, number][] = [
  ["0.0.0.0", 8], // this network
  ["10.0.0.0", 8], // RFC 1918
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // RFC 1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // RFC 1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
];

const IPV6_BLOCKED: readonly [string, number][] = [
  ["::", 96], // unspecified, loopback, IPv4-compatible
  ["::ffff:0:0:0", 96], // IPv4-translated
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local
  ["ff00::", 8], // multicast
  ["2002::", 16], // 6to4
  ["2001::", 32], // Teredo
  ["2001:db8::", 32], // documentation
  ["100::", 64], // discard-only
  ["64:ff9b:1::", 48], // local-use NAT64, its IPv4 placement not fixed
];

/** Every blocked range. IPv4 rules also match IPv4-mapped IPv6
 *  (`::ffff:7f00:1`), so mapped addresses need no rule of their own. */
const BLOCKED = new BlockList();
for (const [net, prefix] of IPV4_BLOCKED)
  BLOCKED.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of IPV6_BLOCKED)
  BLOCKED.addSubnet(net, prefix, "ipv6");

/** NAT64 (64:ff9b::/96) carries an IPv4 address in its last 32 bits; that
 *  address decides, so public hosts on a DNS64 network still pass. */
const NAT64 = new BlockList();
NAT64.addSubnet("64:ff9b::", 96, "ipv6");

/** Whether an IP address is private, local or otherwise not a public host.
 *  Anything that isn't an IP address counts as blocked. */
export function isBlockedAddress(ip: string): boolean {
  const address = ip.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const family = isIP(address);
  if (family === 4) return BLOCKED.check(address, "ipv4");
  if (family !== 6) return true;
  // Compressed hex, as the URL parser writes it: NAT64's IPv4 is the last 32 bits.
  const hex = new URL(`http://[${address}]`).hostname.slice(1, -1);
  if (NAT64.check(hex, "ipv6")) {
    const [hi = 0, lo = 0] = hex
      .split(":")
      .slice(-2)
      .map((g) => parseInt(g, 16) || 0);
    return isBlockedAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return BLOCKED.check(hex, "ipv6");
}

/** A host as matched: no brackets, lowercase, trailing dots dropped. */
function bareHost(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
}

type AllowEntry = { host: string; port: string | null };

const warnedEntries = new Set<string>();

/** One ALLOWED_ACTUAL_HOSTS entry, `host` or `host:port`, normalised as a
 *  URL host is; null when it isn't a host. */
function parseAllowEntry(entry: string): AllowEntry | null {
  // A bare IPv6 address (`fd00::5`) is written without brackets.
  const spelled = isIP(entry) === 6 ? `[${entry}]` : entry;
  let url: URL;
  try {
    url = new URL(`http://${spelled}`);
  } catch {
    return null;
  }
  if (url.href !== `http://${url.host}/`) return null;
  // `new URL` drops http's default port, so an explicit `:80` is read here.
  const explicit = /:(\d+)$/.exec(spelled.replace(/^\[[^\]]*\]/, ""));
  return {
    host: bareHost(url.hostname),
    port: url.port || explicit?.[1] || null,
  };
}

/** ALLOWED_ACTUAL_HOSTS, read on every call so a change applies at once.
 *  An entry that isn't a host is skipped and logged once. */
function allowEntries(): AllowEntry[] {
  const raw = process.env.ALLOWED_ACTUAL_HOSTS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const parsed = parseAllowEntry(entry);
      if (parsed) return [parsed];
      if (!warnedEntries.has(entry)) {
        warnedEntries.add(entry);
        log("warn", "allowed_actual_hosts_entry_ignored", {
          entry,
          reason: "not a host or host:port",
        });
      }
      return [];
    });
}

/** Whether ALLOWED_ACTUAL_HOSTS lists this URL's host (any port, or the
 *  port the entry names). */
export function isAllowlisted(url: URL): boolean {
  const host = bareHost(url.hostname);
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return allowEntries().some(
    (e) => e.host === host && (e.port === null || e.port === port),
  );
}

/** Why a host that isn't allowlisted is refused, or null when it's public. */
function refusal(host: string): string | null {
  if (host === "localhost" || host === "localhost.localdomain")
    return "a local name";
  if (host.endsWith(".localhost")) return "a local name";
  if (isIP(host))
    return isBlockedAddress(host) ? "a private or local address" : null;
  if (!host.includes("."))
    return "a single-label host (a local or Docker name)";
  return null;
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Check a URL before Ledgr sends a request to it for `service`. A refusal
 *  names the host at most. Fixed or operator-set URLs (GitHub tax data, the
 *  OIDC issuer) don't pass this check. */
export function checkOutboundUrl(
  input: string | URL,
  service: OutboundService,
): UrlCheck {
  const policy = URL_POLICIES[service];
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "Not a valid URL" };
  }
  if (!policy.schemes.some((s) => s === url.protocol)) {
    return {
      ok: false,
      reason: `URL scheme must be ${policy.schemes.map((s) => s.slice(0, -1)).join(" or ")} (got "${url.protocol}")`,
    };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "URL must not carry a user name or password" };
  }
  const host = bareHost(url.hostname);
  if (policy.allowlist && isAllowlisted(url)) return { ok: true, url };
  const why = refusal(host);
  if (!why) return { ok: true, url };
  return { ok: false, reason: `"${host}" is ${why}.${allowHint(service)}` };
}

/** What a refusal adds for a service that takes the allowlist. */
export function allowHint(service: OutboundService): string {
  return URL_POLICIES[service].allowlist
    ? " Add the host to ALLOWED_ACTUAL_HOSTS to allow it."
    : "";
}

/** Whether a request to this URL may connect to a private address: an
 *  allowlisted host may resolve to one (split DNS, a reverse proxy). */
export function opensPrivateAddress(
  url: URL,
  service: OutboundService,
): boolean {
  return URL_POLICIES[service].allowlist && isAllowlisted(url);
}

/** A connection refused because its name resolved to a blocked address. */
export class BlockedAddressError extends Error {
  override name = "BlockedAddressError";
}

type ResolveAll = (
  hostname: string,
  options: LookupAllOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    addresses: LookupAddress[],
  ) => void,
) => void;

const resolveAll: ResolveAll = (hostname, options, callback) =>
  dnsLookup(hostname, options, callback);

/** A `net.connect` lookup through node:dns that answers in both shapes
 *  `net` asks for (`all` or not), after `check` passes every address. */
function lookupWith(
  resolve: ResolveAll,
  check: (hostname: string, addresses: LookupAddress[]) => Error | null,
): LookupFunction {
  return (hostname, options, callback) =>
    resolve(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "");
      const first = addresses[0];
      const refused = first ? check(hostname, addresses) : null;
      if (!first) callback(new Error(`No address for ${hostname}`), "");
      else if (refused) callback(refused, "");
      else if (options.all) callback(null, addresses);
      else callback(null, first.address, first.family);
    });
}

/** A lookup for an allowlisted host: any address it resolves to. */
export function plainLookup(resolve: ResolveAll = resolveAll): LookupFunction {
  return lookupWith(resolve, () => null);
}

/** A lookup that refuses a name when any address it resolves to is
 *  blocked, so the address checked is the one connected (rebinding too). */
export function guardedLookup(
  resolve: ResolveAll = resolveAll,
): LookupFunction {
  return lookupWith(resolve, (hostname, addresses) =>
    addresses.some((a) => isBlockedAddress(a.address))
      ? new BlockedAddressError(
          `"${bareHost(hostname)}" resolves to a private or local address.`,
        )
      : null,
  );
}
