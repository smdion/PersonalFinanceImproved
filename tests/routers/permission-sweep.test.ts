/**
 * Every mutation in the app router writes behind a gate (RULES § Permission
 * & Security Gates): its `meta.auth` is a permission or `admin`, or it is on
 * the reviewed exception list below with its reason. A signed-in viewer
 * holding no permission is refused (FORBIDDEN, not just any error) by every
 * gated one, before its input is read.
 */
import "./setup-mocks";
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { PERMISSIONS } from "@/lib/config/permissions";
import { createTestCaller, createViewerSessionWithPermissions } from "./setup";

/** Mutations that may run without a permission, each with its reason. A
 *  new entry needs the same review as a change to a procedure's gate. */
const UNGATED_MUTATIONS: Record<string, string> = {
  "settings.createLocalAdmin":
    "the first admin on a fresh install (no session yet); refused once firstRunState says an admin exists",
  "demo.activateProfile":
    "sets the demo cookie (session state, not household data); callable in DEMO_ONLY",
  "demo.deactivateDemo":
    "clears the demo cookie (session state, not household data); callable in DEMO_ONLY",
  "milestones.recordReached":
    "records a milestone first reached, a fact derived from the household's own data, on any viewer's page load",
};

/** Mutations gated below a permission on purpose, each with its reason. */
const SESSION_GATED_MUTATIONS: Record<string, string> = {
  "settings.scenarios.activate":
    "applyPlan checks the permission of each profile kind the Plan changes (plans.test.ts)",
};

const GATES: ReadonlySet<string> = new Set(["admin", ...PERMISSIONS]);

type Proc = { _def: { type: string; meta?: { auth?: string } } };

async function mutations(): Promise<[string, string | undefined][]> {
  const { appRouter } = await import("@/server/routers");
  const procedures: Record<string, unknown> = appRouter._def.procedures;
  return Object.entries(procedures)
    .filter(([, p]) => (p as Proc)._def.type === "mutation")
    .map(([path, p]) => [path, (p as Proc)._def.meta?.auth]);
}

const isException = (path: string) =>
  path in UNGATED_MUTATIONS || path in SESSION_GATED_MUTATIONS;

// A value no procedure's input accepts: a gated call is refused before its
// input is read, so nothing is written.
const BAD = "not-an-input" as never;

/** The call's error code, or "ok" when it resolved. */
async function outcome(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
    return "ok";
  } catch (e) {
    return e instanceof TRPCError ? e.code : String(e);
  }
}

describe("the permission sweep over every mutation", () => {
  it("finds the app's mutations", async () => {
    expect((await mutations()).length).toBeGreaterThan(100);
  });

  it("gates every mutation by a permission or admin, unless it is a listed exception", async () => {
    const ungated = (await mutations())
      .filter(([path, auth]) => !GATES.has(auth ?? "") && !isException(path))
      .map(([path, auth]) => `${path} (${auth})`);
    expect(ungated).toEqual([]);
  });

  it("lists only mutations that exist and are still below a permission", async () => {
    const auth = new Map(await mutations());
    for (const path of Object.keys(UNGATED_MUTATIONS))
      expect([path, auth.get(path)]).toEqual([
        path,
        expect.stringMatching(/^(public|protected)$/),
      ]);
    for (const path of Object.keys(SESSION_GATED_MUTATIONS))
      expect([path, auth.get(path)]).toEqual([path, "protected"]);
  });

  it("refuses a viewer with no permission on every gated mutation (FORBIDDEN)", async () => {
    const gated = (await mutations())
      .filter(([, auth]) => GATES.has(auth ?? ""))
      .map(([path]) => path);
    const { caller, cleanup } = await createTestCaller(
      createViewerSessionWithPermissions([]),
    );
    try {
      const got: string[] = [];
      for (const path of gated) {
        const fn = path
          .split(".")
          .reduce<unknown>(
            (node, key) => (node as Record<string, unknown>)[key],
            caller,
          ) as (input: unknown) => Promise<unknown>;
        got.push(`${path} ${await outcome(() => fn(BAD))}`);
      }
      expect(got).toEqual(gated.map((path) => `${path} FORBIDDEN`));
    } finally {
      cleanup();
    }
  });

  it("refuses a signed-out caller on every mutation but the first admin's", async () => {
    const all = (await mutations())
      .map(([path]) => path)
      .filter((path) => path !== "settings.createLocalAdmin");
    const { caller, cleanup } = await createTestCaller(null);
    try {
      const got: string[] = [];
      for (const path of all) {
        const fn = path
          .split(".")
          .reduce<unknown>(
            (node, key) => (node as Record<string, unknown>)[key],
            caller,
          ) as (input: unknown) => Promise<unknown>;
        got.push(`${path} ${await outcome(() => fn(BAD))}`);
      }
      expect(got).toEqual(all.map((path) => `${path} UNAUTHORIZED`));
    } finally {
      cleanup();
    }
  });
});
