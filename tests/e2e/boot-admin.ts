import { expect, type Page } from "@playwright/test";

/**
 * The first admin first-run.spec.ts creates on scripts/ci-image-boot.sh's
 * empty install; the non-demo specs that run after it sign in with it.
 * Invented credentials for a throwaway container.
 */
export const BOOT_ADMIN = {
  name: "Boot Test Admin",
  email: "boot-admin@example.com",
  password: "BootTest-Passw0rd",
};

/** Signs in through /login with BOOT_ADMIN and waits to leave it. */
export async function signInAsBootAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(BOOT_ADMIN.email);
  await page.getByLabel("Password").fill(BOOT_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}
