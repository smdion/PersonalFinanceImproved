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
import { cruise } from "dependency-cruiser";
import extractTSConfig from "dependency-cruiser/config-utl/extract-ts-config";

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

const SHAPE_FILES = "shapes/";

const LAYERS = {
  // demo/ is the demo households' data; generated/ holds build-made constants.
  foundation: "^src/lib/(config/|constants(\\.ts$|/)|utils/|demo/|generated/)",
  shapes: `^src/lib/db/${SHAPE_FILES}`,
  pure: "^src/lib/pure/",
  // The engine's public API is its index.ts, and types/index.ts for types.
  engine: "^src/lib/pure/engine/",
  infra: `^src/lib/(db/(?!${SHAPE_FILES})|http/|budget-api/|simplefin/|sec/|tiingo/|tax-data/|auth/|(crypto|crypto-envelope|logger|rate-limit|env|error-reporting|client-address)\\.ts$)`,
  data: "^src/server/data/",
  services: "^src/server/services/",
  routers: "^src/server/routers/",
  serverCore:
    "^src/server/(trpc|auth|auth\\.config|trpc-server|mutation-events)\\.ts$",
  // Sign-in helpers below the server core: the environment and local admins.
  serverAuth: "^src/server/(auth-mode|local-admin-login)\\.ts$",
  apiRoutes: "^src/app/api/",
  serverPages: serverPageFiles().map((f) => `^${escape(f)}$`),
  // Client components under app/ (every app file that isn't a server page
  // or an API route), components/, hooks, context and the tRPC client.
  ui: "^src/(components/|app/|lib/(hooks|context)/|lib/(trpc|privacy-text-guard)\\.ts$)",
  worker: "^src/workers/",
  scripts: "^(scripts/|db-migrate\\.ts$)",
};

/** The src/ modules db-migrate.ts imports: esbuild bundles them into the
 *  image's migrator, which runs with no src/, env or Next. */
const MIGRATOR_SRC =
  "^src/lib/(db/(migrate/(reference-reconcile-core|demo-schema-marker|migration-converters|converter-rows|converter-refusal|converter-writes|v0102-match-rate|v0102-match-value|v0106-retirement-people|v0106-budget-amounts|v0106-net-pay-snapshot|v0106-credentials|v0106-mapping-ids|v0106-joint-person-ids|v0106-cached-months|v0106-stored-json|v0106-salary-entries|v0106-active-fields|v0106-performance-category|v0106-retired-limits|v0106-after-tax-exempt|frozen-shape)|backup/(version-tables|backup-file)|env-file)|config/(enum-values|budget-apps|filing-status)|utils/match-rate|crypto-envelope)\\.ts$";

const L = LAYERS;
const ABOVE_FOUNDATION = `${L.shapes}|${L.pure}|${L.infra}|^src/server/|^src/components/|^src/app/`;
// Resolved npm paths (pnpm's `.pnpm/<pkg>@<v>/node_modules/<pkg>/` too).
const IO_PACKAGES =
  "node_modules/(drizzle-orm|better-sqlite3|postgres|pg|next|react|react-dom|server-only|@trpc/server|@trpc/client|@trpc/react-query)/";

/** Cruise options, shared by the layer check and the Zod reach below. */
const OPTIONS = {
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
};

/** Imports that add nothing to a bundle: `import type`, `import("x").T`. */
const TYPE_LEVEL = ["type-only", "type-import"];

/**
 * What a client module must not value-import: Zod itself, and every non-UI
 * src module whose value imports reach it. A `reachable` rule can't say
 * this: it follows type-only imports too, and every UI file reaches all of
 * Zod through lib/trpc.ts's `import type` of the router. So one cruise of
 * src with the same options finds the value-import reach first.
 */
async function zodReachers() {
  const { output } = await cruise(
    ["src"],
    structuredClone(OPTIONS),
    {},
    {
      tsConfig: extractTSConfig(OPTIONS.tsConfig.fileName),
    },
  );
  const isValue = (d) => !d.dependencyTypes.some((t) => TYPE_LEVEL.includes(t));
  const reaches = new Set();
  for (let grew = true; grew;) {
    grew = false;
    for (const m of output.modules) {
      if (reaches.has(m.source)) continue;
      const hit = m.dependencies.some(
        (d) =>
          isValue(d) &&
          (d.resolved.includes("node_modules/zod/") || reaches.has(d.resolved)),
      );
      if (hit) reaches.add(m.source);
      grew ||= hit;
    }
  }
  const ui = new RegExp(LAYERS.ui);
  const outside = [...reaches].filter((s) => !ui.test(s)).sort();
  return ["node_modules/zod/", ...outside.map((s) => `^${escape(s)}$`)].join(
    "|",
  );
}
const ZOD_REACHERS = await zodReachers();

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
      name: "engine-through-index",
      severity: "error",
      comment: "Resolved paths: relative imports count as much as @/ ones.",
      from: { path: "^src/", pathNot: L.engine },
      to: { path: L.engine, pathNot: `${L.engine}(types/)?index\\.ts$` },
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
      name: "server-files-in-a-layer",
      severity: "error",
      comment:
        "A src/server/ file outside every layer is checked by no direction rule (it could import routers): add its folder to LAYERS.",
      from: {
        path: "^src/server/",
        pathNot: [L.data, L.services, L.routers, L.serverCore, L.serverAuth],
      },
      to: {},
    },
    {
      name: "lib-files-in-a-layer",
      severity: "error",
      comment:
        "A src/lib/ file outside every layer is checked by no direction rule: add its folder to LAYERS.",
      from: {
        path: "^src/lib/",
        pathNot: [L.foundation, L.shapes, L.pure, L.infra, L.ui],
      },
      to: {},
    },
    {
      name: "server-auth-below-server",
      severity: "error",
      from: { path: L.serverAuth },
      to: { path: "^src/server/", pathNot: L.serverAuth },
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
          "^src/server/((trpc-server|auth)\\.ts$|data/database-status\\.ts$)",
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
      name: "server-never-imports-ui",
      severity: "error",
      comment: "Type-only too: shared shapes live in lib/pure or lib/db.",
      from: { path: `^src/server/|${L.pure}` },
      to: { path: L.ui },
    },
    {
      name: "ui-never-runs-infra",
      severity: "error",
      comment: "lib/db and other infrastructure at runtime; types are allowed.",
      from: { path: L.ui, pathNot: [...L.serverPages, L.apiRoutes] },
      to: { path: L.infra, dependencyTypesNot: ["type-only"] },
    },
    {
      name: "ui-never-bundles-zod",
      severity: "error",
      comment:
        "A value import that reaches Zod puts it in the page's bundle (v0.10.1: +30 KB on Settings and Expenses); type-only imports add nothing. The target is where the import leaves the UI: Zod, or a non-UI module whose value imports reach it.",
      from: { path: L.ui, pathNot: [...L.serverPages, L.apiRoutes] },
      to: { path: ZOD_REACHERS, dependencyTypesNot: TYPE_LEVEL },
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
      name: "migrator-imports-listed-src",
      severity: "error",
      from: { path: "^db-migrate\\.ts$" },
      to: { path: "^src/", pathNot: MIGRATOR_SRC },
    },
    {
      name: "migrator-src-stays-standalone",
      severity: "error",
      from: { path: MIGRATOR_SRC },
      to: { dependencyTypesNot: ["core"], pathNot: MIGRATOR_SRC },
    },
    {
      name: "scripts-skip-server",
      severity: "error",
      from: { path: L.scripts },
      to: { path: "^src/server/" },
    },
  ],
  options: OPTIONS,
};

export default config;
