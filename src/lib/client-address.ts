/**
 * The visitor's address for rate limiting, from the header that
 * TRUSTED_PROXY_HEADER names (validated in env.ts):
 *   - unset: X-Real-IP, else X-Forwarded-For's last hop. SWAG sets X-Real-IP
 *     from the connection (overwriting anything the client sent) and appends
 *     the connection's address as the last hop; the first hop is whatever the
 *     client claimed, so it never chooses the bucket.
 *   - `x-real-ip` / `x-forwarded-for`: only that header (its last hop).
 *   - `none`: no proxy, so any such header is the client's own claim. Every
 *     visitor shares the one "unknown" bucket.
 */
export function clientAddress(get: (name: string) => string | null): string {
  const trusted = process.env.TRUSTED_PROXY_HEADER;
  if (trusted === "none") return "unknown";

  const realIp = get("x-real-ip")?.trim();
  if (trusted !== "x-forwarded-for" && realIp) return realIp;
  if (trusted === "x-real-ip") return "unknown";

  const hops = (get("x-forwarded-for") ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  return hops.at(-1) ?? "unknown";
}
