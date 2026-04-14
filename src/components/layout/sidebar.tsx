"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { DataFreshness } from "./data-freshness";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  Wallet,
  ClipboardList,
  Receipt,
  TrendingUp,
  Trophy,
  Gem,
  Palmtree,
  BarChart3,
  Home,
  CreditCard,
  Building2,
  PiggyBank,
  ScrollText,
  Wrench,
  Save,
  Settings,
  ChevronsLeft,
  ChevronRight,
  ArrowLeftRight,
  Search,
  Landmark,
  Cog,
  LogOut,
  HelpCircle,
  Layers,
  Database,
  type LucideIcon,
} from "lucide-react";

// ── Navigation data structure ──

type NavItem = { href: string; label: string; Icon: LucideIcon };
type NavGroup = { label: string; Icon: LucideIcon; items: NavItem[] };
type NavEntry = NavItem | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return "items" in entry;
}

const navStructure: NavEntry[] = [
  { href: "/", label: "Dashboard", Icon: LayoutDashboard },
  {
    label: "Cash Flow",
    Icon: ArrowLeftRight,
    items: [
      { href: "/paycheck", label: "Paycheck", Icon: Wallet },
      { href: "/budget", label: "Budget", Icon: ClipboardList },
      { href: "/expenses", label: "Expenses", Icon: Receipt },
    ],
  },
  {
    label: "Wealth",
    Icon: TrendingUp,
    items: [
      { href: "/savings", label: "Savings", Icon: PiggyBank },
      { href: "/portfolio", label: "Portfolio", Icon: Gem },
      { href: "/performance", label: "Performance", Icon: Trophy },
      { href: "/brokerage", label: "Brokerage", Icon: BarChart3 },
    ],
  },
  {
    label: "Net Worth",
    Icon: Landmark,
    items: [
      { href: "/house", label: "House", Icon: Home },
      { href: "/assets", label: "Assets", Icon: Building2 },
      { href: "/liabilities", label: "Liabilities", Icon: CreditCard },
      { href: "/networth", label: "Trends", Icon: TrendingUp },
      { href: "/historical", label: "Historical", Icon: ScrollText },
    ],
  },
  {
    label: "Analysis",
    Icon: Search,
    items: [
      { href: "/retirement", label: "Retirement", Icon: Palmtree },
      { href: "/contributions", label: "Contributions", Icon: Layers },
      { href: "/tools", label: "Tools", Icon: Wrench },
    ],
  },
  {
    label: "System",
    Icon: Cog,
    items: [
      { href: "/versions", label: "Versions", Icon: Save },
      { href: "/settings", label: "Settings", Icon: Settings },
      { href: "/data-browser", label: "Raw Data", Icon: Database },
    ],
  },
];

// ── Components ──

function NavLink({
  item,
  pathname,
  collapsed,
  showLabels,
  onMobileClose,
  indent = false,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  showLabels: boolean;
  onMobileClose: () => void;
  indent?: boolean;
}) {
  const isActive =
    pathname === item.href ||
    (item.href !== "/" && pathname.startsWith(item.href + "/"));
  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      onClick={onMobileClose}
      title={collapsed ? item.label : undefined}
      className={`flex items-center gap-3 px-3 py-1.5 rounded text-sm transition-all duration-150 ${
        indent && !collapsed ? "ml-4" : ""
      } ${collapsed ? "md:justify-center" : ""} ${
        isActive
          ? "bg-surface-elevated/60 text-white border-l-[3px] border-sky-400"
          : "text-faint hover:bg-surface-elevated border-l-[3px] border-transparent"
      }`}
    >
      <item.Icon className="w-4 h-4 shrink-0" />
      {showLabels && <span className="hidden md:inline">{item.label}</span>}
      <span className="md:hidden">{item.label}</span>
    </Link>
  );
}

function CollapsibleNavGroup({
  group,
  pathname,
  collapsed,
  showLabels,
  onMobileClose,
}: {
  group: NavGroup;
  pathname: string;
  collapsed: boolean;
  showLabels: boolean;
  onMobileClose: () => void;
}) {
  const hasActiveChild = group.items.some(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/"),
  );
  const [isOpen, setIsOpen] = useState(hasActiveChild);

  // In collapsed mode, show only group icon (items visible on expand)
  if (collapsed) {
    return (
      <div className="space-y-0.5">
        {group.items.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            pathname={pathname}
            collapsed={collapsed}
            showLabels={showLabels}
            onMobileClose={onMobileClose}
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        aria-expanded={isOpen}
        aria-label={`${isOpen ? "Collapse" : "Expand"} ${group.label}`}
        className="w-full flex items-center gap-3 px-3 py-1.5 rounded text-sm text-faint hover:text-primary hover:bg-surface-elevated/50 transition-colors"
      >
        <group.Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
        {showLabels && (
          <span className="hidden md:inline flex-1 text-left text-xs font-semibold uppercase tracking-wider">
            {group.label}
          </span>
        )}
        <span className="md:hidden flex-1 text-left text-xs font-semibold uppercase tracking-wider">
          {group.label}
        </span>
        <ChevronRight
          aria-hidden="true"
          className={`w-3 h-3 shrink-0 transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
        />
      </button>
      {isOpen && (
        <div className="mt-0.5 space-y-0.5">
          {group.items.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              pathname={pathname}
              collapsed={collapsed}
              showLabels={showLabels}
              onMobileClose={onMobileClose}
              indent
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  user,
  isDemoOnly,
  mobileOpen,
  onMobileClose,
  collapsed,
  onToggleCollapse,
}: {
  user: { name: string; role: string };
  isDemoOnly?: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const pathname = usePathname();
  const showLabels = !collapsed;

  const helpItem: NavItem = { href: "/help", label: "Help", Icon: HelpCircle };

  return (
    <>
      {/* Mobile backdrop overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={onMobileClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 transform transition-all duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0 md:static md:h-screen md:sticky md:top-0 ${
          collapsed ? "md:w-16" : "md:w-64"
        } w-64 dark bg-surface-primary text-white flex flex-col`}
      >
        <div className="p-4 border-b">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <svg
              aria-hidden="true"
              width="24"
              height="24"
              viewBox="0 0 32 32"
              className="shrink-0"
            >
              <rect
                width="32"
                height="32"
                rx="6"
                className="fill-slate-700 dark:fill-slate-600"
              />
              <path
                d="M10 6 L10 24 L22 24"
                stroke="#38bdf8"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <line
                x1="14"
                y1="14"
                x2="20"
                y2="14"
                stroke="#38bdf8"
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.5"
              />
              <line
                x1="14"
                y1="18"
                x2="18"
                y2="18"
                stroke="#38bdf8"
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.5"
              />
            </svg>
            {showLabels ? (
              <span className="hidden md:inline">Ledgr</span>
            ) : null}
            <span className="md:hidden">Ledgr</span>
          </h1>
          {showLabels && (
            <p className="text-sm text-faint hidden md:block">
              {user.name} ({user.role})
            </p>
          )}
        </div>
        <nav
          aria-label="Main navigation"
          className="flex-1 overflow-y-auto p-2 space-y-1"
        >
          {navStructure.map((entry) =>
            isGroup(entry) ? (
              <CollapsibleNavGroup
                key={entry.label}
                group={entry}
                pathname={pathname}
                collapsed={collapsed}
                showLabels={showLabels}
                onMobileClose={onMobileClose}
              />
            ) : (
              <NavLink
                key={entry.href}
                item={entry}
                pathname={pathname}
                collapsed={collapsed}
                showLabels={showLabels}
                onMobileClose={onMobileClose}
              />
            ),
          )}
        </nav>

        {/* Footer */}
        <div className="border-t px-2 py-1.5 space-y-0.5">
          <DataFreshness compact={collapsed} />
          <NavLink
            item={helpItem}
            pathname={pathname}
            collapsed={collapsed}
            showLabels={showLabels}
            onMobileClose={onMobileClose}
          />
          {isDemoOnly ? (
            <Link
              href="/demo"
              onClick={onMobileClose}
              className={`flex items-center gap-3 px-3 py-1.5 rounded text-sm text-faint hover:text-blue-400 hover:bg-surface-elevated transition-colors ${collapsed ? "md:justify-center" : ""}`}
              title={collapsed ? "Switch Profile" : undefined}
            >
              <LogOut className="w-4 h-4 shrink-0" />
              {showLabels && (
                <span className="hidden md:inline">Switch Profile</span>
              )}
              <span className="md:hidden">Switch Profile</span>
            </Link>
          ) : (
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className={`w-full flex items-center gap-3 px-3 py-1.5 rounded text-sm text-faint hover:text-red-400 hover:bg-surface-elevated transition-colors ${collapsed ? "md:justify-center" : ""}`}
              title={collapsed ? "Sign Out" : undefined}
            >
              <LogOut className="w-4 h-4 shrink-0" />
              {showLabels && <span className="hidden md:inline">Sign Out</span>}
              <span className="md:hidden">Sign Out</span>
            </button>
          )}
        </div>

        {/* Mobile theme toggle */}
        <div className="md:hidden px-2 pb-1">
          <ThemeToggle />
        </div>

        {/* Utility bar — theme + collapse + version (desktop only) */}
        <div
          className={`hidden md:flex items-center border-t py-1.5 ${
            collapsed ? "flex-col gap-1 px-0" : "flex-row px-2"
          }`}
        >
          <ThemeToggle compact />
          {!collapsed && <div className="flex-1" />}
          {!collapsed &&
            process.env.APP_VERSION &&
            process.env.APP_VERSION !== "dev" && (
              <span className="text-[10px] text-faint/50 mr-1">
                v{process.env.APP_VERSION}
              </span>
            )}
          <button
            onClick={onToggleCollapse}
            className="p-1 text-faint hover:text-primary transition-colors"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <ChevronsLeft
              className={`w-4 h-4 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </aside>
    </>
  );
}
