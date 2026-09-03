"use client";

import { useState } from "react";
import { Sidebar } from "./sidebar";

export function DashboardLayout({
  user,
  isDemoOnly,
  children,
}: {
  user: { name: string; role: string };
  isDemoOnly?: boolean;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="flex min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-1/2 focus:z-50 focus:-translate-x-1/2 focus:rounded-md focus:bg-blue-600 focus:px-4 focus:py-2 focus:text-sm focus:text-white focus:shadow-lg"
      >
        Skip to main content
      </a>
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        // print:hidden — this button is a sibling of <aside>, not inside
        // it, so globals.css's `aside { display: none }` print rule never
        // catches it (found live, 2026-08-31: it printed on top of the
        // advisor report's title).
        className="bg-surface-primary text-primary fixed top-2 left-2 z-30 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2.5 shadow-lg focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none md:hidden print:hidden"
        aria-label="Open navigation menu"
      >
        <svg
          aria-hidden="true"
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 6h16M4 12h16M4 18h16"
          />
        </svg>
      </button>
      <Sidebar
        user={user}
        isDemoOnly={isDemoOnly}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
      />
      <main
        id="main-content"
        tabIndex={-1}
        className="bg-surface-sunken text-primary flex-1 overflow-auto outline-none"
      >
        {children}
      </main>
    </div>
  );
}
