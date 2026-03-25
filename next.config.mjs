import { readFileSync } from "fs";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "better-sqlite3",
    "bindings",
    "file-uri-to-path",
    "pg",
    "pgpass",
    "pg-pool",
    "pg-types",
    "postgres-array",
    "postgres-bytea",
    "postgres-date",
    "postgres-interval",
  ],
  // nft traces JS imports but not native binaries. This pulls in the
  // compiled .node file that better-sqlite3 needs at runtime.
  outputFileTracingIncludes: {
    "/**": [
      // Entire drizzle-orm — internal imports cross subpath boundaries
      // unpredictably; enumerating individual subpaths is whack-a-mole.
      "./node_modules/drizzle-orm/**",
      // Native binary — nft can't trace .node files via JS imports
      "./node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/build/Release/*.node",
      // bindings + file-uri-to-path: better-sqlite3 transitive deps.
      // Both hoisted and .pnpm/ paths — covers all Node resolution strategies.
      "./node_modules/bindings/**",
      "./node_modules/file-uri-to-path/**",
      "./node_modules/.pnpm/bindings@*/node_modules/bindings/**",
      "./node_modules/.pnpm/file-uri-to-path@*/node_modules/file-uri-to-path/**",
    ],
  },
  env: {
    APP_VERSION: process.env.APP_VERSION ?? pkg.version ?? "dev",
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "0" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Resource-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
