/**
 * The one answer to "is this a development build, and does it skip sign-in?"
 * for every place that asks: the Dev Login provider (auth.config.ts), the
 * request session (trpc.ts createContext), the dashboard layout's user, and
 * the version export/import routes. Each used to ask its own question
 * (`NODE_ENV === "development"`, `!== "production"`, or "no Authentik
 * configured") and they disagreed: the layout rendered an admin shell
 * without signing in on any install without Authentik.
 *
 * Reads only the environment, at call time, so the edge runtime
 * (auth.config.ts) can import it.
 */

/** A development build: `next dev` or tests. The production image sets
 *  NODE_ENV=production. Dev Login (any name, no password) is offered only
 *  here. */
export function isDevelopmentBuild(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Whether requests skip sign-in and get a fixed development session, and
 *  with which role: only under `next dev`, admin only with
 *  ALLOW_DEV_MODE=true (env.ts refuses that flag in production). null:
 *  every request signs in for real. */
export function devBypass(): "admin" | "viewer" | null {
  if (process.env.NODE_ENV !== "development") return null;
  return process.env.ALLOW_DEV_MODE === "true" ? "admin" : "viewer";
}

/** Whether Authentik sign-in is configured on this server (the issuer
 *  auth.config.ts registers its provider for). */
export function oidcConfigured(): boolean {
  return !!process.env.AUTH_AUTHENTIK_ISSUER;
}
