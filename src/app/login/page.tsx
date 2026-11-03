/** Login page supporting credential-based and OIDC authentication flows. */

import { Suspense } from "react";
import { connection } from "next/server";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  // Rendered per request, so the Authentik button follows the running
  // server's AUTH_AUTHENTIK_ISSUER (what auth.config.ts registers), not
  // the build machine's.
  await connection();
  const hasOidc = !!process.env.AUTH_AUTHENTIK_ISSUER;
  return (
    <Suspense>
      <LoginForm hasOidc={hasOidc} />
    </Suspense>
  );
}
