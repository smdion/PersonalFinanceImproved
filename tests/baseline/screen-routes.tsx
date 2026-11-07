/**
 * The routes and households the screens baseline pins (screens.test.tsx).
 *
 * Routes: every page v0.10.4 touches (the ten client pages, the expenses
 * page, and retirement, contributions, portfolio, budget, brokerage and the
 * dashboard), each by the component its `page.tsx` renders. Loaded lazily,
 * so the test's mocks are in place first.
 */
import type { ComponentType } from "react";

export interface ScreenRoute {
  /** The URL path. */
  route: string;
  /** The pin's file name under `__screens__/<household>/`. */
  file: string;
  load: () => Promise<ComponentType>;
}

export const SCREEN_ROUTES: ScreenRoute[] = [
  {
    route: "/",
    file: "dashboard",
    load: async () =>
      (await import("@/app/(dashboard)/dashboard-content")).DashboardContent,
  },
  {
    route: "/brokerage",
    file: "brokerage",
    load: async () =>
      (await import("@/app/(dashboard)/brokerage/brokerage-content"))
        .BrokerageContent,
  },
  {
    route: "/budget",
    file: "budget",
    load: async () => {
      const { BudgetContent } =
        await import("@/app/(dashboard)/budget/budget-content");
      return function BudgetPage() {
        return <BudgetContent section="budget" />;
      };
    },
  },
  {
    route: "/contributions",
    file: "contributions",
    load: async () =>
      (await import("@/app/(dashboard)/contributions/contributions-content"))
        .ContributionsContent,
  },
  {
    route: "/expenses",
    file: "expenses",
    load: async () =>
      (await import("@/app/(dashboard)/expenses/expenses-content"))
        .ExpensesContent,
  },
  {
    route: "/historical",
    file: "historical",
    load: async () =>
      (await import("@/app/(dashboard)/historical/historical-content"))
        .HistoricalContent,
  },
  {
    route: "/house",
    file: "house",
    load: async () =>
      (await import("@/app/(dashboard)/house/house-content")).HouseContent,
  },
  {
    route: "/liabilities",
    file: "liabilities",
    load: async () =>
      (await import("@/app/(dashboard)/liabilities/liabilities-content"))
        .LiabilitiesContent,
  },
  {
    route: "/networth",
    file: "networth",
    load: async () =>
      (await import("@/app/(dashboard)/networth/networth-content"))
        .NetWorthContent,
  },
  {
    route: "/paycheck",
    file: "paycheck",
    load: async () =>
      (await import("@/app/(dashboard)/paycheck/paycheck-content")).default,
  },
  {
    route: "/portfolio",
    file: "portfolio",
    load: async () =>
      (await import("@/app/(dashboard)/portfolio/portfolio-content"))
        .PortfolioContent,
  },
  {
    route: "/retirement",
    file: "retirement",
    load: async () =>
      (await import("@/app/(dashboard)/retirement/retirement-content"))
        .RetirementContent,
  },
  {
    route: "/savings",
    file: "savings",
    load: async () => (await import("@/app/(dashboard)/savings/page")).default,
  },
  {
    route: "/settings",
    file: "settings",
    load: async () => (await import("@/app/(dashboard)/settings/page")).default,
  },
  {
    route: "/tools",
    file: "tools",
    load: async () => (await import("@/app/(dashboard)/tools/page")).default,
  },
  {
    route: "/upkeep/utilities",
    file: "upkeep-utilities",
    load: async () =>
      (await import("@/app/(dashboard)/upkeep/utilities/page")).default,
  },
  {
    route: "/versions",
    file: "versions",
    load: async () => (await import("@/app/(dashboard)/versions/page")).default,
  },
];

/** Household keys (households.ts); screens.test.tsx says why these. */
export const SCREEN_HOUSEHOLDS = ["e2e-b", "ws-h2", "e2e-d"] as const;
