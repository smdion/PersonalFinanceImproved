/** The visitor's address for rate limiting, per TRUSTED_PROXY_HEADER (env.ts): unset = X-Real-IP,
 *  else X-Forwarded-For's last hop (the proxy sets both; earlier hops are client claims);
 *  `x-real-ip` / `x-forwarded-for` = only that header; `none` = one shared "unknown" bucket. */
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
