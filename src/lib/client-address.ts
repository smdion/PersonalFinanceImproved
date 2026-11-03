/**
 * The visitor's address for rate limiting. Only what our proxy set counts:
 * SWAG sets X-Real-IP from the connection (overwriting anything the client
 * sent), and appends the connection's address as X-Forwarded-For's last
 * hop. The first hop is whatever the client claimed, so keying on it let
 * anyone pick a fresh bucket per request.
 */
export function clientAddress(get: (name: string) => string | null): string {
  const realIp = get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const hops = (get("x-forwarded-for") ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  return hops.at(-1) ?? "unknown";
}
