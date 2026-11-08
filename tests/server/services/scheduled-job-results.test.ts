import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { log } = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/lib/logger", () => ({ log }));

import {
  lastJobResults,
  recordJobResult,
} from "@/server/services/scheduled-job-results";

const STARTED_AT = new Date("2031-04-15T07:00:00.000Z");
const WEBHOOK = "https://alerts.example.com/hook";

/** Let the fire-and-forget alert settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  globalThis.ledgrScheduledJobResults = undefined;
  log.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("scheduled job results", () => {
  it("is empty until a job records a run", () => {
    expect(lastJobResults()).toEqual({});
  });

  it("keeps each job's last result with the run's start time", () => {
    recordJobResult("sec_refresh", STARTED_AT, { ok: true, message: "Ran" });
    recordJobResult("sec_refresh", STARTED_AT, {
      ok: false,
      message: "Unexpected response (HTTP 500)",
    });
    recordJobResult("tax_data_check", STARTED_AT, {
      ok: true,
      message: "Tax data checked",
    });

    expect(lastJobResults()).toEqual({
      sec_refresh: {
        ok: false,
        message: "Unexpected response (HTTP 500)",
        startedAt: "2031-04-15T07:00:00.000Z",
      },
      tax_data_check: {
        ok: true,
        message: "Tax data checked",
        startedAt: "2031-04-15T07:00:00.000Z",
      },
    });
  });
});

describe("the alert webhook", () => {
  it("posts nothing when no URL is set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    recordJobResult("simplefin_sync", STARTED_AT, {
      ok: false,
      message: "Request failed: fetch failed",
    });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a failed run's job, time and message, and nothing for an ok run", async () => {
    vi.stubEnv("LEDGR_ALERT_WEBHOOK_URL", WEBHOOK);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", fetchMock);

    recordJobResult("version_snapshot", STARTED_AT, {
      ok: true,
      message: "Version snapshot saved",
    });
    recordJobResult("simplefin_sync", STARTED_AT, {
      ok: false,
      message: "Unexpected response (HTTP 500)",
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe(WEBHOOK);
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({
      source: "ledgr",
      job: "simplefin_sync",
      ok: false,
      message: "Unexpected response (HTTP 500)",
      startedAt: "2031-04-15T07:00:00.000Z",
    });
  });

  it("logs a failed POST once and never throws into the job", async () => {
    vi.stubEnv("LEDGR_ALERT_WEBHOOK_URL", WEBHOOK);
    const fetchMock = vi.fn().mockRejectedValue(new Error("connect refused"));
    vi.stubGlobal("fetch", fetchMock);

    expect(() =>
      recordJobResult("sec_refresh", STARTED_AT, {
        ok: false,
        message: "Request failed: fetch failed",
      }),
    ).not.toThrow();
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("warn", "job_alert_failed", {
      job: "sec_refresh",
      error: "connect refused",
    });
  });

  it("sends nothing to a URL that isn't http or https, and says so once", async () => {
    vi.stubEnv("LEDGR_ALERT_WEBHOOK_URL", "ftp://alerts.example.com/hook");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const job of ["sec_refresh", "tax_data_check"] as const)
      recordJobResult(job, STARTED_AT, { ok: false, message: "Failed" });
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("warn", "job_alert_url_refused", {
      reason: "LEDGR_ALERT_WEBHOOK_URL is not an http or https URL",
    });
  });

  it("logs a webhook that answers with an error status", async () => {
    vi.stubEnv("LEDGR_ALERT_WEBHOOK_URL", WEBHOOK);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );

    recordJobResult("tax_data_check", STARTED_AT, {
      ok: false,
      message: "Unexpected response (HTTP 500)",
    });
    await settle();

    expect(log).toHaveBeenCalledWith("warn", "job_alert_failed", {
      job: "tax_data_check",
      status: 404,
    });
  });
});
