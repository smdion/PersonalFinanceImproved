/**
 * Scheduled jobs' last results (/api/health/detailed) and the alert webhook:
 * a post when a job starts failing, a reminder each 24 h of runs that still
 * fail, one when it recovers, never one per failed retry; a
 * webhook that fails never fails the job.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { log } = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/lib/logger", () => ({ log }));

import {
  lastJobResults,
  recordJobResult,
} from "@/server/services/scheduled-job-results";

const STARTED_AT = new Date("2031-04-15T07:00:00.000Z");
const WEBHOOK = "https://alerts.example.com/hook";
const FAILED = { ok: false, message: "Unexpected response (HTTP 500)" };
const OK = { ok: true, message: "SimpleFIN synced" };

const hoursLater = (hours: number) =>
  new Date(STARTED_AT.getTime() + hours * 60 * 60 * 1000);

/** Let the fire-and-forget alert settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A stubbed webhook; returns the bodies it was posted. */
function stubWebhook(
  response: Promise<Response> = Promise.resolve(new Response(null)),
) {
  vi.stubEnv("LEDGR_ALERT_WEBHOOK_URL", WEBHOOK);
  const fetchMock = vi.fn<(url: URL, init: RequestInit) => Promise<Response>>(
    () => response,
  );
  vi.stubGlobal("fetch", fetchMock);
  const posts = () =>
    fetchMock.mock.calls.map((call) => {
      const [, init] = call;
      return JSON.parse(init.body as string) as Record<string, unknown>;
    });
  return { fetchMock, posts };
}

beforeEach(() => {
  globalThis.ledgrScheduledJobs = undefined;
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
    recordJobResult("sec_refresh", STARTED_AT, FAILED);
    recordJobResult("tax_data_check", STARTED_AT, {
      ok: true,
      message: "Tax data checked",
    });

    expect(lastJobResults()).toEqual({
      sec_refresh: { ...FAILED, startedAt: "2031-04-15T07:00:00.000Z" },
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
    recordJobResult("simplefin_sync", STARTED_AT, FAILED);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the first failure's job, time and message, and nothing for an ok run", async () => {
    const { fetchMock, posts } = stubWebhook();

    recordJobResult("version_snapshot", STARTED_AT, {
      ok: true,
      message: "Version snapshot saved",
    });
    recordJobResult("simplefin_sync", STARTED_AT, FAILED);
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(WEBHOOK);
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(posts()).toEqual([
      {
        source: "ledgr",
        job: "simplefin_sync",
        event: "failed",
        ok: false,
        message: "Unexpected response (HTTP 500)",
        startedAt: "2031-04-15T07:00:00.000Z",
      },
    ]);
  });

  it("stays quiet for failed retries inside 24 h of the last post", async () => {
    const { posts } = stubWebhook();
    for (const hours of [0, 1, 12, 23.9])
      recordJobResult("simplefin_sync", hoursLater(hours), FAILED);
    await settle();
    expect(posts().map((p) => p.event)).toEqual(["failed"]);
  });

  it("reminds once 24 h of runs after the last post still fail, then waits again", async () => {
    const { posts } = stubWebhook();
    for (const hours of [0, 23, 24, 30, 47.9, 48])
      recordJobResult("simplefin_sync", hoursLater(hours), FAILED);
    await settle();
    expect(posts().map((p) => [p.event, p.startedAt])).toEqual([
      ["failed", "2031-04-15T07:00:00.000Z"],
      ["still_failing", "2031-04-16T07:00:00.000Z"],
      ["still_failing", "2031-04-17T07:00:00.000Z"],
    ]);
  });

  it("posts one recovery when a failing job next succeeds, then a new failure is first again", async () => {
    const { posts } = stubWebhook();
    recordJobResult("sec_refresh", hoursLater(0), FAILED);
    recordJobResult("sec_refresh", hoursLater(1), OK);
    recordJobResult("sec_refresh", hoursLater(2), OK);
    recordJobResult("sec_refresh", hoursLater(3), FAILED);
    await settle();
    expect(posts().map((p) => [p.event, p.ok])).toEqual([
      ["failed", false],
      ["recovered", true],
      ["failed", false],
    ]);
  });

  it("tracks each job on its own", async () => {
    const { posts } = stubWebhook();
    recordJobResult("sec_refresh", hoursLater(0), FAILED);
    recordJobResult("tax_data_check", hoursLater(1), FAILED);
    recordJobResult("tax_data_check", hoursLater(2), OK);
    await settle();
    expect(posts().map((p) => [p.job, p.event])).toEqual([
      ["sec_refresh", "failed"],
      ["tax_data_check", "failed"],
      ["tax_data_check", "recovered"],
    ]);
  });

  it("logs a failed POST once and never throws into the job", async () => {
    const { fetchMock } = stubWebhook(
      Promise.reject(new Error("connect refused")),
    );

    expect(() =>
      recordJobResult("sec_refresh", STARTED_AT, FAILED),
    ).not.toThrow();
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("warn", "job_alert_failed", {
      job: "sec_refresh",
      error: "connect refused",
    });
    expect(lastJobResults().sec_refresh?.ok).toBe(false);
  });

  it("logs a webhook that answers with an error status", async () => {
    stubWebhook(Promise.resolve(new Response(null, { status: 404 })));

    recordJobResult("tax_data_check", STARTED_AT, FAILED);
    await settle();

    expect(log).toHaveBeenCalledWith("warn", "job_alert_failed", {
      job: "tax_data_check",
      status: 404,
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
});
