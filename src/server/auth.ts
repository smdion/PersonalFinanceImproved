import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { NextAuthConfig } from "next-auth";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { authConfig, capSessionAge } from "./auth.config";
import { isDevelopmentBuild } from "./auth-mode";
import { log } from "@/lib/logger";
import { authorizeLocalAdmin } from "./local-admin-login";
import {
  PERMISSIONS,
  RBAC_ADMIN_GROUP_KEY,
  RBAC_SETTINGS_PREFIX,
  type Permission,
} from "@/lib/config/permissions";
export {
  RBAC_ADMIN_GROUP_KEY,
  RBAC_SETTINGS_PREFIX,
} from "@/lib/config/permissions";

/*
 * NextAuth v5 is a beta (pinned exact in package.json; its API is not stable).
 * Before bumping it, read the release notes and audit auth.config.ts, this file
 * and the middleware; keep it pinned exact until a stable v5 ships.
 */

/** Default Authentik group names per permission. */
const DEFAULT_PERMISSION_GROUPS: Record<Permission, string> = {
  scenario: "ledgr-scenario",
  portfolio: "ledgr-portfolio",
  performance: "ledgr-performance",
  budget: "ledgr-budget",
  savings: "ledgr-savings",
  brokerage: "ledgr-brokerage",
  version: "ledgr-version",
  contributionProfile: "ledgr-contribution-profile",
  sync: "ledgr-sync",
};

/** Default admin group name. */
const DEFAULT_ADMIN_GROUP = "ledgr-admin";

/**
 * Build the group→permission mapping from app_settings overrides (rbac_admin_group,
 * rbac_group_*) + defaults. Exported so tests can call it with a mocked db.
 */
export async function loadPermissionGroups(): Promise<{
  adminGroup: string;
  groupToPermission: Record<string, Permission>;
}> {
  try {
    const settings = await db.select().from(appSettings);
    const map = new Map(settings.map((s) => [s.key, s.value]));

    const adminGroup =
      (typeof map.get(RBAC_ADMIN_GROUP_KEY) === "string"
        ? (map.get(RBAC_ADMIN_GROUP_KEY) as string)
        : null) || DEFAULT_ADMIN_GROUP;

    const groupToPermission: Record<string, Permission> = {};
    for (const perm of PERMISSIONS) {
      const override = map.get(`${RBAC_SETTINGS_PREFIX}${perm}`);
      const groupName =
        (typeof override === "string" ? override : null) ||
        DEFAULT_PERMISSION_GROUPS[perm];
      groupToPermission[groupName] = perm;
    }

    return { adminGroup, groupToPermission };
  } catch (err) {
    // DB unavailable (e.g. during build) — use defaults
    log("warn", "rbac_db_unavailable", {
      error: err instanceof Error ? err.message : String(err),
      message: "Falling back to default RBAC groups",
    });
    const groupToPermission: Record<string, Permission> = {};
    for (const perm of PERMISSIONS) {
      groupToPermission[DEFAULT_PERMISSION_GROUPS[perm]] = perm;
    }
    return { adminGroup: DEFAULT_ADMIN_GROUP, groupToPermission };
  }
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: "admin" | "viewer";
      permissions: Permission[];
    };
  }
}

declare module "next-auth" {
  interface JWT {
    role: "admin" | "viewer";
    permissions: Permission[];
    authMethod?: "local" | "oidc";
  }
}

/** The login form shows this `code` as "too many failed sign-ins". */
class LoginThrottledError extends CredentialsSignin {
  code = "rate_limited";
}

/** Local admin credentials provider — lives in auth.ts (not auth.config.ts) because it needs DB. */
const localAdminProvider = Credentials({
  id: "local-admin",
  name: "Local Admin",
  credentials: {
    email: { label: "Email", type: "email" },
    password: { label: "Password", type: "password" },
  },
  async authorize(credentials, request) {
    const result = await authorizeLocalAdmin(credentials, request);
    if (result.ok) return result.user;
    if (result.throttled) throw new LoginThrottledError();
    return null;
  },
});

/**
 * JWT callback's role + permission assignment; mutates and returns the token, or null
 * to reject it. Only tokens a known provider stamped with `authMethod` are accepted:
 * the secret is shared with the demo. loadGroups is injected so tests can mock it.
 */
export async function assignRoleAndPermissions(
  token: Record<string, unknown>,
  user: unknown,
  account: { provider?: string } | null | undefined,
  loadGroups: () => Promise<{
    adminGroup: string;
    groupToPermission: Record<string, Permission>;
  }> = loadPermissionGroups,
): Promise<Record<string, unknown> | null> {
  // No user object means this is a refresh, not a sign-in: keep the token
  // only if a known provider signed it in.
  if (!user) {
    if (token.authMethod) return token;
    log("warn", "auth_token_rejected", { reason: "no_auth_method" });
    return null;
  }

  // Local admin: always admin role, no RBAC lookup needed.
  if (account?.provider === "local-admin") {
    token.role = "admin";
    token.permissions = [];
    token.authMethod = "local";
    return token;
  }

  // OIDC (Authentik): map groups to permissions.
  if (account?.provider === "authentik") {
    token.authMethod = "oidc";
    const groups = (user as Record<string, unknown>).groups;
    const { adminGroup, groupToPermission } = await loadGroups();
    if (Array.isArray(groups) && groups.includes(adminGroup)) {
      token.role = "admin";
      token.permissions = [];
    } else {
      token.role = "viewer";
      token.permissions = groups
        ? (groups as string[])
            .map((g) => groupToPermission[g])
            .filter((p): p is Permission => p !== undefined)
        : [];
    }
    return token;
  }

  // Dev Login: development builds only (auth.config.ts doesn't register it
  // in production builds or DEMO_ONLY).
  if (account?.provider === "credentials" && isDevelopmentBuild()) {
    token.role = "admin";
    token.permissions = [];
    token.authMethod = "local";
    return token;
  }

  // Any other provider, or Dev Login in a production build: rejected.
  log("warn", "auth_token_rejected", {
    reason: "unknown_provider",
    provider: account?.provider ?? null,
  });
  return null;
}

// Extend the edge-compatible base config with DB-dependent callbacks and local admin provider
const fullAuthConfig: NextAuthConfig = {
  ...authConfig,
  // DEMO_ONLY signs nobody in (auth.config.ts): not even a local admin, whose
  // token the shared secret would make valid on another install.
  providers:
    process.env.DEMO_ONLY === "true"
      ? authConfig.providers
      : [...authConfig.providers, localAdminProvider],
  callbacks: {
    async jwt({ token, user, account, trigger }) {
      // Sessions end 4 hours after sign-in (authConfig: the same cap the proxy applies).
      const signingIn = trigger === "signIn" || trigger === "signUp";
      const capped = capSessionAge(token, signingIn);
      if (!capped) return null;
      return (await assignRoleAndPermissions(
        capped,
        user,
        account,
      )) as typeof token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as "admin" | "viewer";
        // A token from an older version may carry no permissions.
        session.user.permissions =
          (token.permissions as Permission[] | undefined) ?? [];
      }
      return session;
    },
  },
};

export { authConfig } from "./auth.config";
export const { handlers, auth, signIn, signOut } = NextAuth(fullAuthConfig);
