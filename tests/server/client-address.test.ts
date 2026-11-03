import "../routers/setup-mocks";
import { describe, expect, it } from "vitest";
import { clientAddress } from "@/lib/client-address";

const from = (h: Record<string, string>) => (name: string) => h[name] ?? null;

describe("clientAddress", () => {
  it("trusts X-Real-IP, which the proxy sets from the connection", () => {
    expect(
      clientAddress(
        from({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4" }),
      ),
    ).toBe("203.0.113.9");
  });

  it("a forged first X-Forwarded-For hop doesn't choose the bucket", () => {
    expect(
      clientAddress(from({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" })),
    ).toBe("203.0.113.9");
  });

  it("one hop (no proxy in front, as in CI) is that hop", () => {
    expect(clientAddress(from({ "x-forwarded-for": "10.1.2.3" }))).toBe(
      "10.1.2.3",
    );
  });

  it("no headers: unknown", () => {
    expect(clientAddress(from({}))).toBe("unknown");
  });
});
