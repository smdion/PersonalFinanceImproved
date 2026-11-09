/**
 * Local-admin sign-in throttle (src/server/local-admin-login.ts): attempts
 * lock the client address and (for addresses that already failed) the
 * email for the rest of the window, parallel attempts are counted, a
 * sign-in clears the counts, the lock expires, an unknown email costs the
 * same scrypt, and no password reaches the logs.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({ localAdmins: {} }));
vi.mock("@/lib/logger", () => ({ log: vi.fn(), logWarnOnce: vi.fn() }));
vi.mock("@/lib/auth/password", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/password")>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

import { log } from "@/lib/logger";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  authorizeLocalAdmin,
  LOGIN_THROTTLE,
} from "@/server/local-admin-login";

const PASSWORD = "correct horse battery staple";
const SIGNED_IN = { ok: true };
const INVALID = { ok: false, throttled: false };
const THROTTLED = { ok: false, throttled: true };
let passwordHash = "";
let seq = 0;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(log).mockClear();
  vi.mocked(verifyPassword).mockClear();
});

/** A fresh admin email and client address per test (the limiter is shared). */
function fresh() {
  seq += 1;
  return { email: `admin${seq}@example.test`, address: `198.51.100.${seq}` };
}

function findAdminFor(email: string) {
  return async (lookup: string) =>
    lookup === email
      ? { id: 1, name: "Admin", email, passwordHash }
      : undefined;
}

function req(headers: Record<string, string>) {
  return new Request("http://localhost/api/auth/callback/local-admin", {
    headers,
  });
}

function attempt(
  email: string,
  password: string,
  headers: Record<string, string>,
  findAdmin = findAdminFor(email),
) {
  return authorizeLocalAdmin({ email, password }, req(headers), findAdmin);
}

describe("authorizeLocalAdmin", () => {
  it("signs in with the right password, refuses a wrong one", async () => {
    const { email, address } = fresh();
    const h = { "x-real-ip": address };
    expect(await attempt(email, PASSWORD, h)).toEqual({
      ok: true,
      user: { id: "local:1", name: "Admin", email },
    });
    expect(await attempt(email, "wrong", h)).toEqual(INVALID);
  });

  it("locks an address after its limit of failures, even for the right password", async () => {
    const { email, address } = fresh();
    const h = { "x-real-ip": address };
    for (let i = 0; i < LOGIN_THROTTLE.perAddress; i++)
      expect(await attempt(email, "wrong", h)).toEqual(INVALID);

    await expect(attempt(email, PASSWORD, h)).resolves.toEqual(THROTTLED);
    // Another address (fewer failures on this email than its own limit) can still sign in.
    expect(
      await attempt(email, PASSWORD, { "x-real-ip": "192.0.2.250" }),
    ).toMatchObject(SIGNED_IN);
  });

  it("locks an email after its limit, but only for an address that already failed", async () => {
    const { email } = fresh();
    for (let i = 0; i < LOGIN_THROTTLE.perEmail; i++)
      await attempt(email, "wrong", { "x-real-ip": `203.0.113.${i + 1}` });

    // An address with a failure in the window is refused, right password or not.
    await expect(
      attempt(email, PASSWORD, { "x-real-ip": "203.0.113.1" }),
    ).resolves.toEqual(THROTTLED);
    // A clean address with the right password gets in, which clears the counts.
    expect(
      await attempt(email, PASSWORD, { "x-real-ip": "192.0.2.1" }),
    ).toMatchObject(SIGNED_IN);
    expect(
      await attempt(email, PASSWORD, { "x-real-ip": "203.0.113.2" }),
    ).toMatchObject(SIGNED_IN);
  });

  it("a sign-in clears the address's and the email's counts", async () => {
    const { email, address } = fresh();
    const h = { "x-real-ip": address };
    for (let i = 1; i < LOGIN_THROTTLE.perAddress; i++)
      await attempt(email, "wrong", h);
    expect(await attempt(email, PASSWORD, h)).toMatchObject(SIGNED_IN);

    // A full fresh allowance again: none of these is refused.
    for (let i = 0; i < LOGIN_THROTTLE.perAddress; i++)
      expect(await attempt(email, "wrong", h)).toEqual(INVALID);
    await expect(attempt(email, "wrong", h)).resolves.toEqual(THROTTLED);
  });

  it("parallel attempts can't get past the limit", async () => {
    const { email, address } = fresh();
    const findAdmin = vi.fn(findAdminFor(email));
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        attempt(email, "wrong", { "x-real-ip": address }, findAdmin),
      ),
    );
    expect(findAdmin).toHaveBeenCalledTimes(LOGIN_THROTTLE.perAddress);
    expect(results.filter((r) => !r.ok && r.throttled)).toHaveLength(
      20 - LOGIN_THROTTLE.perAddress,
    );
  });

  it("the lock expires when the window ends", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
    const { email, address } = fresh();
    const h = { "x-real-ip": address };
    for (let i = 0; i < LOGIN_THROTTLE.perAddress; i++)
      await attempt(email, "wrong", h);
    await expect(attempt(email, PASSWORD, h)).resolves.toEqual(THROTTLED);

    vi.setSystemTime(Date.now() + LOGIN_THROTTLE.windowMs);
    expect(await attempt(email, PASSWORD, h)).toMatchObject(SIGNED_IN);
  });

  it("an unknown email costs the same password check and counts the same", async () => {
    const { email, address } = fresh();
    const h = { "x-real-ip": address };
    const noAdmin = async () => undefined;

    expect(await attempt(email, "anything", h, noAdmin)).toEqual(INVALID);
    expect(verifyPassword).toHaveBeenCalledTimes(1);
    // Against a real scrypt hash, as for a known admin.
    expect(vi.mocked(verifyPassword).mock.calls[0]?.[1]).toMatch(
      /^[0-9a-f]{64}:[0-9a-f]{128}$/,
    );

    for (let i = 1; i < LOGIN_THROTTLE.perAddress; i++)
      await attempt(email, "anything", h, noAdmin);
    await expect(attempt(email, "anything", h, noAdmin)).resolves.toEqual(
      THROTTLED,
    );
  });

  it("behind the proxy, a forged first X-Forwarded-For hop doesn't escape the lock", async () => {
    const { email, address } = fresh();
    for (let i = 0; i < LOGIN_THROTTLE.perAddress; i++)
      await attempt(email, "wrong", {
        "x-forwarded-for": `10.9.9.${i}, ${address}`,
      });
    await expect(
      attempt(email, PASSWORD, { "x-forwarded-for": `10.8.8.8, ${address}` }),
    ).resolves.toEqual(THROTTLED);
  });

  it("logs failures and the lock without the password", async () => {
    const { email, address } = fresh();
    const secret = "hunter2-do-not-log";
    for (let i = 0; i < LOGIN_THROTTLE.perAddress + 2; i++)
      await attempt(email, secret, { "x-real-ip": address });

    const events = vi.mocked(log).mock.calls.map((c) => c[1]);
    expect(events).toContain("login_failed");
    expect(events).toContain("login_locked");
    expect(events).toContain("login_throttled");
    expect(JSON.stringify(vi.mocked(log).mock.calls)).not.toContain(secret);
  });
});
