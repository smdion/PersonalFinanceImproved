/**
 * Tests for the v0.5 sync-resilience helpers:
 *   - errors.ts (typed errors + retry-with-backoff)
 *   - idempotency.ts (deterministic key generation)
 *   - drift-detection.ts (broken-mapping + rename detection)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  BudgetApiError,
  classifyResponse,
  classifyThrown,
  backoffMs,
  retryWithBackoff,
  isResendable,
} from "@/lib/budget-api/errors";
import { transactionIdempotencyKey } from "@/lib/budget-api/idempotency";
import { detectDrift, hasDrift } from "@/lib/budget-api/drift-detection";
import type { BudgetAccount } from "@/lib/budget-api/types";
import type { AccountMapping } from "@/lib/db/schema";

// ── Errors ──────────────────────────────────────────────────────────

describe("classifyResponse", () => {
  function mockResponse(status: number, headers: Record<string, string> = {}) {
    return {
      status,
      headers: {
        get(key: string) {
          return headers[key.toLowerCase()] ?? null;
        },
      },
    } as Response;
  }

  it("classifies 401 as auth error", () => {
    const err = classifyResponse(mockResponse(401));
    expect(err.code).toBe("auth");
    expect(err.status).toBe(401);
    expect(err.isRetryable).toBe(false);
  });

  it("classifies 403 as auth error", () => {
    const err = classifyResponse(mockResponse(403));
    expect(err.code).toBe("auth");
  });

  it("classifies 429 as rate-limit and parses Retry-After (seconds)", () => {
    const err = classifyResponse(mockResponse(429, { "retry-after": "60" }));
    expect(err.code).toBe("rate-limit");
    expect(err.retryAfterSeconds).toBe(60);
    expect(err.isRetryable).toBe(true);
  });

  it("classifies 429 with HTTP-date Retry-After", () => {
    const future = new Date(Date.now() + 30_000).toUTCString();
    const err = classifyResponse(mockResponse(429, { "retry-after": future }));
    expect(err.code).toBe("rate-limit");
    expect(err.retryAfterSeconds).toBeGreaterThan(20);
    expect(err.retryAfterSeconds).toBeLessThanOrEqual(31);
  });

  it("classifies 5xx as server error (retryable)", () => {
    const err = classifyResponse(mockResponse(503));
    expect(err.code).toBe("server");
    expect(err.isRetryable).toBe(true);
  });

  it("classifies other 4xx as client error (not retryable)", () => {
    const err = classifyResponse(mockResponse(400));
    expect(err.code).toBe("client");
    expect(err.isRetryable).toBe(false);
  });

  it.each([
    [401, "Authentication failed (401)"],
    [400, "Client error (400)"],
    [502, "Upstream server error (502)"],
  ])("names %i by status alone, never the body", (status, message) => {
    expect(classifyResponse(mockResponse(status)).message).toBe(message);
  });
});

describe("classifyThrown", () => {
  it("preserves an existing BudgetApiError", () => {
    const original = new BudgetApiError("test", "auth", 401);
    expect(classifyThrown(original)).toBe(original);
  });

  it("classifies an AbortError as timeout", () => {
    const abortErr = new Error("timeout");
    abortErr.name = "AbortError";
    expect(classifyThrown(abortErr).code).toBe("timeout");
  });

  it("classifies fetch failures as network errors", () => {
    expect(classifyThrown(new TypeError("fetch failed")).code).toBe("network");
  });

  it("classifies unknowns", () => {
    expect(classifyThrown("plain string").code).toBe("unknown");
  });

  it("drops a URL's user name and password from the message", () => {
    const err = classifyThrown(
      new TypeError(
        "Request cannot be constructed from a URL that includes credentials: http://user:hunter2@actual.example.com:5006/v1",
      ),
    );
    expect(err.code).toBe("network");
    expect(err.message).not.toMatch(/user|hunter2/);
    expect(err.message).toContain("http://actual.example.com:5006/v1");
  });
});

describe("backoffMs", () => {
  it("doubles on each attempt", () => {
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
    expect(backoffMs(3)).toBe(4000);
    expect(backoffMs(4)).toBe(8000);
  });

  it("caps at maxMs", () => {
    expect(backoffMs(20, 5000)).toBe(5000);
  });
});

describe("retryWithBackoff", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("succeeds on first try if no error", async () => {
    let calls = 0;
    const result = await retryWithBackoff(async () => {
      calls++;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries on retryable errors, waiting 1s then 2s", async () => {
    let calls = 0;
    const done = retryWithBackoff(async () => {
      calls++;
      if (calls < 3) throw new BudgetApiError("server err", "server", 500);
      return "ok";
    }, 5);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(done).resolves.toBe("ok");
    expect(calls).toBe(3);
  });

  it("waits Retry-After seconds instead of the backoff on 429", async () => {
    let calls = 0;
    const done = retryWithBackoff(async () => {
      calls++;
      if (calls === 1)
        throw new BudgetApiError("slow down", "rate-limit", 429, 7);
      return "ok";
    });
    await vi.advanceTimersByTimeAsync(6999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(done).resolves.toBe("ok");
    expect(calls).toBe(2);
  });

  it("does not retry non-retryable (auth) errors", async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(async () => {
        calls++;
        throw new BudgetApiError("auth", "auth", 401);
      }),
    ).rejects.toThrow(/auth/);
    expect(calls).toBe(1);
  });

  it("gives up after maxAttempts", async () => {
    let calls = 0;
    const done = retryWithBackoff(async () => {
      calls++;
      throw new BudgetApiError("server", "server", 500);
    }, 2);
    const failed = expect(done).rejects.toThrow(/server/);
    await vi.runAllTimersAsync();
    await failed;
    expect(calls).toBe(2);
  });

  it("does not send again what canResend refuses", async () => {
    let calls = 0;
    const done = retryWithBackoff(
      async () => {
        calls++;
        throw new BudgetApiError("server", "server", 500);
      },
      3,
      () => false,
    );
    await expect(done).rejects.toThrow(/server/);
    expect(calls).toBe(1);
  });
});

describe("isResendable", () => {
  const err = (code: "server" | "timeout" | "network" | "rate-limit") =>
    new BudgetApiError(code, code, code === "server" ? 500 : null);

  it("a POST may have been applied: sent again only after a rate limit", () => {
    const post = { method: "POST" };
    expect(isResendable(err("timeout"), post)).toBe(false);
    expect(isResendable(err("server"), post)).toBe(false);
    expect(isResendable(err("network"), { method: "post" })).toBe(false);
    expect(isResendable(err("rate-limit"), post)).toBe(true);
  });

  it("reads, sets and deletes are harmless to repeat", () => {
    expect(isResendable(err("timeout"))).toBe(true);
    for (const method of ["GET", "PUT", "PATCH", "DELETE"])
      expect(isResendable(err("server"), { method })).toBe(true);
  });
});

// ── Idempotency ─────────────────────────────────────────────────────

describe("transactionIdempotencyKey", () => {
  it("produces the same key for the same fingerprint", () => {
    const fp = {
      importKey: "push-1",
      accountId: "acct-1",
      date: "2026-04-12",
      amount: -5000,
      payee: "Whole Foods",
      memo: "groceries",
    };
    expect(transactionIdempotencyKey(fp)).toBe(transactionIdempotencyKey(fp));
  });

  it("produces different keys for different pushes of the same transaction", () => {
    const fp = { accountId: "x", date: "2026-04-12", amount: -5000 };
    expect(transactionIdempotencyKey({ importKey: "push-1", ...fp })).not.toBe(
      transactionIdempotencyKey({ importKey: "push-2", ...fp }),
    );
  });

  it("produces different keys for different amounts", () => {
    const a = transactionIdempotencyKey({
      importKey: "push-1",
      accountId: "x",
      date: "2026-04-12",
      amount: -5000,
    });
    const b = transactionIdempotencyKey({
      importKey: "push-1",
      accountId: "x",
      date: "2026-04-12",
      amount: -5001,
    });
    expect(a).not.toBe(b);
  });

  it("produces different keys for different dates", () => {
    const a = transactionIdempotencyKey({
      importKey: "push-1",
      accountId: "x",
      date: "2026-04-12",
      amount: -5000,
    });
    const b = transactionIdempotencyKey({
      importKey: "push-1",
      accountId: "x",
      date: "2026-04-13",
      amount: -5000,
    });
    expect(a).not.toBe(b);
  });

  it("treats null and undefined memo equivalently", () => {
    const a = transactionIdempotencyKey({
      importKey: "push-1",
      accountId: "x",
      date: "d",
      amount: 1,
      memo: null,
    });
    const b = transactionIdempotencyKey({
      importKey: "push-1",
      accountId: "x",
      date: "d",
      amount: 1,
      memo: undefined,
    });
    expect(a).toBe(b);
  });

  it("produces base64url-safe output (no +/= chars)", () => {
    const k = transactionIdempotencyKey({
      importKey: "push-1",
      accountId: "abc",
      date: "2026-04-12",
      amount: 1,
    });
    expect(k).not.toMatch(/[+/=]/);
  });
});

// ── Drift detection ─────────────────────────────────────────────────

describe("detectDrift", () => {
  const account = (
    id: string,
    name: string,
    overrides: Partial<BudgetAccount> = {},
  ): BudgetAccount => ({
    id,
    name,
    balance: 1000,
    clearedBalance: 1000,
    onBudget: true,
    closed: false,
    type: "checking",
    ...overrides,
  });

  const mapping = (remoteAccountId: string): AccountMapping => ({
    remoteAccountId,
    localName: "Local",
    syncDirection: "pull",
  });

  it("returns empty report when nothing changed", () => {
    const accounts = [account("a", "Checking"), account("b", "Savings")];
    const r = detectDrift(accounts, accounts, [mapping("a"), mapping("b")]);
    expect(r.brokenMappings).toEqual([]);
    expect(r.renamedAccounts).toEqual([]);
    expect(r.newRemoteAccounts).toEqual([]);
    expect(hasDrift(r)).toBe(false);
  });

  it("detects deleted remote account", () => {
    const cached = [account("a", "Checking"), account("b", "Savings")];
    const updated = [account("a", "Checking")];
    const r = detectDrift(cached, updated, [mapping("a"), mapping("b")]);
    expect(r.brokenMappings.length).toBe(1);
    expect(r.brokenMappings[0]?.remoteAccountId).toBe("b");
    expect(r.brokenMappings[0]?.lastKnownName).toBe("Savings");
    expect(hasDrift(r)).toBe(true);
  });

  it("detects renamed remote account", () => {
    const cached = [account("a", "Checking")];
    const updated = [account("a", "Main Checking")];
    const r = detectDrift(cached, updated, [mapping("a")]);
    expect(r.renamedAccounts.length).toBe(1);
    expect(r.renamedAccounts[0]?.oldName).toBe("Checking");
    expect(r.renamedAccounts[0]?.newName).toBe("Main Checking");
  });

  it("detects newly-added remote accounts", () => {
    const cached = [account("a", "Checking")];
    const updated = [account("a", "Checking"), account("c", "New Account")];
    const r = detectDrift(cached, updated, [mapping("a")]);
    expect(r.newRemoteAccounts.length).toBe(1);
    expect(r.newRemoteAccounts[0]?.name).toBe("New Account");
  });

  it("only flags mappings, not unmapped deletions", () => {
    const cached = [account("a", "Checking"), account("b", "Savings")];
    const updated = [account("a", "Checking")];
    // No mapping for "b" — so its disappearance isn't a "broken mapping"
    const r = detectDrift(cached, updated, [mapping("a")]);
    expect(r.brokenMappings).toEqual([]);
  });
});
