/**
 * scripts/check-bundle-size.ts reads a Turbopack build's manifests: the
 * shared runtime from build-manifest.json, each page's entry scripts from
 * its client reference manifest, and its `next/dynamic` chunks from
 * page/react-loadable-manifest.json. Lazy chunks once went uncounted
 * (Retirement 351 KB reported, 494 KB received). The fixture below is a
 * two-page build in the manifests' real shape (Next 16, Turbopack), with
 * made-up chunk names.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  budgetBlock,
  buildPageChunks,
  pageChunks,
  pageSizes,
  parseClientReferenceManifest,
} from "../../scripts/check-bundle-size";

const SHARED = ["static/chunks/runtime-a.js", "static/chunks/turbopack-b.js"];

/** A page's client reference manifest as Next writes it: a script. */
function clientManifest(
  route: string,
  entryJSFiles: Record<string, string[]>,
): string {
  const m = {
    moduleLoading: { prefix: "/_next/" },
    clientModules: {},
    entryCSSFiles: {},
    entryJSFiles,
  };
  return `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};globalThis.__RSC_MANIFEST[${JSON.stringify(route)}] = ${JSON.stringify(m)};`;
}

const LAYOUT = ["static/chunks/layout-1.js", "static/chunks/layout-2.js"];
const RETIREMENT_ENTRIES = {
  "[project]/src/app/layout": LAYOUT,
  "[project]/src/app/global-error": [...LAYOUT, "static/chunks/global-err.js"],
  "[project]/src/app/(dashboard)/error": [
    ...LAYOUT,
    "static/chunks/dash-error.js",
  ],
  "[project]/src/app/(dashboard)/retirement/page": [
    ...LAYOUT,
    "static/chunks/retirement.js",
  ],
};
/** Keyed by module id; files overlap (a chart library shared by two). */
const RETIREMENT_LOADABLE = {
  "579882": {
    id: 579882,
    files: [
      "static/chunks/charts.js",
      "static/chunks/projection-chart.js",
      "static/chunks/layout-1.js",
    ],
  },
  "725688": {
    id: 725688,
    files: [
      "static/chunks/charts.js",
      "static/chunks/stability-chart.js",
      "static/chunks/stability.css",
    ],
  },
};

let dir: string;
const pageDir = (route: string) => path.join(dir, "server", "app", route);

function writePage(
  route: string,
  key: string,
  entries: Record<string, string[]>,
  loadable: object | null,
) {
  fs.mkdirSync(path.join(pageDir(route), "page"), { recursive: true });
  fs.writeFileSync(
    path.join(pageDir(route), "page_client-reference-manifest.js"),
    clientManifest(key, entries),
  );
  if (loadable)
    fs.writeFileSync(
      path.join(pageDir(route), "page", "react-loadable-manifest.json"),
      JSON.stringify(loadable),
    );
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-bundle-"));
  fs.writeFileSync(
    path.join(dir, "build-manifest.json"),
    JSON.stringify({
      polyfillFiles: ["static/chunks/polyfill.js"],
      rootMainFiles: SHARED,
      chunkLoadingGlobal: "TURBOPACK",
    }),
  );
  writePage(
    "(dashboard)/retirement",
    "/(dashboard)/retirement/page",
    RETIREMENT_ENTRIES,
    RETIREMENT_LOADABLE,
  );
  writePage(
    "(dashboard)/budget",
    "/(dashboard)/budget/page",
    {
      "[project]/src/app/layout": LAYOUT,
      "[project]/src/app/(dashboard)/budget/page": ["static/chunks/budget.js"],
    },
    {},
  );
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("check-bundle-size: reading the build", () => {
  it("parses the routes a client reference manifest script defines", () => {
    const rsc = parseClientReferenceManifest(
      clientManifest("/(dashboard)/x/page", { a: ["static/chunks/a.js"] }),
    );
    expect(Object.keys(rsc)).toEqual(["/(dashboard)/x/page"]);
    expect(rsc["/(dashboard)/x/page"]!.entryJSFiles).toEqual({
      a: ["static/chunks/a.js"],
    });
  });

  it("counts lazy chunks once, without first-load chunks, CSS or the fallbacks", () => {
    const pages = buildPageChunks(dir);
    const retirement = pages.find(
      (p) => p.route === "/(dashboard)/retirement/page",
    )!;
    expect(retirement.firstLoad.sort()).toEqual(
      [
        ...SHARED,
        ...LAYOUT,
        "static/chunks/dash-error.js",
        "static/chunks/retirement.js",
      ].sort(),
    );
    // charts.js is in both dynamic imports; layout-1.js is already loaded.
    expect(retirement.lazy.sort()).toEqual([
      "static/chunks/charts.js",
      "static/chunks/projection-chart.js",
      "static/chunks/stability-chart.js",
    ]);
    const budget = pages.find((p) => p.route === "/(dashboard)/budget/page")!;
    expect(budget.lazy).toEqual([]);
    expect(pages).toHaveLength(2);
  });

  it("refuses a page with no react-loadable manifest instead of counting no lazy chunks", () => {
    writePage(
      "(dashboard)/savings",
      "/(dashboard)/savings/page",
      { "[project]/src/app/layout": LAYOUT },
      null,
    );
    try {
      expect(() => buildPageChunks(dir)).toThrow(
        /savings.*react-loadable-manifest/,
      );
    } finally {
      fs.rmSync(pageDir("(dashboard)/savings"), { recursive: true });
    }
  });
});

describe("check-bundle-size: sizes and budgets", () => {
  const pages = pageChunks(
    SHARED,
    { "/(dashboard)/retirement/page": { entryJSFiles: RETIREMENT_ENTRIES } },
    RETIREMENT_LOADABLE,
  );
  // 100 KB per first-load file (6), 50 KB per lazy file (3).
  const gz = (f: string) =>
    ["charts", "projection-chart", "stability-chart"].some((n) =>
      f.endsWith(`/${n}.js`),
    )
      ? 50 * 1024
      : 100 * 1024;

  it("adds lazy chunks to the first load and checks the total", () => {
    const [p] = pageSizes(pages, gz, {}, 700);
    expect(p).toEqual({
      route: "/(dashboard)/retirement/page",
      firstLoadKb: 600,
      lazyKb: 150,
      totalKb: 750,
      budgetKb: 700,
    });
  });

  it("uses a page's own budget over the default", () => {
    const [p] = pageSizes(
      pages,
      gz,
      { "/(dashboard)/retirement/page": 750 },
      460,
    );
    expect(p!.budgetKb).toBe(750);
  });

  it("--report's budget block lists each page at its measured total", () => {
    const block = budgetBlock([
      ...pageSizes(pages, gz, {}, 460),
      {
        route: "/(dashboard)/budget/page",
        firstLoadKb: 300,
        lazyKb: 0,
        totalKb: 300,
        budgetKb: 460,
      },
    ]);
    expect(block).toBe(
      [
        "const PAGE_BUDGET_KB: Record<string, number> = {",
        '  "/(dashboard)/budget/page": 300,',
        '  "/(dashboard)/retirement/page": 750,',
        "};",
      ].join("\n"),
    );
  });
});
