import { describe, it, expect, vi, afterEach } from "vitest";

describe("dialect detection", () => {
  const originalUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalUrl !== undefined) {
      process.env.DATABASE_URL = originalUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
    vi.resetModules();
  });

  it("detects postgresql:// as postgresql", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    const mod = await import("@/lib/db/dialect");
    expect(mod.getDialect()).toBe("postgresql");
    expect(mod.isPostgres()).toBe(true);
    expect(mod.isSQLite()).toBe(false);
  });

  it("detects postgres:// as postgresql", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    const mod = await import("@/lib/db/dialect");
    expect(mod.getDialect()).toBe("postgresql");
    expect(mod.isPostgres()).toBe(true);
  });

  it("defaults to sqlite when DATABASE_URL is absent", async () => {
    delete process.env.DATABASE_URL;
    const mod = await import("@/lib/db/dialect");
    expect(mod.getDialect()).toBe("sqlite");
    expect(mod.isPostgres()).toBe(false);
    expect(mod.isSQLite()).toBe(true);
  });

  it("defaults to sqlite for non-postgres URLs", async () => {
    process.env.DATABASE_URL = "mysql://user:pass@localhost:3306/db";
    const mod = await import("@/lib/db/dialect");
    expect(mod.getDialect()).toBe("sqlite");
  });

  it("defaults to sqlite for empty string", async () => {
    process.env.DATABASE_URL = "";
    const mod = await import("@/lib/db/dialect");
    expect(mod.getDialect()).toBe("sqlite");
  });
});
