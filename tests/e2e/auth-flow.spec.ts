import { test, expect } from "@playwright/test";

/**
 * Auth journey — v0.5 expert-review M18.
 *
 * Covers the login page contract: the form fields a real user sees when
 * the server redirects them for auth, and the error-display path that
 * fires when credentials are rejected. In dev mode / demo-only mode the
 * harness auto-injects a session so users never hit /login — this spec
 * hits the route directly to regression-guard the form itself.
 *
 * The credentials-sign-in roundtrip is tested via invalid credentials
 * so it's deterministic: we don't need a real user record, just assert
 * that the form + error display behave correctly when signIn returns
 * an error. Real-credentials success is covered implicitly by dev mode
 * on every other e2e (they all start logged in).
 *
 * Skipped in DEMO_ONLY mode: CI's E2E job runs with DEMO_ONLY=true, which
 * auto-injects `demoOnlySession` at the tRPC layer, so the /login route is
 * functionally unreachable — visiting it redirects into the dashboard
 * before the form hydrates. The login contract only exists on real
 * deployments with authenticated admin users; skipping is correct, not
 * a workaround for a broken test.
 */
const isDemoOnly = process.env.DEMO_ONLY === "true";

test.describe("Auth journey (M18)", () => {
  test.skip(
    isDemoOnly,
    "Login flow is not exposed in DEMO_ONLY mode — demo session is auto-injected",
  );
  test("login page renders the brand + credential form", async ({ page }) => {
    const response = await page.goto("/login");
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(500);

    // Brand identity — a user landing here cold should see what this is.
    await expect(
      page.getByRole("heading", { name: "Ledgr", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("Personal Finance Dashboard")).toBeVisible();

    // The core credential form: labeled email + password + submit.
    const email = page.getByLabel("Email");
    const password = page.getByLabel("Password");
    const submit = page.getByRole("button", { name: "Sign in" });

    await expect(email).toBeVisible();
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toHaveAttribute("required", "");
    await expect(password).toBeVisible();
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveAttribute("required", "");
    await expect(submit).toBeVisible();
    await expect(submit).toBeEnabled();
  });

  test("server error message surfaces from query param", async ({ page }) => {
    // NextAuth redirects back with ?error=<code> on failure. The login
    // form has a mapping table for known codes; CredentialsSignin is
    // the invalid-password path. Users actually see this UI when their
    // password is wrong.
    await page.goto("/login?error=CredentialsSignin");
    await expect(
      page.getByText(/Invalid email or password|incorrect/i),
    ).toBeVisible();
  });

  test("submitting invalid credentials shows the local error banner", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("notarealuser@example.com");
    await page.getByLabel("Password").fill("definitely-wrong-password");

    // Clicking submit fires signIn("local-admin", ...). If local admin
    // isn't configured the endpoint returns a credentials error; if it
    // is configured but these credentials are wrong, same outcome.
    // Either way, the form should end up showing a red error banner
    // and the page should stay on /login (no redirect to a protected
    // route).
    await page.getByRole("button", { name: "Sign in" }).click();

    // Wait for either the error banner or a redirect away. On success
    // we'd be redirected to `/`, which would mean the test fixture has
    // a user with these credentials (it shouldn't).
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(page).toHaveURL(/\/login/);
    // A red error banner appears either inline ("Invalid email or
    // password") or from the ERROR_MESSAGES map.
    const banner = page
      .locator("div")
      .filter({ hasText: /invalid email|incorrect|error occurred/i })
      .first();
    await expect(banner).toBeVisible({ timeout: 5000 });
  });
});
