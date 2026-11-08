import { test, expect } from "@playwright/test";
import { useOwnRateLimitBucket } from "./rate-limit-bucket";

// A page loads with no uncaught error, a hydration mismatch (React #418)
// above all: the layout hydrates the shell's queries (prefetchForShell).
test.describe("page load", () => {
  useOwnRateLimitBucket(test, "hydration");

  for (const path of ["/", "/budget"]) {
    test(`${path} loads without a page error`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible({ timeout: 30_000 });
      await page.waitForLoadState("networkidle");
      expect(errors).toEqual([]);
    });
  }
});
