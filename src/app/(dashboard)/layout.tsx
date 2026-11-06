import { auth } from "@/server/auth";
import type { Permission } from "@/lib/config/permissions";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardLayout as DashboardLayoutClient } from "@/components/layout/dashboard-layout";
import { DashboardShell } from "./dashboard-shell";
import { UserProvider } from "@/lib/context/user-context";
import { PrivacyProvider } from "@/lib/context/privacy-context";
import { PRIVACY_COOKIE } from "@/lib/utils/format";
import { DemoBanner } from "@/components/layout/demo-banner";
import { getDemoProfile } from "@/lib/demo";
import { databaseStatus } from "@/server/data/database-status";
import { devBypass } from "@/server/auth-mode";

const isDemoOnly = process.env.DEMO_ONLY === "true";

type LayoutUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "viewer";
  permissions: Permission[];
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The same rule as every request's session (auth-mode.ts): only `next dev`
  // skips sign-in; any other build signs in, Authentik configured or not.
  const bypass = devBypass();
  let user: LayoutUser;

  if (isDemoOnly) {
    user = {
      id: "demo",
      name: "Demo User",
      email: "demo@demo.local",
      role: "viewer",
      permissions: [],
    };
  } else if (bypass) {
    user = {
      id: "1",
      name: bypass === "admin" ? "Admin" : "Viewer",
      email: "admin@dev.local",
      role: bypass,
      permissions: [],
    };
  } else {
    const session = await auth();
    if (!session?.user) {
      redirect("/login");
    }
    user = session.user;
  }

  const dbError = await databaseStatus();

  if (dbError) {
    return (
      <div className="bg-surface-primary flex min-h-screen items-center justify-center">
        <div className="bg-surface-elevated border-default mx-4 max-w-lg rounded-2xl border p-8 text-center shadow-xl">
          <div className="mb-4 text-4xl">&#x26A0;</div>
          <h1 className="text-primary mb-3 text-2xl font-bold">
            Database Unavailable
          </h1>
          <p className="text-muted mb-6">{dbError}</p>
          <Link
            href="/"
            className="inline-block rounded-lg bg-blue-600 px-6 py-2 font-medium text-white transition-colors hover:bg-blue-700"
          >
            Retry
          </Link>
        </div>
      </div>
    );
  }

  // Check for active demo mode
  const cookieStore = await cookies();
  const demoSlug = cookieStore.get("demo_active_profile")?.value;
  const demoProfile = demoSlug ? getDemoProfile(demoSlug) : null;
  const privacy = cookieStore.get(PRIVACY_COOKIE)?.value === "1";

  // In demo-only mode, require a demo profile to be active
  if (isDemoOnly && !demoProfile) {
    redirect("/demo");
  }

  return (
    <>
      <a
        href="#main-content"
        className="focus:bg-surface-primary sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[200] focus:rounded focus:px-4 focus:py-2 focus:text-blue-700 focus:shadow-lg"
      >
        Skip to content
      </a>
      {demoProfile && (
        <DemoBanner profileName={demoProfile.name} isDemoOnly={isDemoOnly} />
      )}
      <PrivacyProvider initialPrivacy={privacy}>
        {/* Wraps the sidebar too, so its Data indicator can check permissions. */}
        <UserProvider
          user={{
            name: user.name,
            role: user.role,
            permissions: user.permissions,
          }}
        >
          <DashboardLayoutClient user={user} isDemoOnly={isDemoOnly}>
            <DashboardShell>{children}</DashboardShell>
          </DashboardLayoutClient>
        </UserProvider>
      </PrivacyProvider>
    </>
  );
}
