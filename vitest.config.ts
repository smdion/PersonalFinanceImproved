import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: ["tests/setup-component.ts"],
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      include: ["src/lib/calculators/**", "src/server/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
