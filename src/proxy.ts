import { NextResponse, type NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/server/auth.config";
import { devBypass } from "@/server/auth-mode";

const isDemoOnly = process.env.DEMO_ONLY === "true";

// The edge-compatible auth config (no DB imports). A page request without a
// session goes to /login; the dashboard layout, tRPC and the API routes
// still check the session with the full config (auth.ts).
const { auth } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    // Only `next dev` skips sign-in (auth-mode.ts), as the layout does.
    authorized: ({ auth: session }) => devBypass() !== null || !!session?.user,
  },
});

// In demo-only mode, skip auth entirely: no login required.
export function proxy(request: NextRequest) {
  if (isDemoOnly) {
    return NextResponse.next();
  }
  // @ts-expect-error -- NextAuth middleware accepts NextRequest at runtime
  return auth(request);
}

export const config = {
  // Not the sign-in page or the files it loads (its icon, Next's assets).
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|login).*)"],
};
