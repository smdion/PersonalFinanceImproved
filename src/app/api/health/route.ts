import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { queryRaw } from "@/lib/db/compat";
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
    await queryRaw(db, sql`SELECT 1`);

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
