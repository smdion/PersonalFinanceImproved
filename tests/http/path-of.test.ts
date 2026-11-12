/**
 * pathOf (src/lib/http/external-request.ts): a value read from storage or a
 * response is one path segment or query value of a service's request.
 */
import { describe, it, expect } from "vitest";
import { pathOf } from "@/lib/http/external-request";

describe("pathOf", () => {
  it("encodes each value, so it can't add a segment, a query or a fragment", () => {
    const id = "a/b?c=1#d";
    expect(pathOf`/accounts/${id}/balance`).toBe(
      "/accounts/a%2Fb%3Fc%3D1%23d/balance",
    );
    expect(pathOf`/list?since_date=${"2026-10-01"}&until_date=${"x&y=z"}`).toBe(
      "/list?since_date=2026-10-01&until_date=x%26y%3Dz",
    );
  });

  it("leaves a plain id and the literal parts as written", () => {
    expect(pathOf`/months/${"2026-11-01"}/categories/${42}`).toBe(
      "/months/2026-11-01/categories/42",
    );
  });

  it("refuses an empty value, which would drop a segment of the path", () => {
    expect(() => pathOf`/accounts/${""}/balance`).toThrow(/request path value/);
  });

  it('refuses "." and "..", which a URL would resolve to another path', () => {
    expect(() => pathOf`/transactions/${".."}`).toThrow(/request path value/);
    expect(() => pathOf`/transactions/${"."}`).toThrow(/request path value/);
  });
});
