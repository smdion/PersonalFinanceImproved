/**
 * T3 — src/lib/auth/cron.ts had zero direct test coverage despite being the
 * shared auth primitive for every cron/internal-endpoint route
 * (startup, versions/daily, simplefin/daily, tax-data/weekly, sec/weekly,
 * health/detailed). All six routes are unauthenticated-by-default except
 * for this header check, so a bug here is a real auth-bypass surface, not
 * just a missing-test nit.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const log = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logger", () => ({ log, logWarnOnce: vi.fn() }));
import {
  getValidCronSecret,
  timingSafeSecretMatch,
  validateCronHeaderRequest,
  validateCronBearerRequest,
  cronRoute,
} from "@/lib/auth/cron";

const ORIGINAL_ENV = { ...process.env };
const VALID_SECRET = "a".repeat(32);

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("getValidCronSecret", () => {
  it("returns null when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    expect(getValidCronSecret()).toBeNull();
  });

  it("returns null when CRON_SECRET is shorter than 32 characters", () => {
    process.env.CRON_SECRET = "a".repeat(31);
    expect(getValidCronSecret()).toBeNull();
  });

  it("returns the secret when it's exactly 32 characters", () => {
    process.env.CRON_SECRET = VALID_SECRET;
    expect(getValidCronSecret()).toBe(VALID_SECRET);
  });

  it("returns the secret when longer than 32 characters", () => {
    process.env.CRON_SECRET = "a".repeat(64);
    expect(getValidCronSecret()).toBe("a".repeat(64));
  });
});

describe("timingSafeSecretMatch", () => {
  it("returns true for a matching secret", () => {
    expect(timingSafeSecretMatch(VALID_SECRET, VALID_SECRET)).toBe(true);
  });

  it("returns false for a non-matching secret of the same length", () => {
    expect(timingSafeSecretMatch("b".repeat(32), VALID_SECRET)).toBe(false);
  });

  it("returns false (not throw) for a different-length provided value", () => {
    expect(timingSafeSecretMatch("short", VALID_SECRET)).toBe(false);
  });

  it("returns false when provided is null", () => {
    expect(timingSafeSecretMatch(null, VALID_SECRET)).toBe(false);
  });
});

describe("validateCronHeaderRequest (X-Cron-Secret)", () => {
  it("reports misconfigured when CRON_SECRET is not configured, even with a header present", () => {
    delete process.env.CRON_SECRET;
    const request = new Request("http://localhost/api/versions/daily", {
      headers: { "X-Cron-Secret": VALID_SECRET },
    });
    expect(validateCronHeaderRequest(request)).toBe("misconfigured");
  });

  it("reports misconfigured when CRON_SECRET is shorter than 32 characters", () => {
    process.env.CRON_SECRET = "a".repeat(31);
    const request = new Request("http://localhost/api/versions/daily", {
      headers: { "X-Cron-Secret": "a".repeat(31) },
    });
    expect(validateCronHeaderRequest(request)).toBe("misconfigured");
  });

  it("reports unauthorized for a request with no X-Cron-Secret header", () => {
    process.env.CRON_SECRET = VALID_SECRET;
    const request = new Request("http://localhost/api/versions/daily");
    expect(validateCronHeaderRequest(request)).toBe("unauthorized");
  });

  it("reports unauthorized for the wrong X-Cron-Secret header", () => {
    process.env.CRON_SECRET = VALID_SECRET;
    const request = new Request("http://localhost/api/versions/daily", {
      headers: { "X-Cron-Secret": "wrong-secret-wrong-secret-wrong" },
    });
    expect(validateCronHeaderRequest(request)).toBe("unauthorized");
  });

  it("reports ok for the correct X-Cron-Secret header", () => {
    process.env.CRON_SECRET = VALID_SECRET;
    const request = new Request("http://localhost/api/versions/daily", {
      headers: { "X-Cron-Secret": VALID_SECRET },
    });
    expect(validateCronHeaderRequest(request)).toBe("ok");
  });
});

describe("validateCronBearerRequest (Authorization: Bearer, health/detailed)", () => {
  it("rejects when CRON_SECRET is not configured", () => {
    delete process.env.CRON_SECRET;
    const request = new Request("http://localhost/api/health/detailed", {
      headers: { Authorization: `Bearer ${VALID_SECRET}` },
    });
    expect(validateCronBearerRequest(request)).toBe(false);
  });

  it("rejects a request with no Authorization header", () => {
    process.env.CRON_SECRET = VALID_SECRET;
    const request = new Request("http://localhost/api/health/detailed");
    expect(validateCronBearerRequest(request)).toBe(false);
  });

  it("rejects a malformed Authorization header (missing Bearer prefix)", () => {
    process.env.CRON_SECRET = VALID_SECRET;
    const request = new Request("http://localhost/api/health/detailed", {
      headers: { Authorization: VALID_SECRET },
    });
    expect(validateCronBearerRequest(request)).toBe(false);
  });

  it("rejects a request with the wrong bearer token", () => {
    process.env.CRON_SECRET = VALID_SECRET;
    const request = new Request("http://localhost/api/health/detailed", {
      headers: { Authorization: "Bearer wrong-secret-wrong-secret-wrong" },
    });
    expect(validateCronBearerRequest(request)).toBe(false);
  });

  it("accepts a request with the correct bearer token", () => {
    process.env.CRON_SECRET = VALID_SECRET;
    const request = new Request("http://localhost/api/health/detailed", {
      headers: { Authorization: `Bearer ${VALID_SECRET}` },
    });
    expect(validateCronBearerRequest(request)).toBe(true);
  });
});

describe("cronRoute", () => {
  const run = vi.fn(() => Promise.resolve(new Response("done")));
  const call = (header?: string) =>
    cronRoute(
      new Request("http://localhost/api/versions/daily", {
        headers: header ? { "X-Cron-Secret": header } : {},
      }),
      run,
    );

  beforeEach(() => {
    log.mockClear();
    run.mockClear();
  });

  it("answers 500 and logs when CRON_SECRET is too short", async () => {
    process.env.CRON_SECRET = "a".repeat(31);
    const res = await call("a".repeat(31));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Server misconfiguration" });
    expect(log).toHaveBeenCalledWith("error", "cron_secret_misconfigured", {
      message: "CRON_SECRET is missing or too short",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("answers 500 and logs when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const res = await call(VALID_SECRET);
    expect(res.status).toBe(500);
    expect(log).toHaveBeenCalledWith("error", "cron_secret_misconfigured", {
      message: "CRON_SECRET is missing or too short",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("answers 401 for a wrong or absent header, without a log", async () => {
    process.env.CRON_SECRET = VALID_SECRET;
    for (const header of ["b".repeat(32), undefined]) {
      const res = await call(header);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    }
    expect(log).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the work and returns its response for the right header", async () => {
    process.env.CRON_SECRET = VALID_SECRET;
    const res = await call(VALID_SECRET);
    expect(await res.text()).toBe("done");
    expect(run).toHaveBeenCalledTimes(1);
  });
});
