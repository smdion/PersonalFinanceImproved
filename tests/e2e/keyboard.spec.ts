import { test, expect } from "@playwright/test";
import { useOwnRateLimitBucket } from "./rate-limit-bucket";

/**
 * A dialog from the keyboard, through quick search (Ctrl+K opens it on any
 * page, with or without data): Tab stays inside, Escape closes it, and
 * focus goes back to where it was.
 */
test.describe("keyboard dialogs", () => {
  useOwnRateLimitBucket(test, "keyboard");

  test("quick search keeps Tab inside, closes on Escape and returns focus", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("main")).toBeVisible({ timeout: 30_000 });
    // The first-run wizard opens once its query settles and takes focus, so
    // wait for the page to settle before choosing the opener.
    await page.waitForLoadState("networkidle");
    // Whatever the first Tab reaches is the opener.
    await page.keyboard.press("Tab");
    await page.evaluate(() =>
      document.activeElement?.setAttribute("data-opener", ""),
    );
    const opener = page.locator("[data-opener]");
    await expect(opener).toBeFocused();

    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Quick search" });
    await expect(dialog).toBeVisible();
    const box = dialog.getByRole("combobox", { name: "Search pages" });
    await expect(box).toBeFocused();

    for (const key of ["Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
      await page.keyboard.press(key);
      const inside = await dialog.evaluate((el) =>
        el.contains(document.activeElement),
      );
      expect(inside, `focus left the dialog after ${key}`).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
});
