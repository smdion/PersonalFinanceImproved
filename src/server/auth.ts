import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { NextAuthConfig } from "next-auth";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings, localAdmins } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { authConfig } from "./auth.config";
import { log } from "@/lib/logger";

/**
 * ── NextAuth v5 Beta Notice ──
 *
 * This project uses NextAuth v5 (currently pinned at 5.0.0-beta.30 in
 * package.json). The v5 API is **not yet stable** — expect breaking
 * changes on upgrade.
 *
 * Before bumping the next-auth version:
 *   1. Check the release notes at https://github.com/nextauthjs/next-auth
 *   2. Audit auth.config.ts, this file, and the middleware for API changes
 *   3. Keep the version pinned (exact, no caret) until a stable v5 ships
 *
 * Monitor: https://github.com/nextauthjs/next-auth/releases
 */

export type Permission =
  | "scenario"
  | "portfolio"
  | "performance"
  | "budget"
  | "savings"
  | "brokerage"
  | "version"
  | "contributionProfile"
  | "sync";

/** All permission keys — used to iterate when building group mapping. */
export const ALL_PERMISSIONS: Permission[] = [
  "scenario",
  "portfolio",
  "performance",
  "budget",
  "savings",
  "brokerage",
  "version",
  "contributionProfile",
  "sync",
];

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

/** app_settings key prefix for RBAC group overrides. */
export const RBAC_SETTINGS_PREFIX = "rbac_group_";
export const RBAC_ADMIN_GROUP_KEY = "rbac_admin_group";

/**
 * Build the group→permission mapping from DB overrides + defaults.
 * Reads app_settings keys: rbac_admin_group, rbac_group_scenario, etc.
 */
async function loadPermissionGroups(): Promise<{
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
    for (const perm of ALL_PERMISSIONS) {
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
    for (const perm of ALL_PERMISSIONS) {
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

/** Local admin credentials provider — lives in auth.ts (not auth.config.ts) because it needs DB. */
const localAdminProvider = Credentials({
  id: "local-admin",
  name: "Local Admin",
  credentials: {
    email: { label: "Email", type: "email" },
    password: { label: "Password", type: "password" },
  },
  async authorize(credentials) {
    const email = credentials?.email as string | undefined;
    const password = credentials?.password as string | undefined;
    if (!email || !password) return null;

    try {
      const [admin] = await db
        .select()
        .from(localAdmins)
        .where(eq(localAdmins.email, email.toLowerCase()))
        .limit(1);
      if (!admin) {
        log("info", "login_failed", { email, reason: "user_not_found" });
        return null;
      }

      const valid = await verifyPassword(password, admin.passwordHash);
      if (!valid) {
        log("warn", "login_failed", { email, reason: "invalid_password" });
        return null;
      }

      log("info", "login_success", { email, method: "local-admin" });
      return {
        id: `local:${admin.id}`,
        name: admin.name,
        email: admin.email,
      };
    } catch (err) {
      log("error", "login_error", {
        email,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },
});

// Extend the edge-compatible base config with DB-dependent callbacks and local admin provider
const fullAuthConfig: NextAuthConfig = {
  ...authConfig,
  providers: [...authConfig.providers, localAdminProvider],
  session: {
    strategy: "jwt",
    // 24 hours — explicit expiry instead of NextAuth default (30 days).
    // Known limitation: RBAC group changes in Authentik won't take effect until the
    // user's JWT expires and they re-authenticate. The 24h maxAge bounds this window.
    // A shorter maxAge (e.g. 1h) would reduce the stale-permissions window at the cost
    // of more frequent re-logins. (Review item L4)
    maxAge: 24 * 60 * 60,
  },
  callbacks: {
    async jwt({ token, user, account }) {
      // On initial sign-in, determine role based on auth method
      if (user) {
        // Local admin: always admin role, no RBAC lookup needed
        if (account?.provider === "local-admin") {
          token.role = "admin";
          token.permissions = [];
          token.authMethod = "local";
          return token;
        }

        // OIDC (Authentik): map groups to permissions
        if (account?.provider === "authentik") {
          token.authMethod = "oidc";
          // profile.groups is available via the OIDC provider
          const groups = (token as Record<string, unknown>).groups;
          const { adminGroup, groupToPermission } =
            await loadPermissionGroups();
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

        // Dev credentials (kept for development only, not production)
        if (
          account?.provider === "credentials" &&
          process.env.NODE_ENV !== "production"
        ) {
          token.role = "admin";
          token.permissions = [];
          token.authMethod = "local";
          return token;
        }

        // Unknown provider — safe default
        token.role = token.role ?? "viewer";
        token.permissions = token.permissions ?? [];
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as "admin" | "viewer";
        session.user.permissions = (token.permissions as Permission[]) ?? [];
      }
      return session;
    },
  },
};

export { authConfig } from "./auth.config";
export const { handlers, auth, signIn, signOut } = NextAuth(fullAuthConfig);
