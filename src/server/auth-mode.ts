/**
 * The one answer to "is this a development build, and does it skip sign-in?"
 * for auth.config.ts, trpc.ts createContext, the dashboard layout and the
 * version routes. Reads only the environment, so the edge runtime can import it.
 */

/** A development build: `next dev` or tests. The production image sets
 *  NODE_ENV=production. Dev Login (any name, no password) is offered only
 *  here. */
export function isDevelopmentBuild(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Whether requests skip sign-in, and with which role: only under `next dev`,
 *  admin only with ALLOW_DEV_MODE=true. null: every request signs in for real. */
export function devBypass(): "admin" | "viewer" | null {
  if (process.env.NODE_ENV !== "development") return null;
  return process.env.ALLOW_DEV_MODE === "true" ? "admin" : "viewer";
}

/** Whether Authentik sign-in is configured on this server (the issuer
 *  auth.config.ts registers its provider for). */
export function oidcConfigured(): boolean {
  return !!process.env.AUTH_AUTHENTIK_ISSUER;
}
