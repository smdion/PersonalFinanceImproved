/** Whether this request runs inside a demo profile (its cookie), for the
 *  routes outside tRPC, whose demo schema switch they don't get. */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DEMO_COOKIE, isDemoProfileSlug } from "@/lib/demo/slugs";

/** A 409 while a demo profile is active: the versions routes read and write
 *  the household's own data, not the demo the browser is showing. */
export async function refuseWhileDemoActive(
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
