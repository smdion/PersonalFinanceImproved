import Credentials from "next-auth/providers/credentials";
import type { NextAuthConfig } from "next-auth";
import { isDevelopmentBuild } from "./auth-mode";
import { writeStamp } from "@/lib/utils/clock";

/**
 * Edge-compatible auth config — NO database imports.
 * Used by middleware (runs in edge runtime) and re-exported by auth.ts.
 * DB-dependent logic (RBAC group loading) lives only in auth.ts callbacks.
 */

const providers: NextAuthConfig["providers"] = [];

// DEMO_ONLY registers no providers: every request gets the read-only demo session.
// Dev Login exists only in development builds: the NextAuth secret is shared with
// the demo, so a production build offering it would mint tokens another install accepts.
const isDemoOnly = process.env.DEMO_ONLY === "true";

if (isDemoOnly) {
  // No providers.
} else if (!process.env.AUTH_AUTHENTIK_ISSUER) {
  if (isDevelopmentBuild())
    providers.push(
      Credentials({
        name: "Dev Login",
        credentials: {
          name: { label: "Name", type: "text", placeholder: "Admin" },
        },
        async authorize(credentials) {
          const name = (credentials.name as string) || "Admin";
          return { id: "1", name, email: `${name.toLowerCase()}@dev.local` };
        },
      }),
    );
} else {
  providers.push({
    id: "authentik",
    name: "Authentik",
    type: "oidc",
    issuer: process.env.AUTH_AUTHENTIK_ISSUER,
    clientId: process.env.AUTH_AUTHENTIK_ID,
    clientSecret: process.env.AUTH_AUTHENTIK_SECRET,
    authorization: { params: { scope: "openid email profile groups" } },
    profile(profile) {
      return {
        id: profile.sub,
        name: profile.name ?? profile.preferred_username,
        email: profile.email,
        groups: profile.groups ?? [],
      };
    },
  });
}

/** A session lasts this long from sign-in, however active: an Authentik
 *  group change reaches every session within it. */
export const SESSION_MAX_AGE_SECONDS = 4 * 60 * 60;

/** Stamps `loginAt` at sign-in; on any later read a token without it, or past
 *  SESSION_MAX_AGE_SECONDS from it, ends the session (null). The cookie's
 *  maxAge restarts on every refresh (the proxy's), so it caps idle time only. */
export function capSessionAge<T extends Record<string, unknown>>(
  token: T,
  signingIn: boolean,
  now = writeStamp().getTime(),
): (T & { loginAt: number }) | null {
  if (signingIn) return { ...token, loginAt: now };
  const { loginAt } = token;
  if (typeof loginAt !== "number") return null;
  if (now - loginAt >= SESSION_MAX_AGE_SECONDS * 1000) return null;
  return { ...token, loginAt };
}

export const authConfig: NextAuthConfig = {
  providers,
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  callbacks: {
    // Edge-safe, so the proxy's refresh applies the cap too; auth.ts's
    // callback runs it before assigning roles.
    jwt: ({ token, trigger }) =>
      capSessionAge(token, trigger === "signIn" || trigger === "signUp"),
  },
};
