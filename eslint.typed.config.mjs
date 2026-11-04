// Type-aware ratchet, run apart from `pnpm lint` (type-aware linting is too
// heavy for every save): `pnpm lint:typed`, CI only. Today's cases are in
// eslint-suppressions-typed.json and only go down. The script passes
// --no-inline-config: this config loads one rule, so directives naming the
// others would fail as undefined rules.
import nextTypescript from "eslint-config-next/typescript";

const tsPlugin = nextTypescript.find((c) => c.plugins?.["@typescript-eslint"])
  .plugins["@typescript-eslint"];
const tsParser = nextTypescript.find((c) => c.languageOptions?.parser)
  .languageOptions.parser;

const config = [
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: { "@typescript-eslint/no-unnecessary-condition": "error" },
  },
];
export default config;
