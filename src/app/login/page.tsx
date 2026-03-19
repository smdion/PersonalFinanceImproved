import { Suspense } from "react";
import { LoginForm } from "./login-form";

const hasOidc = !!process.env.AUTH_AUTHENTIK_ISSUER;

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm hasOidc={hasOidc} />
    </Suspense>
  );
}
