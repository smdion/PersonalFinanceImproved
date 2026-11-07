/**
 * docs/API_ROUTERS.md lists each procedure by the client path the
 * generator reads from the router source; that list is exactly the app
 * router's procedures, each with its kind.
 */
import "./setup-mocks";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readRouterCatalog } from "../../scripts/gen-api-docs";

describe("the router catalog's client paths", () => {
  it("are the app router's procedures, each with its kind", async () => {
    const { appRouter } = await import("@/server/routers");
    const procedures: Record<string, unknown> = appRouter._def.procedures;
    const kind = (p: unknown) => (p as { _def: { type: string } })._def.type;
    const mounted = Object.entries(procedures)
      .map(([p, proc]) => `${p} ${kind(proc)}`)
      .sort();
    const read = readRouterCatalog(path.resolve("src/server/routers"))
      .map((e) => `${e.path} ${e.kind}`)
      .sort();
    expect(read).toEqual(mounted);
  }, 60_000);
});
