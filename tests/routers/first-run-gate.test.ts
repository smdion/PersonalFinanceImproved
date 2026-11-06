/**
 * The first-admin gate after Reset all data, a restore or an import
 * (settleFirstRunGate): closed while a way to sign in remains (a local
 * admin, or Authentik), otherwise open as on a fresh install, so a backup
 * with no admin can't lock the household out.
 */
import "./setup-mocks";
import { describe, it, expect, afterEach, vi } from "vitest";
import { createTestCaller, seedPerson } from "./setup";
import * as schema from "@/lib/db/schema-sqlite";
import { log } from "@/lib/logger";
import { settleFirstRunGate } from "@/server/data/first-run";

vi.mock("@/lib/logger", () => ({ log: vi.fn() }));

type Ctx = Awaited<ReturnType<typeof createTestCaller>>;

const onboardingFlag = (ctx: Ctx) =>
  ctx.db
    .select()
    .from(schema.appSettings)
    .all()
    .find((s) => s.key === "onboarding_completed")?.value;

function seedLocalAdmin(ctx: Ctx) {
  ctx.db
    .insert(schema.localAdmins)
    .values({ email: "admin@test.local", passwordHash: "hash", name: "A" })
    .run();
}

async function withCtx(fn: (ctx: Ctx) => Promise<void>) {
  const ctx = await createTestCaller();
  try {
    await fn(ctx);
  } finally {
    ctx.cleanup();
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(log).mockClear();
});

describe("settleFirstRunGate", () => {
  it("closes the gate while a local admin exists", () =>
    withCtx(async (ctx) => {
      seedLocalAdmin(ctx);
      await settleFirstRunGate(ctx.rawDb, "restore");
      expect(onboardingFlag(ctx)).toBe(true);
      expect(await ctx.caller.settings.firstRunState()).toEqual({
        adminNeeded: false,
      });
    }));

  it("closes the gate when Authentik is configured, with no local admin", () =>
    withCtx(async (ctx) => {
      vi.stubEnv("AUTH_AUTHENTIK_ISSUER", "https://auth.example.test/o/ledgr/");
      await settleFirstRunGate(ctx.rawDb, "import");
      expect(onboardingFlag(ctx)).toBe(true);
      expect(await ctx.caller.settings.firstRunState()).toEqual({
        adminNeeded: false,
      });
    }));

  it("leaves it open, even with people, when no way to sign in remains", () =>
    withCtx(async (ctx) => {
      vi.stubEnv("AUTH_AUTHENTIK_ISSUER", "");
      await seedPerson(ctx.db, "Robin");
      await settleFirstRunGate(ctx.rawDb, "import");
      expect(onboardingFlag(ctx)).toBe(false);
      expect(await ctx.caller.settings.firstRunState()).toEqual({
        adminNeeded: true,
      });
      // The household is still onboarded: no wizard.
      expect(await ctx.caller.settings.isOnboardingComplete()).toEqual({
        complete: true,
      });
      expect(log).toHaveBeenCalledWith(
        "warn",
        "first_admin_gate_open",
        expect.objectContaining({ after: "import" }),
      );
    }));
});

describe("after Reset all data", () => {
  it("is closed while the local admin survives the reset", () =>
    withCtx(async (ctx) => {
      seedLocalAdmin(ctx);
      await ctx.caller.version.resetAllData({ confirmation: "delete" });
      expect(onboardingFlag(ctx)).toBe(true);
    }));

  it("is open with no local admin and no Authentik", () =>
    withCtx(async (ctx) => {
      vi.stubEnv("AUTH_AUTHENTIK_ISSUER", "");
      ctx.db
        .insert(schema.appSettings)
        .values({ key: "onboarding_completed", value: true })
        .run();
      await ctx.caller.version.resetAllData({ confirmation: "delete" });
      expect(await ctx.caller.settings.firstRunState()).toEqual({
        adminNeeded: true,
      });
    }));
});

describe("after a restore", () => {
  it("is open when the restored version has no local admin and no Authentik", () =>
    withCtx(async (ctx) => {
      vi.stubEnv("AUTH_AUTHENTIK_ISSUER", "");
      await seedPerson(ctx.db, "Robin");
      const version = await ctx.caller.version.create({ name: "no admin" });
      seedLocalAdmin(ctx);
      await ctx.caller.version.restore({ id: version.id });
      expect(ctx.db.select().from(schema.localAdmins).all()).toHaveLength(0);
      expect(await ctx.caller.settings.firstRunState()).toEqual({
        adminNeeded: true,
      });
    }));

  it("is closed when the restored version holds a local admin", () =>
    withCtx(async (ctx) => {
      seedLocalAdmin(ctx);
      await seedPerson(ctx.db, "Robin");
      const version = await ctx.caller.version.create({ name: "admin" });
      await ctx.caller.version.restore({ id: version.id });
      expect(onboardingFlag(ctx)).toBe(true);
      expect(await ctx.caller.settings.firstRunState()).toEqual({
        adminNeeded: false,
      });
    }));
});
