/** Who may use the versions routes. They run outside tRPC, so none of its
 *  middleware does: this is their gate, `versionProcedure`'s plus the demo
 *  profile rule. */
import type { Session } from "next-auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DEMO_COOKIE, isDemoProfileSlug } from "@/lib/demo/slugs";
import { devBypass } from "@/server/auth-mode";
import { userHasPermission } from "@/server/data/request-scope";

/** A caller the gate let through: an admin's call takes the whole backup. */
export type VersionRouteCaller = { asAdmin: boolean; session: Session | null };

/** A 409 while a demo profile is active: the versions routes read and write
 *  the household's own data, not the demo the browser is showing. */
async function refuseWhileDemoActive(
  action: "import" | "export",
): Promise<Response | null> {
  const slug = (await cookies()).get(DEMO_COOKIE)?.value;
  if (!slug || !isDemoProfileSlug(slug)) return null;
  const what = action === "import" ? "import a backup" : "export your own data";
  return NextResponse.json(
    { error: `A demo profile is active. Leave the demo to ${what}.` },
    { status: 409 },
  );
}

/** The caller of a versions route, or the response that refuses it: 401
 *  signed out, 403 without `version`, 409 in a demo profile. Each route
 *  refuses DEMO_ONLY itself first. `readSession` is the server's `auth`. */
export async function versionRouteCaller(
  action: "import" | "export",
  readSession: () => Promise<Session | null>,
): Promise<VersionRouteCaller | Response> {
  // Only `next dev` with ALLOW_DEV_MODE skips sign-in (auth-mode.ts);
  // validateEnv() refuses it in production.
  const allowDev = devBypass() === "admin";
  const session = await readSession();
  if (!allowDev && !session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!allowDev && !(session && userHasPermission(session.user, "version"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const demoActive = await refuseWhileDemoActive(action);
  if (demoActive) return demoActive;
  return { asAdmin: allowDev || session?.user.role === "admin", session };
}
