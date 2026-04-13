/**
 * Tests for src/lib/url-safety.ts — SSRF protection for outbound URLs.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateOutboundUrl, isOutboundUrlSafe } from "@/lib/url-safety";

let originalAllowlist: string | undefined;

beforeEach(() => {
  originalAllowlist = process.env.ALLOWED_ACTUAL_HOSTS;
  delete process.env.ALLOWED_ACTUAL_HOSTS;
});

afterEach(() => {
  if (originalAllowlist === undefined) delete process.env.ALLOWED_ACTUAL_HOSTS;
  else process.env.ALLOWED_ACTUAL_HOSTS = originalAllowlist;
});

describe("validateOutboundUrl — public hosts", () => {
  it("accepts a normal https URL", () => {
    expect(validateOutboundUrl("https://api.example.com").ok).toBe(true);
  });

  it("accepts http on a public host", () => {
    expect(validateOutboundUrl("http://api.example.com:8080/path").ok).toBe(
      true,
    );
  });

  it("accepts a public IPv4", () => {
    expect(validateOutboundUrl("https://8.8.8.8").ok).toBe(true);
  });
});

describe("validateOutboundUrl — rejects unsafe schemes", () => {
  it("rejects file://", () => {
    const r = validateOutboundUrl("file:///etc/passwd");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/scheme/);
  });

  it("rejects gopher://", () => {
    expect(validateOutboundUrl("gopher://example.com").ok).toBe(false);
  });

  it("rejects javascript: URLs", () => {
    expect(validateOutboundUrl("javascript:alert(1)").ok).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(validateOutboundUrl("not a url").ok).toBe(false);
  });
});

describe("validateOutboundUrl — rejects localhost names", () => {
  it("rejects localhost", () => {
    const r = validateOutboundUrl("http://localhost:5006");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/localhost/i);
  });

  it("rejects *.localhost", () => {
    expect(validateOutboundUrl("http://app.localhost").ok).toBe(false);
  });
});

describe("validateOutboundUrl — rejects RFC1918 + loopback IPv4", () => {
  it.each([
    "http://127.0.0.1",
    "http://127.1.2.3",
    "http://10.0.0.1",
    "http://10.255.255.254",
    "http://192.168.1.1",
    "http://172.16.0.1",
    "http://172.31.255.254",
    "http://169.254.169.254", // AWS metadata endpoint!
    "http://0.0.0.0",
    "http://100.64.0.1", // CGNAT
  ])("rejects %s", (url) => {
    const r = validateOutboundUrl(url);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/private|localhost|metadata|RFC1918/i);
  });

  it("does NOT reject 11.x or 172.32.x (outside RFC1918 ranges)", () => {
    expect(validateOutboundUrl("http://11.1.1.1").ok).toBe(true);
    expect(validateOutboundUrl("http://172.32.0.1").ok).toBe(true);
  });
});

describe("validateOutboundUrl — rejects private IPv6", () => {
  it("rejects ::1 (loopback)", () => {
    expect(validateOutboundUrl("http://[::1]:8080").ok).toBe(false);
  });

  it("rejects fc00:: (ULA)", () => {
    expect(validateOutboundUrl("http://[fc00::1]").ok).toBe(false);
  });

  it("rejects fe80:: (link-local)", () => {
    expect(validateOutboundUrl("http://[fe80::1]").ok).toBe(false);
  });
});

describe("validateOutboundUrl — ALLOWED_ACTUAL_HOSTS allowlist", () => {
  it("permits an allowlisted private IP", () => {
    process.env.ALLOWED_ACTUAL_HOSTS = "10.10.10.50";
    expect(validateOutboundUrl("http://10.10.10.50:5006").ok).toBe(true);
  });

  it("permits an allowlisted localhost", () => {
    process.env.ALLOWED_ACTUAL_HOSTS = "localhost";
    expect(validateOutboundUrl("http://localhost:5006").ok).toBe(true);
  });

  it("permits multiple comma-separated entries", () => {
    process.env.ALLOWED_ACTUAL_HOSTS = "10.10.10.50, actual.lan ,127.0.0.1";
    expect(validateOutboundUrl("http://actual.lan").ok).toBe(true);
    expect(validateOutboundUrl("http://127.0.0.1").ok).toBe(true);
    expect(validateOutboundUrl("http://10.10.10.50").ok).toBe(true);
  });

  it("does not permit non-allowlisted private hosts", () => {
    process.env.ALLOWED_ACTUAL_HOSTS = "10.10.10.50";
    expect(validateOutboundUrl("http://10.10.10.51").ok).toBe(false);
  });
});

describe("isOutboundUrlSafe (boolean shortcut)", () => {
  it("returns true for public", () => {
    expect(isOutboundUrlSafe("https://example.com")).toBe(true);
  });
  it("returns false for private", () => {
    expect(isOutboundUrlSafe("http://10.0.0.1")).toBe(false);
  });
});
