import { NextResponse, type NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/server/auth.config";

const isDemoOnly = process.env.DEMO_ONLY === "true";

const { auth } = NextAuth(authConfig);

// Use the edge-compatible auth config (no DB imports) for middleware.
// Full auth (with DB) is only used in server components / API routes.
// In demo-only mode, skip auth entirely — no login required.
export function middleware(request: NextRequest) {
  if (isDemoOnly) {
    return NextResponse.next();
  }
  // @ts-expect-error -- NextAuth middleware accepts NextRequest at runtime
  return auth(request);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|login).*)"],
};
