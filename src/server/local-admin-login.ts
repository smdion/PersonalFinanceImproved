/**
 * Local-admin sign-in (the Credentials provider's `authorize`), throttled.
 *
 * Attempts are counted per client address and per email on the shared
 * in-memory limiter (src/lib/rate-limit.ts), before the password check, so
 * parallel requests can't slip past the count. A sign-in clears both
 * counts. An address is refused after `perAddress` attempts; an email
 * after `perEmail`, but only from an address that already has a failed or
 * pending attempt, so the admin can still sign in from a clean address.
 * Every lock ends with its window. The throttle and the timing don't
 * depend on whether the email belongs to an admin; no password is logged.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { localAdmins } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { clearRateLimit, rateLimit, rateLimitCount } from "@/lib/rate-limit";
import { clientAddress } from "@/lib/client-address";
import { log } from "@/lib/logger";

/** Attempts allowed per window before that address or email is refused. */
export const LOGIN_THROTTLE = {
  perAddress: 5,
  perEmail: 10,
  windowMs: 15 * 60_000,
} as const;

export type LocalAdminLogin =
  | { ok: true; user: { id: string; name: string; email: string } }
  | { ok: false; throttled: boolean };

const INVALID: LocalAdminLogin = { ok: false, throttled: false };

type LocalAdminRow = {
  id: number;
  name: string;
  email: string;
  passwordHash: string;
};

async function findLocalAdmin(
  email: string,
): Promise<LocalAdminRow | undefined> {
  const [admin] = await db
    .select()
    .from(localAdmins)
    .where(eq(localAdmins.email, email))
    .limit(1);
  return admin;
}

// An unknown email still costs one scrypt, so the response time doesn't
// tell whether an admin with that email exists.
let dummyHash: Promise<string> | null = null;
function timingDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("ledgr-timing-equalizer");
  return dummyHash;
}

const addressKey = (address: string) => `login-attempt:address:${address}`;
const emailKey = (email: string) => `login-attempt:email:${email}`;

/** Count one attempt on `key`; true on the first one past `limit`. */
function take(key: string, limit: number): boolean {
  return rateLimit(key, limit, LOGIN_THROTTLE.windowMs).firstExceedance;
}

/**
 * Count this attempt, synchronously. Returns which lock refuses it, if any.
 * A refused attempt is counted only on the key that refused it.
 */
function admit(address: string, email: string): "address" | "email" | null {
  const aKey = addressKey(address);
  const eKey = emailKey(email);
  const lock =
    rateLimitCount(aKey) >= LOGIN_THROTTLE.perAddress
      ? "address"
      : rateLimitCount(eKey) >= LOGIN_THROTTLE.perEmail &&
          rateLimitCount(aKey) > 0
        ? "email"
        : null;
  if (lock) {
    const first =
      lock === "address"
        ? take(aKey, LOGIN_THROTTLE.perAddress)
        : take(eKey, LOGIN_THROTTLE.perEmail);
    log(first ? "warn" : "info", first ? "login_locked" : "login_throttled", {
      email,
      address,
      by: lock,
      minutes: LOGIN_THROTTLE.windowMs / 60_000,
    });
    return lock;
  }
  take(aKey, LOGIN_THROTTLE.perAddress);
  take(eKey, LOGIN_THROTTLE.perEmail);
  return null;
}

/** Check a local admin's email and password; `throttled` while locked. */
export async function authorizeLocalAdmin(
  credentials: Partial<Record<string, unknown>> | undefined,
  request: Request | undefined,
  findAdmin: (
    email: string,
  ) => Promise<LocalAdminRow | undefined> = findLocalAdmin,
): Promise<LocalAdminLogin> {
  const rawEmail = credentials?.email;
  const password = credentials?.password;
  if (typeof rawEmail !== "string" || typeof password !== "string")
    return INVALID;
  if (!rawEmail || !password) return INVALID;

  const email = rawEmail.trim().toLowerCase().slice(0, 320);
  const address = clientAddress((name) => request?.headers.get(name) ?? null);

  // Nothing above awaits: the attempt is counted before any other request
  // for this address or email can be checked.
  if (admit(address, email)) return { ok: false, throttled: true };

  try {
    const fallbackHash = await timingDummyHash();
    const admin = await findAdmin(email);
    const valid = await verifyPassword(
      password,
      admin?.passwordHash ?? fallbackHash,
    );
    if (!admin || !valid) {
      log("warn", "login_failed", {
        email,
        address,
        reason: admin ? "invalid_password" : "user_not_found",
      });
      return INVALID;
    }

    clearRateLimit(addressKey(address));
    clearRateLimit(emailKey(email));
    log("info", "login_success", { email, method: "local-admin" });
    return {
      ok: true,
      user: { id: `local:${admin.id}`, name: admin.name, email: admin.email },
    };
  } catch (err) {
    log("error", "login_error", {
      email,
      error: err instanceof Error ? err.message : String(err),
    });
    return INVALID;
  }
}
