import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { log } from "@/lib/logger";

/**
 * Shared cron/internal-endpoint secret validation. `CRON_SECRET` must be at
 * least 32 characters; the comparison is constant-time to avoid a timing
 * oracle on these unauthenticated-by-default routes.
 */

export function getValidCronSecret(): string | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.length < 32) return null;
  return cronSecret;
}

export function timingSafeSecretMatch(
  provided: string | null,
  expected: string,
): boolean {
  const providedBuf = provided
    ? Buffer.from(provided, "utf8")
    : Buffer.alloc(0);
  const expectedBuf = Buffer.from(expected, "utf8");
  return (
    providedBuf.length === expectedBuf.length &&
    timingSafeEqual(providedBuf, expectedBuf)
  );
}

/**
 * Result of the `X-Cron-Secret` check. The routes answer the two failures
 * differently: `misconfigured` (CRON_SECRET missing or under 32 characters)
 * is a server fault (500), `unauthorized` (wrong or missing header) is 401.
 */
export type CronHeaderCheck = "ok" | "misconfigured" | "unauthorized";

/** Validates the `X-Cron-Secret` header used by the daily/weekly/startup cron routes. */
export function validateCronHeaderRequest(request: Request): CronHeaderCheck {
  const cronSecret = getValidCronSecret();
  if (!cronSecret) return "misconfigured";
  return timingSafeSecretMatch(request.headers.get("X-Cron-Secret"), cronSecret)
    ? "ok"
    : "unauthorized";
}

/** Validates the `Authorization: Bearer` header used by `health/detailed`. */
export function validateCronBearerRequest(request: Request): boolean {
  const cronSecret = getValidCronSecret();
  if (!cronSecret) return false;
  const auth = request.headers.get("authorization");
  const provided = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  return timingSafeSecretMatch(provided, cronSecret);
}

/**
 * Runs a cron route's work once its `X-Cron-Secret` header checks out.
 * A missing or short CRON_SECRET answers 500 and is logged; a wrong or
 * absent header answers 401.
 */
export async function cronRoute(
  request: Request,
  run: () => Promise<Response>,
): Promise<Response> {
  const cronCheck = validateCronHeaderRequest(request);
  if (cronCheck === "misconfigured") {
    log("error", "cron_secret_misconfigured", {
      message: "CRON_SECRET is missing or too short",
    });
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 },
    );
  }
  if (cronCheck !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}
