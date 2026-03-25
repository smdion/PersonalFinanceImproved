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
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
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
    ignores: [".next/", "node_modules/", ".scratch/"],
  },
];
export default config;
