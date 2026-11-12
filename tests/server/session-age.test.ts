/**
 * Sessions end 4 hours after sign-in, however active (owner SA1), so an
 * Authentik group change reaches everyone within 4 hours. The proxy
 * re-issues the cookie on every page request, so the cookie's maxAge alone
 * only caps idle time; `loginAt` in the token caps the whole session.
 */
import { describe, it, expect } from "vitest";
import {
  authConfig,
  capSessionAge,
  SESSION_MAX_AGE_SECONDS,
} from "@/server/auth.config";

const HOUR = 60 * 60 * 1000;
const signIn = 1_800_000_000_000;

describe("session age", () => {
  it("the cookie and the token last 4 hours idle (one value for the proxy and auth.ts)", () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(4 * 60 * 60);
    expect(authConfig.session).toEqual({
      strategy: "jwt",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
  });

  it("stamps the sign-in time", () => {
    expect(capSessionAge({ sub: "a" }, true, signIn)).toEqual({
      sub: "a",
      loginAt: signIn,
    });
  });

  it("keeps an active session until 4 hours after sign-in, then ends it however recent the last request", () => {
    const token = capSessionAge({ sub: "a" }, true, signIn)!;
    let now = signIn;
    // A request every 30 minutes: never idle, still capped.
    while (now < signIn + 4 * HOUR - 30 * 60 * 1000) {
      now += 30 * 60 * 1000;
      expect(capSessionAge(token, false, now)).toEqual(token);
    }
    expect(capSessionAge(token, false, signIn + 4 * HOUR)).toBeNull();
    expect(capSessionAge(token, false, signIn + 5 * HOUR)).toBeNull();
  });

  it("ends a token from before the cap, which has no sign-in time", () => {
    expect(capSessionAge({ sub: "a" }, false, signIn)).toBeNull();
  });

  it("the edge config's jwt callback applies it, so the proxy's refresh does too", async () => {
    const jwt = authConfig.callbacks?.jwt;
    expect(jwt).toBeDefined();
    const stale = { sub: "a", loginAt: Date.now() - 5 * HOUR };
    expect(await jwt!({ token: stale, account: null } as never)).toBeNull();
    const fresh = { sub: "a", loginAt: Date.now() - HOUR };
    expect(await jwt!({ token: fresh, account: null } as never)).toEqual(fresh);
  });
});
