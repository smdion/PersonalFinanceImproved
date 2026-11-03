/**
 * Layer rules (target-architecture § 4.2), checked by `pnpm check:layers`
 * (scripts/check-layers.ts). Today's breaks are recorded in
 * .dependency-cruiser-known-violations.json, which may only shrink.
 *
 * LAYERS is the one manifest: each layer's paths, today's folders first,
 * then the target folders (which match nothing until they exist).
 */
import fs from "node:fs";
import path from "node:path";

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `page.tsx` / `layout.tsx` files without "use client": the server pages. */
function serverPageFiles(dir = "src/app") {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.posix.join(dir, e.name);
    if (e.isDirectory()) return serverPageFiles(full);
    if (!/^(page|layout)\.tsx$/.test(e.name)) return [];
    const head = fs.readFileSync(full, "utf8").slice(0, 200);
    return /^\s*["']use client["']/.test(head) ? [] : [full];
  });
}

const SHAPE_FILES =
  "(shapes/|(json-schemas|salary-entry-defaults|salary-entry-edit|profile-fields)\\.ts$)";

const LAYERS = {
  foundation: "^src/lib/(config/|constants(\\.ts$|/)|utils/)",
  shapes: `^src/lib/db/${SHAPE_FILES}`,
  // lib/calculators and lib/pure merge into lib/pure in v0.10.x.
  pure: "^src/lib/(pure|calculators)/",
  infra: `^src/lib/(db/(?!${SHAPE_FILES})|http/|budget-api/|simplefin/|sec/|tiingo/|tax-data/|auth/|(crypto|logger|rate-limit|env|error-reporting|url-safety)\\.ts$)`,
  data: "^src/server/data/",
  // server/helpers and server/retirement are today's composition layer;
  // they dissolve into server/data and server/services.
  services: "^src/server/(services/|retirement/|helpers/(?!server-trpc\\.ts$))",
  routers: "^src/server/routers/",
  // helpers/server-trpc.ts is today's name for trpc-server.ts.
  serverCore:
    "^src/server/((trpc|auth|auth\\.config|trpc-server|mutation-events)\\.ts$|helpers/server-trpc\\.ts$)",
  apiRoutes: "^src/app/api/",
  serverPages: serverPageFiles().map((f) => `^${escape(f)}$`),
  // Client components under app/ (every app file that isn't a server page
  // or an API route), components/, hooks, context and the tRPC client.
  ui: "^src/(components/|app/|lib/(hooks|context)/|lib/trpc\\.ts$)",
  worker: "^src/workers/",
  scripts: "^(scripts/|db-migrate\\.ts$)",
};

const L = LAYERS;
const ABOVE_FOUNDATION = `${L.shapes}|${L.pure}|${L.infra}|^src/server/|^src/components/|^src/app/`;
// Resolved npm paths (pnpm's `.pnpm/<pkg>@<v>/node_modules/<pkg>/` too).
const IO_PACKAGES =
  "node_modules/(drizzle-orm|better-sqlite3|postgres|pg|next|react|react-dom|server-only|@trpc/server|@trpc/client|@trpc/react-query)/";

/** @type {import('dependency-cruiser').IConfiguration} */
const config = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "foundation-is-the-floor",
      severity: "error",
      from: { path: L.foundation },
      to: { path: ABOVE_FOUNDATION },
    },
    {
      name: "shapes-above-foundation-only",
      severity: "error",
      from: { path: L.shapes },
      to: {
        path: `${L.pure}|${L.infra}|^src/server/|^src/components/|^src/app/`,
      },
    },
    {
      name: "pure-has-no-io",
      severity: "error",
      from: { path: L.pure },
      to: {
        path: `${L.infra}|^src/server/|^src/components/|^src/app/|${IO_PACKAGES}`,
      },
    },
    {
      name: "infra-below-server",
      severity: "error",
      from: { path: L.infra },
      to: { path: "^src/server/|^src/components/|^src/app/" },
    },
    {
      name: "data-below-services",
      severity: "error",
      from: { path: L.data },
      to: { path: `${L.services}|${L.routers}|${L.serverCore}` },
    },
    {
      name: "services-below-routers",
      severity: "error",
      from: { path: L.services },
      to: { path: `${L.routers}|${L.serverCore}` },
    },
    {
      name: "no-router-to-router",
      severity: "error",
      from: {
        path: "^src/server/routers/([^/.]+)",
        pathNot: "^src/server/routers/index\\.ts$",
      },
      to: { path: L.routers, pathNot: "^src/server/routers/$1(/|\\.ts$)" },
    },
    {
      name: "shared-stays-in-group",
      severity: "error",
      from: { path: "^src/server/routers/([^/]+)/" },
      to: {
        path: "^src/server/routers/[^/]+/_shared\\.ts$",
        pathNot: "^src/server/routers/$1/_shared\\.ts$",
      },
    },
    {
      name: "api-routes-use-services",
      severity: "error",
      from: { path: L.apiRoutes },
      to: { path: L.routers, pathNot: "^src/server/routers/index\\.ts$" },
    },
    {
      name: "server-pages-prefetch-only",
      severity: "error",
      from: { path: L.serverPages },
      to: {
        path: `^src/server/|${L.infra}`,
        pathNot:
          "^src/server/((trpc-server|auth)\\.ts$|helpers/server-trpc\\.ts$|data/database-status\\.ts$)",
      },
    },
    {
      name: "ui-never-imports-server",
      severity: "error",
      comment: "Type-only too: the UI reads server types via RouterOutputs.",
      from: {
        path: L.ui,
        pathNot: [...L.serverPages, L.apiRoutes, "^src/lib/trpc\\.ts$"],
      },
      to: { path: `^src/server/|${L.data}` },
    },
    {
      name: "ui-never-runs-infra",
      severity: "error",
      comment: "lib/db and other infrastructure at runtime; types are allowed.",
      from: { path: L.ui, pathNot: [...L.serverPages, L.apiRoutes] },
      to: { path: L.infra, dependencyTypesNot: ["type-only"] },
    },
    {
      name: "trpc-client-takes-the-router-type",
      severity: "error",
      comment: "lib/trpc.ts is the one UI file that names AppRouter.",
      from: { path: "^src/lib/trpc\\.ts$" },
      to: {
        path: "^src/server/",
        pathNot: "^src/server/routers/index\\.ts$",
      },
    },
    {
      name: "trpc-client-takes-the-router-type",
      severity: "error",
      from: { path: "^src/lib/trpc\\.ts$" },
      to: {
        path: "^src/server/routers/index\\.ts$",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "worker-is-pure",
      severity: "error",
      from: { path: L.worker },
      to: { path: `^src/server/|${L.infra}|^src/components/` },
    },
    {
      name: "scripts-skip-server",
      severity: "error",
      from: { path: L.scripts },
      to: { path: "^src/server/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: "^src/lib/db/sqlite/|schema-sqlite\\.ts$|monte-carlo-worker\\.js$",
    },
    // Type-only imports count: the UI ban covers `import type` from server.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.scripts.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
  },
};

export default config;
