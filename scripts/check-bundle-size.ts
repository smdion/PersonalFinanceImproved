/**
 * Client bundle check, run after `pnpm build` (CI blocks on it).
 *
 * Measures what a browser downloads to open each page: the shared runtime
 * (build-manifest's rootMainFiles) plus the page's own entry
 * scripts (its layouts, error boundaries and page, from the page's client
 * reference manifest), gzipped. Each page must stay under
 * PAGE_FIRST_LOAD_KB; any single chunk over CHUNK_ERROR_KB (raw) fails too.
 *
 * Not measured: the sum of every chunk in .next/static/chunks — that grows
 * with every page added and says nothing about what one page costs.
 *
 * Baseline (v0.9.2 build, gzipped first load): the heaviest pages (Savings,
 * Benchmarks, Net Worth — charts loaded up front) ~420 KB, most pages
 * 215–290 KB. The budget leaves ~40 KB (about 10%) on the heaviest; raise
 * it only with a reason in the commit, never to make a regression pass.
 */
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import * as zlib from "zlib";

const PAGE_FIRST_LOAD_KB = 460; // gzipped, per page
const CHUNK_ERROR_KB = 500; // raw, any single chunk
const REPORT_TOP = 8;

const nextDir = path.join(process.cwd(), ".next");
const buildManifestPath = path.join(nextDir, "build-manifest.json");
const appDir = path.join(nextDir, "server", "app");

if (!fs.existsSync(buildManifestPath) || !fs.existsSync(appDir)) {
  console.log("No production build in .next/ — run `pnpm build` first.");
  process.exit(1);
}

const buildManifest = JSON.parse(fs.readFileSync(buildManifestPath, "utf8"));
// Polyfills are nomodule scripts — modern browsers skip them.
const shared: string[] = [...(buildManifest.rootMainFiles ?? [])];

const sizes = new Map<string, { raw: number; gz: number }>();
function sizeOf(file: string) {
  let s = sizes.get(file);
  if (!s) {
    const buf = fs.readFileSync(path.join(nextDir, file));
    s = { raw: buf.length, gz: zlib.gzipSync(buf).length };
    sizes.set(file, s);
  }
  return s;
}

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

type RscManifest = { entryJSFiles?: Record<string, string[]> };

const pages: { route: string; kb: number }[] = [];
for (const file of walk(appDir)) {
  if (!file.endsWith("page_client-reference-manifest.js")) continue;
  const sandbox: {
    globalThis: { __RSC_MANIFEST?: Record<string, RscManifest> };
  } = { globalThis: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox);
  for (const [route, m] of Object.entries(
    sandbox.globalThis.__RSC_MANIFEST ?? {},
  )) {
    const files = new Set(shared);
    for (const [entry, list] of Object.entries(m.entryJSFiles ?? {}))
      // The app-wide fallbacks load only when they render.
      if (!/(global-error|not-found)$/.test(entry))
        for (const f of list) files.add(f);
    const gz = [...files].reduce((sum, f) => sum + sizeOf(f).gz, 0);
    pages.push({ route, kb: Math.round(gz / 1024) });
  }
}

if (pages.length === 0) {
  console.log("No page manifests found under .next/server/app — FAIL");
  process.exit(1);
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

pages.sort((a, b) => b.kb - a.kb);
const overPages = pages.filter((p) => p.kb > PAGE_FIRST_LOAD_KB);

console.log("Bundle check (first-load JS per page, gzipped):");
console.log(
  `  Budget ${PAGE_FIRST_LOAD_KB} KB a page; any chunk over ${CHUNK_ERROR_KB} KB raw fails`,
);
console.log(`  ${pages.length} pages; heaviest:`);
for (const p of pages.slice(0, REPORT_TOP))
  console.log(
    `  ${p.kb > PAGE_FIRST_LOAD_KB ? "[OVER]" : "      "} ${String(p.kb).padStart(4)} KB  ${p.route}`,
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
