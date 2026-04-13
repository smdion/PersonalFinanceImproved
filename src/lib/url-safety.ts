/**
 * URL safety validation for outbound HTTP requests to user-supplied
 * destinations (e.g., self-hosted Actual Budget server URL).
 *
 * Closes the v0.5 expert-review C2 finding: a `z.string().url()` validator
 * accepts http://127.0.0.1, http://10.0.0.1, etc., letting an admin (or
 * anyone who reaches the admin form) trigger SSRF requests against internal
 * homelab services from inside the container.
 *
 * Strategy:
 *   1. Reject obviously dangerous schemes (anything not http/https).
 *   2. Reject private IPv4 ranges (RFC1918, loopback, link-local, CGNAT).
 *   3. Reject IPv6 loopback + link-local + ULA + IPv4-mapped equivalents.
 *   4. Optional allowlist via env var (ALLOWED_ACTUAL_HOSTS) so legitimate
 *      LAN destinations can be added explicitly.
 *
 * Note: This validator does NOT do DNS resolution to check what a hostname
 * resolves to. A determined attacker could register a public DNS name that
 * points to a private IP. For self-hosted homelab scope, the env-var
 * allowlist is the right tradeoff (admins explicitly opt in to specific
 * hostnames).
 */

const PRIVATE_IPV4_PATTERNS: RegExp[] = [
  /^127\./, // 127.0.0.0/8 — loopback
  /^10\./, // 10.0.0.0/8 — RFC1918
  /^192\.168\./, // 192.168.0.0/16 — RFC1918
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12 — RFC1918
  /^169\.254\./, // 169.254.0.0/16 — link-local
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // 100.64.0.0/10 — CGNAT
  /^0\./, // 0.0.0.0/8 — "this network"
  /^255\.255\.255\.255$/, // limited broadcast
];

const PRIVATE_IPV6_PATTERNS: RegExp[] = [
  /^::1$/i, // loopback
  /^::$/, // unspecified
  /^fc[0-9a-f]{2}:/i, // fc00::/7 — ULA
  /^fd[0-9a-f]{2}:/i, // fd00::/8 — ULA
  /^fe8[0-9a-f]:/i, // fe80::/10 — link-local
  /^::ffff:127\./i, // IPv4-mapped loopback
  /^::ffff:10\./i, // IPv4-mapped 10/8
];

function isLiteralIpv4(host: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function isLiteralIpv6(host: string): boolean {
  // Crude — a literal IPv6 in a URL is wrapped in brackets, but URL.hostname
  // strips them. Detect by presence of ':' in the hostname.
  return host.includes(":");
}

function isPrivateIpv4(host: string): boolean {
  return PRIVATE_IPV4_PATTERNS.some((re) => re.test(host));
}

function isPrivateIpv6(host: string): boolean {
  return PRIVATE_IPV6_PATTERNS.some((re) => re.test(host));
}

function isLocalhostName(host: string): boolean {
  const lower = host.toLowerCase();
  return (
    lower === "localhost" ||
    lower === "localhost.localdomain" ||
    lower.endsWith(".localhost")
  );
}

function getAllowlist(): Set<string> {
  const raw = process.env.ALLOWED_ACTUAL_HOSTS;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export interface UrlSafetyResult {
  ok: boolean;
  reason?: string;
}

/**
 * Validate that a URL is safe to use as an outbound request target.
 * Returns { ok: true } if safe, or { ok: false, reason: "..." } if not.
 *
 * Private/loopback hosts are rejected unless explicitly allowlisted via
 * the ALLOWED_ACTUAL_HOSTS env var (comma-separated hostnames).
 */
export function validateOutboundUrl(input: string): UrlSafetyResult {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "Not a valid URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      reason: `URL scheme must be http or https (got "${url.protocol}")`,
    };
  }

  // Node URL.hostname keeps the brackets on IPv6 literals (e.g., "[::1]").
  // Strip them so the IPv6 patterns can match.
  const rawHost = url.hostname.toLowerCase();
  const host =
    rawHost.startsWith("[") && rawHost.endsWith("]")
      ? rawHost.slice(1, -1)
      : rawHost;
  if (!host) {
    return { ok: false, reason: "URL has no hostname" };
  }

  // Allowlist bypass — env var lets admins explicitly permit specific
  // private hosts (e.g., a self-hosted Actual server on the LAN).
  const allowlist = getAllowlist();
  if (allowlist.has(host)) {
    return { ok: true };
  }

  if (isLocalhostName(host)) {
    return {
      ok: false,
      reason:
        "Localhost names are not allowed. Add to ALLOWED_ACTUAL_HOSTS if " +
        "you intentionally want to point at a local service.",
    };
  }

  if (isLiteralIpv4(host) && isPrivateIpv4(host)) {
    return {
      ok: false,
      reason:
        `Private IPv4 address "${host}" is not allowed (RFC1918, loopback, ` +
        "link-local, or CGNAT). Add to ALLOWED_ACTUAL_HOSTS if intentional.",
    };
  }

  if (isLiteralIpv6(host) && isPrivateIpv6(host)) {
    return {
      ok: false,
      reason:
        `Private IPv6 address "${host}" is not allowed (loopback, ULA, or ` +
        "link-local). Add to ALLOWED_ACTUAL_HOSTS if intentional.",
    };
  }

  return { ok: true };
}

/**
 * Zod refinement helper. Use as:
 *   z.string().url().refine(isOutboundUrlSafe, { message: "..." })
 * — but prefer validateOutboundUrl() for richer error messages.
 */
export function isOutboundUrlSafe(input: string): boolean {
  return validateOutboundUrl(input).ok;
}
