import "../routers/setup-mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  describe("TRUSTED_PROXY_HEADER", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });
    const both = {
      "x-real-ip": "203.0.113.9",
      "x-forwarded-for": "6.6.6.6, 198.51.100.7",
    };

    it("unset: X-Real-IP, then the last X-Forwarded-For hop (today's default)", () => {
      vi.stubEnv("TRUSTED_PROXY_HEADER", undefined);
      expect(clientAddress(from(both))).toBe("203.0.113.9");
      expect(
        clientAddress(from({ "x-forwarded-for": "6.6.6.6, 198.51.100.7" })),
      ).toBe("198.51.100.7");
    });

    it("x-real-ip: only X-Real-IP; X-Forwarded-For is ignored", () => {
      vi.stubEnv("TRUSTED_PROXY_HEADER", "x-real-ip");
      expect(clientAddress(from(both))).toBe("203.0.113.9");
      expect(clientAddress(from({ "x-forwarded-for": "198.51.100.7" }))).toBe(
        "unknown",
      );
    });

    it("x-forwarded-for: only its last hop; a client-sent X-Real-IP is ignored", () => {
      vi.stubEnv("TRUSTED_PROXY_HEADER", "x-forwarded-for");
      expect(clientAddress(from(both))).toBe("198.51.100.7");
    });

    it("none: no header picks the bucket; every visitor shares one", () => {
      vi.stubEnv("TRUSTED_PROXY_HEADER", "none");
      expect(clientAddress(from(both))).toBe("unknown");
      expect(clientAddress(from({ "x-real-ip": "1.2.3.4" }))).toBe("unknown");
    });
  });
});
