// eslint-disable-next-line no-restricted-imports -- Server Component, server-side only
import { auth } from "@/server/auth";
// eslint-disable-next-line no-restricted-imports -- Server Component, server-side only
import type { Permission } from "@/server/auth";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardLayout as DashboardLayoutClient } from "@/components/layout/dashboard-layout";
import { DashboardShell } from "./dashboard-shell";
import { UserProvider } from "@/lib/context/user-context";
import { DemoBanner } from "@/components/layout/demo-banner";
import { DEMO_PROFILES } from "@/lib/demo";
import { db, isPostgres } from "@/lib/db";
import { sql } from "drizzle-orm";

const isDev = !process.env.AUTH_AUTHENTIK_ISSUER;
const isDemoOnly = process.env.DEMO_ONLY === "true";

const devUser: {
  id: string;
  name: string;
  email: string;
  role: "admin" | "viewer";
  permissions: Permission[];
} = {
  id: "1",
  name: "Admin",
  email: "admin@dev.local",
  role: "admin",
  permissions: [],
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user = devUser;

  if (isDemoOnly) {
    user = {
      id: "demo",
      name: "Demo User",
      email: "demo@demo.local",
      role: "viewer",
      permissions: [],
    };
  } else if (!isDev) {
    const session = await auth();
    if (!session?.user) {
      redirect("/login");
    }
    user = session.user;
  }

  // Check database connectivity before rendering dashboard
  // PG exposes async db.execute(); SQLite (better-sqlite3) only has db.all()/db.get().
  let dbError: string | null = null;
  try {
    if (isPostgres()) {
      await db.execute(sql`SELECT 1`);
    } else {
      // eslint-disable-next-line no-restricted-syntax -- Drizzle ORM type limitation
      (db as unknown as { all: (q: unknown) => unknown }).all(sql`SELECT 1`);
    }
    // Verify at least one core table exists
    const { tableExistsSQL } = await import("@/lib/db/compat");
    const query = tableExistsSQL("people");
    let hasTable: boolean;
    if (isPostgres()) {
      const result = await db.execute(query);
      hasTable = (result.rows[0] as { has_tables: boolean })?.has_tables;
    } else {
      // eslint-disable-next-line no-restricted-syntax -- Drizzle ORM type limitation
      const rows = (db as unknown as { all: (q: unknown) => unknown[] }).all(
        query,
      );
      hasTable = (rows[0] as { has_tables: number })?.has_tables === 1;
    }
    if (!hasTable) {
      dbError =
        "Database tables not found. Migrations may need to run. Please restart the application.";
    }
  } catch {
    dbError =
      "Unable to connect to the database. Please check your database configuration and ensure the database server is running.";
  }

  if (dbError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-primary">
        <div className="max-w-lg mx-4 p-8 rounded-2xl bg-surface-elevated border border-default shadow-xl text-center">
          <div className="text-4xl mb-4">&#x26A0;</div>
          <h1 className="text-2xl font-bold text-primary mb-3">
            Database Unavailable
          </h1>
          <p className="text-muted mb-6">{dbError}</p>
          <Link
            href="/"
            className="inline-block px-6 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
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
  const demoProfile = demoSlug ? DEMO_PROFILES[demoSlug] : null;

  // In demo-only mode, require a demo profile to be active
  if (isDemoOnly && !demoProfile) {
    redirect("/demo");
  }

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[200] focus:top-2 focus:left-2 focus:bg-surface-primary focus:text-blue-700 focus:px-4 focus:py-2 focus:rounded focus:shadow-lg"
      >
        Skip to content
      </a>
      {demoProfile && (
        <DemoBanner profileName={demoProfile.name} isDemoOnly={isDemoOnly} />
      )}
      <DashboardLayoutClient user={user} isDemoOnly={isDemoOnly}>
        <UserProvider
          user={{
            name: user.name,
            role: user.role,
            permissions: user.permissions,
          }}
        >
          <DashboardShell>{children}</DashboardShell>
        </UserProvider>
      </DashboardLayoutClient>
    </>
  );
}
