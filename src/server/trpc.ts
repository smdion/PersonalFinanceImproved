import { initTRPC, TRPCError } from "@trpc/server";
import {
  DEMO_SCHEMA_MARKER_PREFIX,
  MIGRATION_COUNT_SUBQUERY,
} from "@/lib/db/demo-schema-marker";
import { ZodError, z } from "zod/v4";
import type { Session } from "next-auth";
import { cookies, headers } from "next/headers";
import { auth } from "./auth";
import { type Permission, ALL_PERMISSIONS } from "./auth";
import { db, pool } from "@/lib/db";
import { isPostgres } from "@/lib/db/dialect";
import { rateLimit } from "@/lib/rate-limit";
import * as schema from "@/lib/db/schema";
import { log } from "@/lib/logger";
import { notifyMutationSucceeded } from "./mutation-events";

export type AuthLevel = "public" | "protected" | "admin" | Permission;

type ProcedureMeta = { auth: AuthLevel };

export type Context = {
  db: typeof db;
  session: Session | null;
  demoSchema: string | null;
  /** Set ONLY by `internalCaller()` below, for a server-side nested tRPC
   *  call made on behalf of an already-authenticated request (e.g.
   *  `computeActiveSummary` calling into the paycheck router for its own
   *  income figure). Skips ONLY the authenticated rate-limit middleware —
   *  every other middleware (auth check, permission check, demo guards,
   *  error logging) still runs unchanged, so this is not a second
   *  computation path, just an exemption from double-charging the calling
   *  request's own rate-limit budget for work the server does on its
   *  behalf. `createContext()` takes no arguments and ignores any
   *  request-supplied input, so this can only ever become `true` via
   *  `internalCaller()` — never from request-derived data. */
  internal?: boolean;
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
    message:
      "ALLOW_DEV_MODE=true is ignored in production. Remove it from your environment.",
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

const t = initTRPC
  .context<Context>()
  .meta<ProcedureMeta>()
  .create({
    // Surface Zod input-validation failures as a structured `data.zodError`
    // (`{ formErrors, fieldErrors }`) so the client's global error toast
    // (friendlyMutationError) can show a concrete field message instead of
    // the raw ZodError JSON in `message`.
    errorFormatter({ shape, error }) {
      return {
        ...shape,
        data: {
          ...shape.data,
          zodError:
            error.code === "BAD_REQUEST" && error.cause instanceof ZodError
              ? z.flattenError(error.cause)
              : null,
        },
      };
    },
  });

export const createTRPCRouter = t.router;
export const mergeRouters = t.mergeRouters;
export const createCallerFactory = t.createCallerFactory;

/**
 * Marks a context for a server-side nested call into another router, made
 * on behalf of an already-authenticated request — e.g.
 * `budget.computeActiveSummary` calling into the paycheck router for its
 * own income figure, rather than re-deriving paycheck math independently
 * (single computation path).
 *
 * Use `createCallerFactory(someRouter)(internalCtx(ctx))` for any such
 * nested call, instead of passing `ctx` straight through: it exempts the
 * nested call from the CALLING request's own authenticated rate-limit
 * budget (see `authenticatedRateLimitMiddleware`) — every other middleware
 * (auth check, permission check, demo guards, error logging) still runs
 * exactly as it would for a caller hitting that procedure directly.
 * Without this, a page that internally fans out several nested calls
 * silently burns several extra tokens from the SAME bucket the user's own
 * browser requests draw from, with no way for the client to see or back
 * off from the hidden consumption.
 *
 * A thin wrapper around `{ ...ctx, internal: true }` rather than a generic
 * `createCallerFactory` wrapper — a generic router-typed wrapper here
 * collapses tRPC's own inferred caller type to an uncallable union, so
 * this keeps `createCallerFactory(router)` called directly (full type
 * inference intact) while still giving every nested-call site one shared,
 * documented spelling of the flag that's easy to grep for.
 */
export function internalCtx(ctx: Context): Context {
  return { ...ctx, internal: true };
}

// ── Shared change_log middleware (fire-and-forget, never blocks) ──

/** Extract display label from OIDC/local session user. */
export function getSessionUserLabel(session: Session): string {
  return session.user.name ?? session.user.email ?? "unknown";
}

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
      changedBy: getSessionUserLabel(session),
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
const demoSchemaMiddleware = t.middleware(async ({ ctx, next, path }) => {
  // Demo schemas require PG (uses SET search_path for isolation)
  if (!ctx.demoSchema || !isPostgres()) return next({ ctx });

  // ctx.demoSchema is already validated by the regex in createContext,
  // but double-quote the identifier defensively.
  const quotedSchema = `"${ctx.demoSchema.replace(/"/g, '""')}"`;
  const client = await pool.connect();
  try {
    // Fail closed: PostgreSQL silently skips a missing schema in
    // search_path, so a demo schema dropped by an upgrade (or missing a
    // table added since it was built) would send this request to the real
    // public tables. Only the demo.* procedures (set up / leave a demo)
    // run without a complete demo schema — and they never read app data.
    // A schema built before the latest migration is stale too (its tables
    // lack new columns), so its stamp must match the current count.
    const { rows } = (await client.query(
      `SELECT to_regnamespace($1) IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM pg_tables p WHERE p.schemaname = 'public'
           AND NOT EXISTS (SELECT 1 FROM pg_tables d
             WHERE d.schemaname = $1 AND d.tablename = p.tablename)
       ) AND obj_description(to_regnamespace($1)::oid, 'pg_namespace')
         = $2 || ${MIGRATION_COUNT_SUBQUERY}::text
       AS complete`,
      [ctx.demoSchema, DEMO_SCHEMA_MARKER_PREFIX],
    )) as { rows: { complete: boolean }[] };
    if (!rows[0]?.complete) {
      if (path.startsWith("demo.")) return await next({ ctx });
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "This demo profile needs to be set up again (Ledgr was updated). Choose a demo profile again to continue.",
      });
    }
    await client.query(`SET search_path TO ${quotedSchema}, public`);
    const { drizzle: pgDrizzle } = await import("drizzle-orm/node-postgres");
    // eslint-disable-next-line no-restricted-syntax -- Drizzle ORM type limitation
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
// Raised from 200: a cold dashboard load alone is ~46 requests (shared
// layout chrome — data-freshness, scenario-bar — adds ~7 more to every
// single navigation), and httpBatchLink batches the HTTP request but each
// procedure in the batch still runs the middleware separately, so batching
// gives this limiter no headroom back. This limit exists to catch runaway
// bugs (an infinite refetch loop, a poll that never stops), not to throttle
// normal browsing on a single-household app — 600 tolerates roughly a
// dozen cold page loads a minute while still tripping within seconds on an
// actual loop.
const RATE_LIMIT_AUTHENTICATED = {
  maxRequests: 600,
  windowMs: 60_000,
} as const;

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

const rateLimitMiddleware = t.middleware(async ({ ctx, next, path }) => {
  const key = await getRateLimitKey();
  const { success, remaining, firstExceedance } = rateLimit(
    key,
    RATE_LIMIT_PUBLIC.maxRequests,
    RATE_LIMIT_PUBLIC.windowMs,
  );
  if (firstExceedance) {
    log("warn", "rate_limit_exceeded", {
      tier: "public",
      key,
      path,
      limit: RATE_LIMIT_PUBLIC.maxRequests,
    });
  }
  if (!success) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Rate limit exceeded. Try again shortly. (remaining: ${remaining})`,
    });
  }
  return next({ ctx });
});

/**
 * Per-user rate-limit key. DEMO_ONLY collapses every visitor onto the same
 * literal `"demo"` session user id (see `demoOnlySession` above) — keying
 * by that would put every simultaneous demo visitor in ONE shared bucket
 * instead of separate per-visitor ones (and raising the limit would raise
 * a SHARED ceiling for the whole demo instance). Fall back to IP in that
 * case, matching the public limiter's own per-visitor granularity.
 */
export async function resolveAuthenticatedRateLimitKey(
  ctx: Context,
): Promise<string> {
  if (isDemoOnly || ctx.session?.user?.id === "demo") {
    return getRateLimitKey();
  }
  return ctx.session?.user?.id
    ? `user:${ctx.session.user.id}`
    : await getRateLimitKey();
}

const authenticatedRateLimitMiddleware = t.middleware(
  async ({ ctx, next, path }) => {
    // Server-side nested call on behalf of an already-authenticated
    // request (see internalCaller()) — every other middleware still runs,
    // only the throttle is skipped.
    if (ctx.internal) return next({ ctx });

    const key = await resolveAuthenticatedRateLimitKey(ctx);
    const { success, remaining, firstExceedance } = rateLimit(
      key,
      RATE_LIMIT_AUTHENTICATED.maxRequests,
      RATE_LIMIT_AUTHENTICATED.windowMs,
    );
    if (firstExceedance) {
      log("warn", "rate_limit_exceeded", {
        tier: "authenticated",
        key,
        path,
        limit: RATE_LIMIT_AUTHENTICATED.maxRequests,
      });
    }
    if (!success) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Rate limit exceeded. Try again shortly. (remaining: ${remaining})`,
      });
    }
    return next({ ctx });
  },
);

/** Rate limit for expensive operations (Monte Carlo, full sync) — 5 per minute per user. */
const RATE_LIMIT_EXPENSIVE = { maxRequests: 5, windowMs: 60_000 } as const;

export const expensiveRateLimitMiddleware = t.middleware(
  async ({ ctx, next, path, getRawInput }) => {
    // peekOnly reads the projection cache and never runs the actual
    // trials/search (see projection/monte-carlo.ts, coast-fire.ts) — it's a
    // cheap DB read, not the expensive operation this limiter protects.
    // Without this exemption, dashboard-tile peeks share the same bucket as
    // real Retirement-page simulation runs (same path = same rate-limit
    // key) and can starve them out.
    const rawInput = await getRawInput().catch(() => undefined);
    const isPeek =
      !!rawInput &&
      typeof rawInput === "object" &&
      (rawInput as Record<string, unknown>).peekOnly === true;
    if (isPeek) {
      return next({ ctx });
    }

    const key = ctx.session?.user?.id
      ? `expensive:${ctx.session.user.id}:${path}`
      : `expensive:${await getRateLimitKey()}:${path}`;
    const { success, firstExceedance } = rateLimit(
      key,
      RATE_LIMIT_EXPENSIVE.maxRequests,
      RATE_LIMIT_EXPENSIVE.windowMs,
    );
    if (firstExceedance) {
      log("warn", "rate_limit_exceeded", {
        tier: "expensive",
        key,
        path,
        limit: RATE_LIMIT_EXPENSIVE.maxRequests,
      });
    }
    if (!success) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "This operation is rate-limited. Please wait before retrying.",
      });
    }
    return next({ ctx });
  },
);

// ── Error logging middleware ──
// Logs unexpected errors (not UNAUTHORIZED/FORBIDDEN/NOT_FOUND) so they're
// visible in container logs instead of silently returning to the client.
const errorLoggingMiddleware = t.middleware(async ({ next, path, type }) => {
  const result = await next();
  if (!result.ok) {
    const err = result.error;
    // Skip expected auth/permission/validation errors — only log server-side problems
    const skipCodes = new Set([
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "BAD_REQUEST",
      "TOO_MANY_REQUESTS",
    ]);
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

// Lets server-side caches drop anything built before a successful write.
const mutationEventsMiddleware = t.middleware(async ({ next, type }) => {
  const result = await next();
  if (type === "mutation" && result.ok) notifyMutationSucceeded();
  return result;
});

// Base procedure with error logging, demo schema support + demo-only guard
const baseProcedure = t.procedure
  .use(errorLoggingMiddleware)
  .use(mutationEventsMiddleware)
  .use(demoOnlyGuard)
  .use(demoSchemaMiddleware);

// Shared by every procedure that requires a session (protected, admin, and
// every withPermission() addon below) — the authenticated rate limit used
// to apply to protectedProcedure alone, leaving adminProcedure and every
// permission-gated (budget/savings/sync/etc.) procedure completely
// unlimited: the write-capable half of the API had no throttle at all
// while read-only queries carried the whole burden. One shared base keeps
// the limit (and the `internal` bypass) uniform across all of them instead
// of applying to one of several builders.
const rateLimitedAuthedBase = baseProcedure.use(
  authenticatedRateLimitMiddleware,
);

// ── Procedures ──

// Public — no auth required (health check), rate-limited
export const publicProcedure = baseProcedure
  .use(rateLimitMiddleware)
  .meta({ auth: "public" });

// Protected — requires valid session (all dashboard queries), rate-limited per user
export const protectedProcedure = rateLimitedAuthedBase
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
export const adminProcedure = rateLimitedAuthedBase
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
/** Whether a signed-in user holds a permission (admins hold all) — the rule withPermission enforces. */
export function userHasPermission(
  user: { role: string; permissions: readonly string[] },
  permission: Permission,
): boolean {
  return user.role === "admin" || user.permissions.includes(permission);
}

function withPermission(permission: Permission) {
  return rateLimitedAuthedBase
    .meta({ auth: permission })
    .use(async ({ ctx, next, path, type, getRawInput }) => {
      if (!ctx.session?.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Not authenticated",
        });
      }
      if (!userHasPermission(ctx.session.user, permission)) {
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
