import nextConfig from "eslint-config-next";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// Local plugin so this check's severity doesn't have to share an options
// array (and therefore a severity) with the unrelated "as unknown as" ban —
// no-restricted-syntax only accepts one severity per matching config block.
const localRules = {
  rules: {
    "no-hex-color-literal": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow hardcoded hex color literals; use @/lib/utils/colors.ts instead.",
        },
        schema: [],
      },
      create(context) {
        return {
          Literal(node) {
            if (
              typeof node.value === "string" &&
              HEX_COLOR_PATTERN.test(node.value)
            ) {
              context.report({
                node,
                message:
                  "Hardcoded hex color. Use a named export from @/lib/utils/colors.ts instead (account/tax-type helpers, STATUS_COLORS, or a chart-series constant).",
              });
            }
          },
        };
      },
    },
    "no-tz-unsafe-date-string": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow deriving a calendar day from a Date via .toISOString() — it renders in UTC, so the day is wrong (tomorrow) for a user behind UTC every evening. Use localDateStr() from @/lib/utils/date.ts.",
        },
        schema: [],
      },
      create(context) {
        const MSG =
          ".toISOString() renders in UTC, so slicing/splitting a calendar day off it is tomorrow's date for any user behind UTC every evening. Use localDateStr(d) from @/lib/utils/date.ts. If a UTC string is genuinely intended (an internal key never compared to a local day), add an eslint-disable with that justification.";
        const isToISOStringCall = (n) =>
          n &&
          n.type === "CallExpression" &&
          n.callee.type === "MemberExpression" &&
          n.callee.property.type === "Identifier" &&
          n.callee.property.name === "toISOString";
        return {
          // d.toISOString().slice(0, N) / .substring(0, N)
          "CallExpression[callee.type='MemberExpression']"(node) {
            const prop = node.callee.property;
            if (
              prop.type === "Identifier" &&
              (prop.name === "slice" || prop.name === "substring") &&
              isToISOStringCall(node.callee.object)
            ) {
              context.report({ node, message: MSG });
            }
          },
          // d.toISOString().split("T")[0]
          "MemberExpression[computed=true]"(node) {
            if (
              node.object.type === "CallExpression" &&
              node.object.callee.type === "MemberExpression" &&
              node.object.callee.property.type === "Identifier" &&
              node.object.callee.property.name === "split" &&
              isToISOStringCall(node.object.callee.object)
            ) {
              context.report({ node, message: MSG });
            }
          },
        };
      },
    },
  },
};

const config = [
  ...nextConfig,
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "no-restricted-syntax": [
        "warn",
        {
          selector: "TSAsExpression > TSUnknownKeyword",
          message:
            "Avoid 'as unknown as' casts. Create a typed wrapper or use Zod parsing. Add eslint-disable with justification if unavoidable (e.g. Drizzle ORM).",
        },
      ],
      "no-empty": ["warn", { allowEmptyCatch: false }],
      "react/no-array-index-key": "warn",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/logger.ts",
      "src/lib/error-reporting.ts",
      "src/lib/env.ts",
      "src/app/**/error.tsx",
      "src/app/**/global-error.tsx",
    ],
    rules: {
      "no-console": ["warn", { allow: ["warn"] }],
    },
  },
  {
    files: ["src/components/**/*.{ts,tsx}"],
    plugins: { local: localRules },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/server/*",
                "../server/*",
                "../../server/*",
                "../../../server/*",
              ],
              message:
                "Components cannot import server modules directly. Use tRPC queries instead.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "warn",
        {
          selector: "TSAsExpression > TSUnknownKeyword",
          message:
            "Avoid 'as unknown as' casts. Create a typed wrapper or use Zod parsing. Add eslint-disable with justification if unavoidable (e.g. Drizzle ORM).",
        },
      ],
      "local/no-hex-color-literal": "error",
    },
  },
  {
    files: [
      "src/server/**/*.ts",
      "src/lib/pure/**/*.ts",
      "src/lib/calculators/**/*.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: "TSAsExpression > TSUnknownKeyword",
          message:
            "Avoid 'as unknown as' casts. Create a typed wrapper or use Zod parsing.",
        },
        {
          selector:
            "MemberExpression[object.name='ACCOUNT_TYPE_CONFIG'][computed=true]",
          message:
            "Use getAccountTypeConfig() or other helpers from @/lib/config/account-types instead of direct ACCOUNT_TYPE_CONFIG[] access. Data-driven design: config access goes through functions.",
        },
      ],
    },
  },
  {
    // App-wide: no UTC calendar-day extraction from a Date. localStorage
    // date keys, filter bounds, stored year-end dates, and cache keys built
    // with `d.toISOString().slice(0, 10)` are all silently a day off for
    // any US user every evening.
    files: ["src/**/*.{ts,tsx}"],
    plugins: { local: localRules },
    rules: { "local/no-tz-unsafe-date-string": "error" },
  },
  {
    // date.ts documents the anti-pattern (it's the helper's reason to
    // exist); paycheck.ts builds payday strings with Date.UTC(...) and
    // reads them back the same way — internally UTC-consistent, reviewed.
    files: ["src/lib/utils/date.ts", "src/lib/calculators/paycheck.ts"],
    rules: { "local/no-tz-unsafe-date-string": "off" },
  },
  {
    files: ["src/lib/pure/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/server/helpers",
              message:
                "Pure modules cannot import the helpers barrel (it pulls in DB code). Use specific submodules like @/server/helpers/transforms.",
            },
            {
              name: "@/lib/db",
              message: "Pure modules cannot import database code directly.",
            },
          ],
          patterns: [
            {
              group: ["@/lib/db/*", "drizzle-orm", "drizzle-orm/*"],
              message: "Pure modules cannot import DB or ORM code.",
            },
          ],
        },
      ],
    },
  },
  {
    // Tool/plugin-managed directories, not app source — none of these are
    // committed to the repo (all gitignored or untracked scratch state),
    // same category as .claude/worktrees/ above.
    ignores: [
      ".next/",
      "node_modules/",
      ".scratch/",
      "coverage/",
      ".claude/worktrees/",
      ".claude/skills/",
      ".github/skills/",
      ".github/agents/",
      ".github/hooks/",
      // Generated by esbuild (pnpm build:mc-worker) — gitignored, same
      // category as db-migrate.js's own tsc-compiled output.
      "monte-carlo-worker.js",
      "db-migrate.js",
    ],
  },
];
export default config;
