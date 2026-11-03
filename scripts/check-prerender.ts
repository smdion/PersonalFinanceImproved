/**
 * After `pnpm build`: fail if the build prerendered /login or any page under
 * src/app/(dashboard). Those depend on the running server (its Authentik
 * issuer, the signed-in user, the database), so a prerendered copy would
 * show every visitor what the build machine saw.
 *
 * Usage: pnpm tsx scripts/check-prerender.ts
 */
import * as fs from "fs";
import * as path from "path";

const APP_DIR = "src/app";
const DASHBOARD_DIR = path.join(APP_DIR, "(dashboard)");
const MANIFEST = ".next/prerender-manifest.json";

/** The URL path of a page file: route groups like `(dashboard)` drop out. */
function routeOf(pageFile: string): string {
  const segments = path
    .relative(APP_DIR, path.dirname(pageFile))
    .split(path.sep)
    .filter((s) => s && !/^\(.*\)$/.test(s));
  return "/" + segments.join("/");
}

function pageFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(full);
    return /^page\.(tsx|ts|jsx|js)$/.test(entry.name) ? [full] : [];
  });
}

function fail(message: string): never {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (!fs.existsSync(MANIFEST))
  fail(`${MANIFEST} not found: run this after \`pnpm build\`.`);

const manifest: unknown = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const routes =
  manifest &&
  typeof manifest === "object" &&
  "routes" in manifest &&
  manifest.routes &&
  typeof manifest.routes === "object"
    ? Object.keys(manifest.routes)
    : null;
// Next always prerenders its own /_not-found; without it the format changed
// and this check would pass by reading nothing.
if (!routes || !routes.includes("/_not-found"))
  fail(
    `${MANIFEST} has no "routes" listing /_not-found; its format changed, update this check.`,
  );

const dashboardRoutes = pageFiles(DASHBOARD_DIR).map(routeOf);
if (dashboardRoutes.length === 0)
  fail(`No pages found under ${DASHBOARD_DIR}; update this check.`);

const mustBeDynamic = new Set(["/login", ...dashboardRoutes]);
const prerendered = routes.filter((r) => mustBeDynamic.has(r));
if (prerendered.length > 0)
  fail(
    `Prerendered at build time, but these must render per request: ${prerendered.join(", ")}. ` +
      "Read request-time state (await connection(), cookies(), headers()) before anything else.",
  );

console.log(
  `No prerendered sign-in or dashboard page (${mustBeDynamic.size} checked; prerendered: ${routes.join(", ")}).`,
);
