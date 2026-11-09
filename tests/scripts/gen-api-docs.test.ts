/**
 * The router catalog reads client paths the way tRPC mounts them, and a
 * procedure written in a group's index.ts fails the run. A procedure's
 * description is its whole doc comment.
 */
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRouterCatalog,
  readRouterCatalog,
} from "../../scripts/gen-api-docs";

let dir: string | null = null;
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function routers(files: Record<string, string>): string {
  dir = fs.mkdtempSync(path.join(tmpdir(), "gen-api-docs-"));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

const root = `
import { createTRPCRouter } from "../trpc";
import { groupRouter } from "./group";
import { flatRouter } from "./flat";
export const appRouter = createTRPCRouter({ group: groupRouter, flat: flatRouter });
`;

describe("readRouterCatalog", () => {
  it("prints each procedure's client path, through spreads, nesting and merges", () => {
    const d = routers({
      "index.ts": root,
      "flat.ts": `
export const flatRouter = createTRPCRouter({
  /** Lists things. */
  list: protectedProcedure.query(() => []),
});`,
      "group/index.ts": `
import { partProcedures } from "./part";
import { otherRouter } from "./other";
export const groupRouter = mergeRouters(
  createTRPCRouter({ ...partProcedures, nested: createTRPCRouter({ ...partProcedures }) }),
  otherRouter,
);`,
      "group/part.ts": `
export const partProcedures = {
  things: createTRPCRouter({
    save: adminProcedure.input(z.object({})).mutation(() => null),
  }),
};`,
      "group/other.ts": `
export const otherRouter = createTRPCRouter({ get: syncProcedure.query(() => 1) });`,
    });
    const rows = readRouterCatalog(d).map(
      (e) => `${e.path} ${e.kind} ${e.procType} ${e.source} ${e.router}`,
    );
    expect(rows.sort()).toEqual([
      "flat.list query protectedProcedure flat.ts flat",
      "group.get query syncProcedure group/other.ts group",
      "group.nested.things.save mutation adminProcedure group/part.ts group",
      "group.things.save mutation adminProcedure group/part.ts group",
    ]);
    expect(
      readRouterCatalog(d).find((e) => e.path === "flat.list")?.description,
    ).toBe("Lists things.");
  });

  it("reads a doc comment whole: its opening line, every line and // runs", () => {
    const d = routers({
      "index.ts": root,
      "flat.ts": `
export const flatRouter = createTRPCRouter({
  /** Opens here,
   *  goes on here.
   *  @param ignored
   */
  opened: protectedProcedure.query(() => 1),
  /**
   * One.
   * Two.
   * Three.
   * Four.
   * Five.
   */
  long: protectedProcedure.query(() => 1),
  // First line,
  // second line.
  slashes: protectedProcedure.query(() => 1),
  bare: protectedProcedure.query(() => 1), /* not a doc */
  after: protectedProcedure.query(() => 1),
});`,
      "group/index.ts": `export const groupRouter = createTRPCRouter({});`,
    });
    const description = Object.fromEntries(
      readRouterCatalog(d).map((e) => [e.path, e.description]),
    );
    expect(description).toEqual({
      "flat.opened": "Opens here, goes on here.",
      "flat.long": "One. Two. Three. Four. Five.",
      "flat.slashes": "First line, second line.",
      "flat.bare": "",
      "flat.after": "",
    });
  });

  it("fails on a procedure written in a group's index.ts", () => {
    const d = routers({
      "index.ts": root,
      "flat.ts": `export const flatRouter = createTRPCRouter({});`,
      "group/index.ts": `
export const groupRouter = createTRPCRouter({
  stray: protectedProcedure.query(() => 1),
});`,
    });
    expect(() => readRouterCatalog(d)).toThrow(
      /group\.stray is written in an index\.ts/,
    );
  });

  it("prints the Description column only for a router with a doc comment", () => {
    const d = routers({
      "index.ts": `
import { notesRouter } from "./notes";
import { bareRouter } from "./bare";
export const appRouter = createTRPCRouter({ notes: notesRouter, bare: bareRouter });`,
      "notes.ts": `
export const notesRouter = createTRPCRouter({
  /** Lists notes. */
  list: protectedProcedure.query(() => []),
  save: adminProcedure.mutation(() => null),
});`,
      "bare.ts": `
export const bareRouter = createTRPCRouter({
  get: protectedProcedure.query(() => 1),
});`,
    });
    const md = buildRouterCatalog(d, null);
    expect(md).toContain("| Procedure | Kind | Auth | Source | Description |");
    expect(md).toContain(
      "| `notes.list` | query | `protectedProcedure` | `notes.ts` | Lists notes. |",
    );
    expect(md).toContain(
      "| `notes.save` | mutation | `adminProcedure` | `notes.ts` |  |",
    );
    expect(md).toContain(
      "| Procedure | Kind | Auth | Source |\n|---|---|---|---|\n",
    );
    expect(md).toContain(
      "| `bare.get` | query | `protectedProcedure` | `bare.ts` |\n",
    );
    expect(md).not.toContain("(no description)");
  });
});
