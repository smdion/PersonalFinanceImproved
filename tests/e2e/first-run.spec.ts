import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * A fresh self-hosted install, start to finish: the real image booted from
 * the sample compose on an empty volume (scripts/ci-image-boot.sh, once for
 * SQLite and once for PostgreSQL), no DEMO_ONLY, no Authentik. The first
 * visit is sent to /login, which offers creating the first local admin;
 * that account signs in, the onboarding wizard runs through to Done, and
 * a second browser then signs in with the same account.
 *
 * Runs only when E2E_FIRST_RUN=true, against PLAYWRIGHT_BASE_URL: it needs
 * an install with no admin and no people, which CI's DEMO_ONLY E2E run
 * isn't. The tests share one install, so they run in order and never retry
 * (a retry would meet the admin the first attempt created).
 *
 * The household is invented.
 */
const ADMIN = {
  name: "Boot Test Admin",
  email: "boot-admin@example.com",
  password: "BootTest-Passw0rd",
};

test.describe.configure({ mode: "serial", retries: 0 });

test.describe("First run on an empty install", () => {
  test.skip(
    process.env.E2E_FIRST_RUN !== "true",
    "Needs an empty install with sign-in: scripts/ci-image-boot.sh sets E2E_FIRST_RUN",
  );

  /** A tRPC query's data, through the given request context's session. */
  async function trpcQuery(
    request: APIRequestContext,
    path: string,
  ): Promise<unknown> {
    const response = await request.get(`/api/trpc/${path}`);
    expect(response.status(), `${path} status`).toBe(200);
    const body = (await response.json()) as { result: { data: unknown } };
    return body.result.data;
  }

  test("creates the first admin and runs the wizard to Done", async ({
    page,
  }) => {
    // No session: the dashboard sends the visitor to /login, which offers
    // the first admin because the install has none.
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(
      page.getByRole("heading", { name: "Create the first admin" }),
    ).toBeVisible();

    await page.getByLabel("Name", { exact: true }).fill(ADMIN.name);
    await page.getByLabel("Email", { exact: true }).fill(ADMIN.email);
    await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
    await page.getByLabel("Confirm password").fill(ADMIN.password);
    await page
      .getByRole("button", { name: "Create admin and sign in" })
      .click();

    // Signed in: the dashboard opens the onboarding wizard. The admin
    // exists now, so the wizard has no Admin step.
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    await expect(page.getByText("Welcome to Ledgr!")).toBeVisible({
      timeout: 15_000,
    });

    // "Get Started" waits for the first-run query; retry the click until
    // the next step shows.
    await expect(async () => {
      await page.getByRole("button", { name: "Get Started" }).click();
      await expect(
        page.getByRole("heading", { name: "Connect to Authentik" }),
      ).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await expect(page.getByText("Step 2 of 5")).toBeVisible();
    await page.getByRole("button", { name: "Configure Later" }).click();

    await expect(
      page.getByRole("heading", { name: "Household Members" }),
    ).toBeVisible();
    await page.getByPlaceholder("Name").fill("Avery Example");
    await page.getByPlaceholder("Birth year").fill("1985");
    await page.getByRole("button", { name: "Add Person" }).click();
    await expect(page.getByText("(born 1985)")).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByRole("heading", { name: "Income" })).toBeVisible();
    await page.getByPlaceholder("Employer name").fill("Example Works");
    await page.getByPlaceholder("Annual salary").fill("85000");
    await page.getByRole("button", { name: "Add Job" }).click();
    await expect(page.getByText("Example Works")).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByText("You're all set!")).toBeVisible();
    // No weekly request to GitHub from a CI run.
    await page.getByRole("checkbox").uncheck();
    await page.getByRole("button", { name: "Go to Dashboard" }).click();

    // Done saved everything and closed the wizard.
    await expect(page.getByText("You're all set!")).toBeHidden({
      timeout: 30_000,
    });
    expect(
      await trpcQuery(page.request, "settings.isOnboardingComplete"),
    ).toEqual({ complete: true });
    expect(await trpcQuery(page.request, "settings.firstRunState")).toEqual({
      adminNeeded: false,
    });

    // A reload keeps the wizard closed.
    await page.reload();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText("Welcome to Ledgr!")).toBeHidden();
  });

  test("a new browser signs in with the admin; no second admin is offered", async ({
    page,
  }) => {
    // Each test gets its own browser context: no session from the test above.
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(
      page.getByRole("heading", { name: "Create the first admin" }),
    ).toHaveCount(0);

    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    expect(
      await trpcQuery(page.request, "settings.isOnboardingComplete"),
    ).toEqual({ complete: true });
    await expect(page.getByText("Welcome to Ledgr!")).toBeHidden();
  });
});
