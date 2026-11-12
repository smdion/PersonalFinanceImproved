/**
 * A DEMO_ONLY server reads only a demo profile's data (src/server/trpc.ts's
 * demo-only guard): with no demo profile chosen, every procedure but demo.*
 * is refused, so nothing reads the database's own tables. `isDemoOnly` is
 * read at module load, so each case imports a fresh module.
 */
import "../routers/setup-mocks";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Context } from "@/server/trpc";

const log = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logger", async (original) => ({
  ...(await original<typeof import("@/lib/logger")>()),
  log,
}));

const originalDemoOnly = process.env.DEMO_ONLY;

afterEach(() => {
  if (originalDemoOnly !== undefined) process.env.DEMO_ONLY = originalDemoOnly;
  else delete process.env.DEMO_ONLY;
  vi.resetModules();
});

function visitor(demoSchema: string | null): Context {
  return {
    db: {} as Context["db"],
    session: {
      user: {
        id: "demo",
        name: "Demo User",
        email: "demo@demo.local",
        role: "viewer",
        permissions: [],
      },
      expires: "2099-12-31T23:59:59.999Z",
    },
    demoSchema,
  };
}

async function callerFor(demoSchema: string | null) {
  const { createTRPCRouter, createCallerFactory, protectedProcedure } =
    await import("@/server/trpc");
  const router = createTRPCRouter({
    household: createTRPCRouter({
      read: protectedProcedure.query(() => "household data"),
    }),
    demo: createTRPCRouter({
      listProfiles: protectedProcedure.query(() => "profiles"),
    }),
  });
  return createCallerFactory(router)(visitor(demoSchema));
}

describe("the DEMO_ONLY guard", () => {
  it("refuses a read with no demo profile chosen, as an ended demo session", async () => {
    process.env.DEMO_ONLY = "true";
    const { DemoSessionEnded } = await import("@/lib/demo/session-ended");
    const caller = await callerFor(null);
    const refusal = await caller.household.read().catch((e: unknown) => e);
    expect(refusal).toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((refusal as { cause?: unknown }).cause).toBeInstanceOf(
      DemoSessionEnded,
    );
  });

  it("doesn't log the refusal as a server error (a public demo sees many)", async () => {
    process.env.DEMO_ONLY = "true";
    log.mockClear();
    const caller = await callerFor(null);
    await caller.household.read().catch(() => undefined);
    expect(log).not.toHaveBeenCalledWith(
      "error",
      "trpc_error",
      expect.anything(),
    );
  });

  it("lets demo.* through with no demo profile (the picker)", async () => {
    process.env.DEMO_ONLY = "true";
    const caller = await callerFor(null);
    await expect(caller.demo.listProfiles()).resolves.toBe("profiles");
  });

  it("lets a read through once a demo profile is chosen", async () => {
    process.env.DEMO_ONLY = "true";
    const caller = await callerFor("demo_single_income");
    await expect(caller.household.read()).resolves.toBe("household data");
  });

  it("leaves a server that isn't DEMO_ONLY alone", async () => {
    delete process.env.DEMO_ONLY;
    const caller = await callerFor(null);
    await expect(caller.household.read()).resolves.toBe("household data");
  });
});
