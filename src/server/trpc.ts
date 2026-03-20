import { initTRPC, TRPCError } from "@trpc/server";
import type { Session } from "next-auth";
import { cookies, headers } from "next/headers";
import { auth } from "./auth";
import { type Permission, ALL_PERMISSIONS } from "./auth";
import { db, pool } from "@/lib/db";
import { isPostgres } from "@/lib/db/dialect";
import { rateLimit } from "@/lib/rate-limit";
import * as schema from "@/lib/db/schema";
import { log } from "@/lib/logger";

export type AuthLevel = "public" | "protected" | "admin" | Permission;

type ProcedureMeta = { auth: AuthLevel };

export type Context = {
  db: typeof db;
  session: Session | null;
  demoSchema: string | null;
};

const isDev = process.env.NODE_ENV === "development";
const isDemoOnly = process.env.DEMO_ONLY === "true";

// ALLOW_DEV_MODE is only honored in non-production environments.
// In production, OIDC is required (unless DEMO_ONLY).
const isDevMode =
  process.env.ALLOW_DEV_MODE === "true" &&
  process.env.NODE_ENV !== "production";

const devSession: Session = {
  user: {
    id: "1",
    name: isDevMode ? "Admin" : "Viewer",
    email: "admin@dev.local",
    role: isDevMode ? "admin" : "viewer",
    permissions: [],
  },
  expires: "2099-12-31T23:59:59.999Z",
};

const demoOnlySession: Session = {
  user: {
    id: "demo",
    name: "Demo User",
    email: "demo@demo.local",
    role: "viewer",
    permissions: [...ALL_PERMISSIONS],
  },
  expires: "2099-12-31T23:59:59.999Z",
};

// Validate required env vars in production (skip for demo-only mode and build phase).
// Next.js sets NEXT_PHASE during `next build` — deferring this check avoids build
// failures when OIDC isn't configured (e.g. dev environments with local login only).
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
if (
  process.env.NODE_ENV === "production" &&
  !process.env.AUTH_AUTHENTIK_ISSUER &&
  !isDemoOnly &&
  !isBuildPhase
) {
  throw new Error("AUTH_AUTHENTIK_ISSUER is required in production");
}

// Block dangerous combination: ALLOW_DEV_MODE should never be set in production
if (
  process.env.NODE_ENV === "production" &&
  process.env.ALLOW_DEV_MODE === "true"
) {
  log("warn", "security_dev_mode_in_prod", {
    message: "ALLOW_DEV_MODE=true is ignored in production. Remove it from your environment.",
  });
}

export async function createContext(): Promise<Context> {
  const session = isDemoOnly
    ? demoOnlySession
    : isDev
      ? devSession
      : await auth();

  // Detect demo profile from cookie — actual search_path switching happens
  // in the demoSchema middleware (which wraps queries in a transaction so
  // every query hits the same pooled connection).
  let demoSchema: string | null = null;
  try {
    const cookieStore = await cookies();
    const demoSlug = cookieStore.get("demo_active_profile")?.value;
    if (demoSlug && /^[a-z0-9-]+$/.test(demoSlug)) {
      demoSchema = `demo_${demoSlug.replace(/-/g, "_")}`;
    }
  } catch {
    // cookies() may throw outside request context (e.g. during build)
  }

  return { db, session, demoSchema };
}

const t = initTRPC.context<Context>().meta<ProcedureMeta>().create();

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;

// ── Shared change_log middleware (fire-and-forget, never blocks) ──

function logMutation(session: Session, path: string, rawInput: unknown) {
  const input = rawInput as Record<string, unknown> | undefined;
  const recordId = typeof input?.id === "number" ? input.id : 0;
  db.insert(schema.changeLog)
    .values({
      tableName: path,
      recordId,
      fieldName: "*",
      oldValue: null,
      newValue: input ?? null,
      changedBy: session.user.name ?? session.user.email ?? "unknown",
    })
    .catch((err: unknown) => {
      // Log audit errors but never break mutations
      log("error", "audit_log_failed", {
        path,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

// ── Demo schema middleware ──
// When a demo profile is active, acquire a dedicated connection from the pool,
// set search_path on it, and use it for all queries in this procedure.
// This avoids the pool-connection-hop problem where SET search_path on one
// connection doesn't apply to queries that land on a different connection.
const demoSchemaMiddleware = t.middleware(async ({ ctx, next }) => {
  // Demo schemas require PG (uses SET search_path for isolation)
  if (!ctx.demoSchema || !isPostgres()) return next({ ctx });

  // ctx.demoSchema is already validated by the regex in createContext,
  // but double-quote the identifier defensively.
  const quotedSchema = `"${ctx.demoSchema.replace(/"/g, '""')}"`;
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${quotedSchema}, public`);
    const { drizzle: pgDrizzle } = await import("drizzle-orm/node-postgres");
    const demoDb = pgDrizzle(client, { schema }) as unknown as typeof db;
    return await next({ ctx: { ...ctx, db: demoDb } });
  } finally {
    await client.query("SET search_path TO public");
    client.release();
  }
});

// Demo-only mode: block all mutations except demo profile management
const demoOnlyGuard = t.middleware(async ({ ctx, next, type, path }) => {
  if (isDemoOnly && type === "mutation" && !path.startsWith("demo.")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This is a read-only demo instance. Data cannot be modified.",
    });
  }
  return next({ ctx });
});

// ── Rate-limit helpers ──

const RATE_LIMIT_PUBLIC = { maxRequests: 60, windowMs: 60_000 } as const;
const RATE_LIMIT_AUTHENTICATED = { maxRequests: 200, windowMs: 60_000 } as const;

async function getRateLimitKey(): Promise<string> {
  try {
    // Note: x-forwarded-for is set by the reverse proxy (SWAG).
    // In production, SWAG strips client-supplied x-forwarded-for headers.
    const hdrs = await headers();
    return (
      hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      hdrs.get("x-real-ip") ??
      "unknown"
    );
  } catch {
    // headers() may throw outside request context (e.g. during build)
    return "unknown";
  }
}

const rateLimitMiddleware = t.middleware(async ({ ctx, next }) => {
  const key = await getRateLimitKey();
  const { success, remaining } = rateLimit(
    key,
    RATE_LIMIT_PUBLIC.maxRequests,
    RATE_LIMIT_PUBLIC.windowMs,
  );
  if (!success) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Rate limit exceeded. Try again shortly. (remaining: ${remaining})`,
    });
  }
  return next({ ctx });
});

const authenticatedRateLimitMiddleware = t.middleware(async ({ ctx, next }) => {
  // Use session user ID when available for per-user limiting, fall back to IP
  const key = ctx.session?.user?.id
    ? `user:${ctx.session.user.id}`
    : await getRateLimitKey();
  const { success, remaining } = rateLimit(
    key,
    RATE_LIMIT_AUTHENTICATED.maxRequests,
    RATE_LIMIT_AUTHENTICATED.windowMs,
  );
  if (!success) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Rate limit exceeded. Try again shortly. (remaining: ${remaining})`,
    });
  }
  return next({ ctx });
});

// ── Error logging middleware ──
// Logs unexpected errors (not UNAUTHORIZED/FORBIDDEN/NOT_FOUND) so they're
// visible in container logs instead of silently returning to the client.
const errorLoggingMiddleware = t.middleware(async ({ next, path, type }) => {
  const result = await next();
  if (!result.ok) {
    const err = result.error;
    // Skip expected auth/permission/validation errors — only log server-side problems
    const skipCodes = new Set(["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "BAD_REQUEST", "TOO_MANY_REQUESTS"]);
    if (!skipCodes.has(err.code)) {
      log("error", "trpc_error", {
        path,
        type,
        code: err.code,
        error: err.message,
        cause: err.cause instanceof Error ? err.cause.message : undefined,
      });
    }
  }
  return result;
});

// Base procedure with error logging, demo schema support + demo-only guard
const baseProcedure = t.procedure.use(errorLoggingMiddleware).use(demoOnlyGuard).use(demoSchemaMiddleware);

// ── Procedures ──

// Public — no auth required (health check), rate-limited
export const publicProcedure = baseProcedure
  .use(rateLimitMiddleware)
  .meta({ auth: "public" });

// Protected — requires valid session (all dashboard queries), rate-limited per user
export const protectedProcedure = baseProcedure
  .use(authenticatedRateLimitMiddleware)
  .meta({ auth: "protected" })
  .use(async ({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Not authenticated",
      });
    }
    return next({
      ctx: { ...ctx, session: ctx.session },
    });
  });

// Admin — requires Admin role + logs mutations to change_log
export const adminProcedure = baseProcedure
  .meta({ auth: "admin" })
  .use(async ({ ctx, next, path, type, getRawInput }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Not authenticated",
      });
    }
    if (ctx.session.user.role !== "admin") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Admin access required",
      });
    }
    const result = await next({
      ctx: { ...ctx, session: ctx.session },
    });
    if (type === "mutation" && result.ok) {
      logMutation(
        ctx.session,
        path,
        await getRawInput().catch(() => undefined),
      );
    }
    return result;
  });

// Permission-gated — requires admin OR specific permission addon + logs mutations
function withPermission(permission: Permission) {
  return baseProcedure
    .meta({ auth: permission })
    .use(async ({ ctx, next, path, type, getRawInput }) => {
      if (!ctx.session?.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Not authenticated",
        });
      }
      const { role, permissions } = ctx.session.user;
      if (role !== "admin" && !permissions.includes(permission)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `${permission} permission required`,
        });
      }
      const result = await next({
        ctx: { ...ctx, session: ctx.session },
      });
      if (type === "mutation" && result.ok) {
        logMutation(
          ctx.session,
          path,
          await getRawInput().catch(() => undefined),
        );
      }
      return result;
    });
}

export const scenarioProcedure = withPermission("scenario");
export const portfolioProcedure = withPermission("portfolio");
export const performanceProcedure = withPermission("performance");
export const budgetProcedure = withPermission("budget");
export const savingsProcedure = withPermission("savings");
export const brokerageProcedure = withPermission("brokerage");
export const versionProcedure = withPermission("version");
export const contributionProfileProcedure = withPermission(
  "contributionProfile",
);
export const syncProcedure = withPermission("sync");
