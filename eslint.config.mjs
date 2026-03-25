import nextConfig from "eslint-config-next";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

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
    ignores: [".next/", "node_modules/", ".scratch/", "coverage/"],
  },
];
export default config;
