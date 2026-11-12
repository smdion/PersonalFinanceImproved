/**
 * Client bundle check, run after `pnpm build` (CI blocks on it).
 *
 * Measures the JavaScript a page can make a browser download, gzipped:
 *
 * - **First load:** the shared runtime (build-manifest's rootMainFiles)
 *   plus the page's own entry scripts (its layouts, error boundaries and
 *   page, from the page's client reference manifest).
 * - **Lazy:** the chunks of every `next/dynamic` import the page reaches,
 *   from the page's `page/react-loadable-manifest.json` (Turbopack writes
 *   one per app page), less any already in the first load. A chart behind
 *   `next/dynamic` still arrives on page open when it renders, so leaving
 *   these out undercounted Retirement (351 KB reported, 494 KB received).
 *
 * A page's budget covers both (`total`). It's an upper bound: a dynamic
 * import that only renders on demand (a methodology dialog) counts too,
 * because the build doesn't say which ones render on open. Any single
 * chunk over CHUNK_ERROR_KB (raw) fails too.
 *
 * Not measured: the sum of every chunk in .next/static/chunks — that grows
 * with every page added and says nothing about what one page costs.
 *
 * Sizes are compared in bytes: a page fails one byte over its budget
 * (budgets are whole KB, 1 KB = 1024 bytes); nothing rounds a page under.
 *
 * Headroom rule (owner Q15, v0.10.5): a page's budget is its measured size
 * at the release plus HEADROOM_KB, rounded up to a whole KB. Budgets are
 * re-set once per release, in one commit with the owner's OK:
 *   pnpm build && pnpm check:bundle --rebase
 * prints the PAGE_BUDGET_KB block to paste. Between re-sets a budget is
 * never raised: a landing that would pass one stops for the owner.
 * Polyfills are nomodule scripts (modern browsers skip them).
 *
 * Usage: tsx scripts/check-bundle-size.ts [--report | --rebase] [--next-dir <dir>]
 */
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import * as zlib from "zlib";
import { fileURLToPath } from "url";

/**
 * Per-page budget (gzipped KB, first load + lazy), keyed by the route as
 * the client reference manifest names it ("/(dashboard)/retirement/page").
 * Set by the headroom rule above (`--rebase`); a page over its budget is
 * cut, or waits for the owner.
 */
const PAGE_BUDGET_KB: Record<string, number> = {
  "/_global-error/page": 132,
  "/_not-found/page": 188,
  "/(dashboard)/analytics/page": 219,
  "/(dashboard)/assets/page": 225,
  "/(dashboard)/benchmarks/methodology/page": 221,
  "/(dashboard)/benchmarks/page": 424,
  "/(dashboard)/brokerage/page": 244,
  "/(dashboard)/budget/page": 362,
  "/(dashboard)/contributions/page": 292,
  "/(dashboard)/data-browser/page": 222,
  "/(dashboard)/expenses/page": 357,
  "/(dashboard)/help/page": 235,
  "/(dashboard)/historical/page": 233,
  "/(dashboard)/house/page": 227,
  "/(dashboard)/liabilities/page": 237,
  "/(dashboard)/milestones/page": 288,
  "/(dashboard)/mortgage/page": 219,
  "/(dashboard)/networth/page": 379,
  "/(dashboard)/page": 332,
  "/(dashboard)/paycheck/page": 305,
  "/(dashboard)/performance/page": 279,
  "/(dashboard)/portfolio/page": 384,
  "/(dashboard)/profiles/page": 362,
  "/(dashboard)/recommendations/page": 288,
  "/(dashboard)/retirement/accumulation-methodology/page": 223,
  "/(dashboard)/retirement/decumulation-methodology/page": 235,
  "/(dashboard)/retirement/methodology/page": 225,
  "/(dashboard)/retirement/page": 513,
  "/(dashboard)/savings/page": 403,
  "/(dashboard)/settings/page": 263,
  "/(dashboard)/tax-buckets/page": 232,
  "/(dashboard)/tax-optimization/page": 241,
  "/(dashboard)/taxes/page": 234,
  "/(dashboard)/tools/page": 239,
  "/(dashboard)/upkeep/utilities/page": 349,
  "/(dashboard)/versions/page": 227,
  "/demo/page": 189,
  "/login/page": 192,
};
/**
 * A new page with no PAGE_BUDGET_KB entry: give it one at its first
 * measured size in the commit that adds it.
 */
const DEFAULT_PAGE_BUDGET_KB = 460;
/** Owner Q15: a re-set budget is the measured size plus this. */
export const HEADROOM_KB = 2;
const CHUNK_ERROR_KB = 500; // raw, any single chunk
const REPORT_TOP = 8;

export interface BuildManifest {
  rootMainFiles?: string[];
}
type RscManifest = { entryJSFiles?: Record<string, string[]> };
export type LoadableManifest = Record<string, { files?: string[] }>;

export interface PageChunks {
  route: string;
  /** Loaded with the page: shared runtime plus the page's entry scripts. */
  firstLoad: string[];
  /** `next/dynamic` chunks the page can load, not already in firstLoad. */
  lazy: string[];
}

/** The routes in one `page_client-reference-manifest.js` and their entries. */
export function parseClientReferenceManifest(
  src: string,
): Record<string, RscManifest> {
  const sandbox: {
    globalThis: { __RSC_MANIFEST?: Record<string, RscManifest> };
  } = { globalThis: {} };
  vm.runInNewContext(src, sandbox);
  return sandbox.globalThis.__RSC_MANIFEST ?? {};
}

/** First-load and lazy chunk files for each route of one page. */
export function pageChunks(
  shared: string[],
  rsc: Record<string, RscManifest>,
  loadable: LoadableManifest,
): PageChunks[] {
  return Object.entries(rsc).map(([route, m]) => {
    const first = new Set(shared);
    for (const [entry, list] of Object.entries(m.entryJSFiles ?? {}))
      // The app-wide fallbacks load only when they render.
      if (!/(global-error|not-found)$/.test(entry))
        for (const f of list) first.add(f);
    const lazy = new Set<string>();
    for (const { files = [] } of Object.values(loadable))
      for (const f of files)
        if (f.endsWith(".js") && !first.has(f)) lazy.add(f);
    return { route, firstLoad: [...first], lazy: [...lazy] };
  });
}

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const CLIENT_MANIFEST = "page_client-reference-manifest.js";

/**
 * Every app page's chunks in a `.next` directory. A page with no
 * react-loadable manifest beside it is an error, not zero lazy chunks:
 * a webpack build keeps one manifest for the whole app and can't be
 * split per page, and counting nothing is how the undercount started.
 */
export function buildPageChunks(nextDir: string): PageChunks[] {
  const buildManifest = JSON.parse(
    fs.readFileSync(path.join(nextDir, "build-manifest.json"), "utf8"),
  ) as BuildManifest;
  const shared = [...(buildManifest.rootMainFiles ?? [])];
  const out: PageChunks[] = [];
  for (const file of walk(path.join(nextDir, "server", "app"))) {
    if (!file.endsWith(CLIENT_MANIFEST)) continue;
    const loadablePath = path.join(
      path.dirname(file),
      "page",
      "react-loadable-manifest.json",
    );
    if (!fs.existsSync(loadablePath))
      throw new Error(
        `${path.relative(nextDir, file)} has no page/react-loadable-manifest.json beside it, so its lazy chunks can't be counted (is this a Turbopack build?)`,
      );
    out.push(
      ...pageChunks(
        shared,
        parseClientReferenceManifest(fs.readFileSync(file, "utf8")),
        JSON.parse(fs.readFileSync(loadablePath, "utf8")) as LoadableManifest,
      ),
    );
  }
  return out;
}

export interface PageSize {
  route: string;
  /** Display sizes, whole KB rounded up (a byte over a KB shows the next). */
  firstLoadKb: number;
  lazyKb: number;
  totalKb: number;
  /** What the budget is checked against. */
  totalBytes: number;
  budgetKb: number;
}

const kbUp = (bytes: number) => Math.ceil(bytes / 1024);

/** Whether a page passes its budget, byte for byte. */
export const overBudget = (p: PageSize) => p.totalBytes > p.budgetKb * 1024;

/** Sizes from per-file gzipped bytes, each page against its budget. */
export function pageSizes(
  pages: PageChunks[],
  gzBytes: (file: string) => number,
  budgets: Record<string, number> = PAGE_BUDGET_KB,
  defaultBudget = DEFAULT_PAGE_BUDGET_KB,
): PageSize[] {
  const sum = (files: string[]) => files.reduce((s, f) => s + gzBytes(f), 0);
  return pages.map(({ route, firstLoad, lazy }) => {
    const first = sum(firstLoad);
    const rest = sum(lazy);
    return {
      route,
      firstLoadKb: kbUp(first),
      lazyKb: kbUp(rest),
      totalKb: kbUp(first + rest),
      totalBytes: first + rest,
      budgetKb: budgets[route] ?? defaultBudget,
    };
  });
}

/** The PAGE_BUDGET_KB block the headroom rule gives, sorted by route. */
export function budgetBlock(sizes: PageSize[]): string {
  const lines = [...sizes]
    .sort((a, b) => a.route.localeCompare(b.route))
    .map(
      (p) =>
        `  ${JSON.stringify(p.route)}: ${kbUp(p.totalBytes + HEADROOM_KB * 1024)},`,
    );
  return `const PAGE_BUDGET_KB: Record<string, number> = {\n${lines.join("\n")}\n};`;
}

function main() {
  const args = process.argv.slice(2);
  const dirAt = args.indexOf("--next-dir");
  const nextDir = path.resolve(dirAt >= 0 ? args[dirAt + 1]! : ".next");
  const report = args.includes("--report");
  const rebase = args.includes("--rebase");

  if (
    !fs.existsSync(path.join(nextDir, "build-manifest.json")) ||
    !fs.existsSync(path.join(nextDir, "server", "app"))
  ) {
    console.log(
      `No production build in ${nextDir} — run \`pnpm build\` first.`,
    );
    process.exit(1);
  }

  const gzCache = new Map<string, number>();
  const gzBytes = (file: string) => {
    let n = gzCache.get(file);
    if (n === undefined) {
      n = zlib.gzipSync(fs.readFileSync(path.join(nextDir, file))).length;
      gzCache.set(file, n);
    }
    return n;
  };

  const pages = pageSizes(buildPageChunks(nextDir), gzBytes);
  if (pages.length === 0) {
    console.log("No page manifests found under .next/server/app — FAIL");
    process.exit(1);
  }
  pages.sort((a, b) => b.totalBytes - a.totalBytes);

  if (report) {
    console.log(
      "Bundle sizes (gzipped KB rounded up: first load + lazy = total; bytes; budget):",
    );
    for (const p of pages)
      console.log(
        `  ${String(p.firstLoadKb).padStart(4)} + ${String(p.lazyKb).padStart(4)} = ${String(p.totalKb).padStart(4)}  ${String(p.totalBytes).padStart(7)} B of ${p.budgetKb}  ${p.route}`,
      );
    return;
  }
  if (rebase) {
    console.log(
      `Budgets at the measured size + ${HEADROOM_KB} KB, rounded up (owner Q15; paste into scripts/check-bundle-size.ts in the release's re-set commit, with the owner's OK):\n${budgetBlock(pages)}`,
    );
    return;
  }

  const chunksDir = path.join(nextDir, "static", "chunks");
  const bigChunks = fs
    .readdirSync(chunksDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => ({
      name: f,
      kb: Math.round(fs.statSync(path.join(chunksDir, f)).size / 1024),
    }))
    .filter((c) => c.kb > CHUNK_ERROR_KB);

  const overPages = pages.filter(overBudget);

  console.log("Bundle check (JS per page, gzipped: first load + lazy chunks):");
  console.log(
    `  Budget per page (default ${DEFAULT_PAGE_BUDGET_KB} KB); any chunk over ${CHUNK_ERROR_KB} KB raw fails`,
  );
  console.log(`  ${pages.length} pages; heaviest:`);
  const shown = [
    ...pages.slice(0, REPORT_TOP),
    ...overPages.filter((p) => !pages.slice(0, REPORT_TOP).includes(p)),
  ];
  for (const p of shown)
    console.log(
      `  ${overBudget(p) ? "[OVER]" : "      "} ${String(p.totalKb).padStart(4)} KB (${p.firstLoadKb} + ${p.lazyKb} lazy) of ${p.budgetKb}  ${p.route}  ${p.totalBytes} B`,
    );
  for (const c of bigChunks)
    console.log(`  [OVER] chunk ${c.name}: ${c.kb} KB raw`);

  if (overPages.length > 0 || bigChunks.length > 0) {
    console.log(
      `\n${overPages.length} page(s) over budget, ${bigChunks.length} chunk(s) too large — FAIL`,
    );
    console.log(
      "Look for a client file importing a server module (node built-ins get shimmed into the bundle) or a library that belongs behind next/dynamic.",
    );
    process.exit(1);
  }
  console.log("\nAll pages within budget — PASS");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
