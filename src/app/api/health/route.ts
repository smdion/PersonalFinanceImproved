import { NextResponse } from "next/server";
import { db, isPostgres } from "@/lib/db";
import { sql } from "drizzle-orm";

// Loaded once per process: a build whose app code fails to load reports degraded.
let appRouterLoad: Promise<unknown> | undefined;

/**
 * Simple health probe for Docker HEALTHCHECK and load balancers.
 * Returns only status + version — no internal state.
 * For detailed diagnostics, see /api/health/detailed.
 */
export async function GET() {
  try {
    appRouterLoad ??= import("@/server/routers");
    await appRouterLoad;

    // Database connectivity check
    if (isPostgres()) {
      await db.execute(sql`SELECT 1`);
    } else {
      // eslint-disable-next-line no-restricted-syntax -- Drizzle ORM type limitation
      (db as unknown as { all: (q: unknown) => unknown }).all(sql`SELECT 1`);
    }

    return NextResponse.json(
      { status: "ok", version: process.env.APP_VERSION ?? "dev" },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { status: "degraded", version: process.env.APP_VERSION ?? "dev" },
      { status: 503 },
    );
  }
}
