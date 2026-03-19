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
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-2 left-2 z-30 p-2 rounded-lg bg-surface-primary text-primary shadow-lg md:hidden"
        aria-label="Open navigation menu"
      >
        <svg
          className="w-5 h-5"
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
        className="flex-1 overflow-auto bg-surface-sunken text-primary"
      >
        {children}
      </main>
    </div>
  );
}
