import Credentials from "next-auth/providers/credentials";
import type { NextAuthConfig } from "next-auth";

/**
 * Edge-compatible auth config — NO database imports.
 * Used by middleware (runs in edge runtime) and re-exported by auth.ts.
 * DB-dependent logic (RBAC group loading) lives only in auth.ts callbacks.
 */

const providers: NextAuthConfig["providers"] = [];

if (!process.env.AUTH_AUTHENTIK_ISSUER) {
  providers.push(
    Credentials({
      name: "Dev Login",
      credentials: {
        name: { label: "Name", type: "text", placeholder: "Admin" },
      },
      async authorize(credentials) {
        const name = (credentials?.name as string) || "Admin";
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

export const authConfig: NextAuthConfig = {
  providers,
  pages: {
    signIn: "/login",
  },
};
