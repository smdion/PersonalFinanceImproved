import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { resetTrpcMock, setQuery } from "./trpc-mock";

// Smoke tests for src/components/settings/tax-data.tsx — the shell that
// consolidates IRS Limits / Tax Brackets / LTCG Brackets / IRMAA Tables /
// ACA-FPL behind one left-column sub-nav + one shared year toggle. The 5
// underlying child components are rendered for real (unmocked), same
// pattern as settings-contribution-limits.test.tsx — only trpc, user
// context, and usePersistedSetting are mocked.

let currentRole: "admin" | "viewer" = "admin";

vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: currentRole, name: "Test", permissions: [] }),
  isAdmin: (u: { role: string }) => u.role === "admin",
}));

// Stateful in-memory usePersistedSetting so left-nav/year-toggle clicks
// actually persist across re-renders within a test, matching the real
// hook's contract (unlike the fixed-initial-value mock some other smoke
// tests use, which would make the section/year toggles inert here).
vi.mock("@/lib/hooks/use-persisted-setting", () => {
  const store = new Map<string, unknown>();
  return {
    usePersistedSetting: <T,>(key: string, initial: T) => {
      const [value, setValue] = React.useState<T>(
        (store.has(key) ? store.get(key) : initial) as T,
      );
      const set = (v: T) => {
        store.set(key, v);
        setValue(v);
      };
      return [value, set];
    },
  };
});

// The tables' rows, registered with the tRPC stand-in in beforeEach.
const { limits2025, taxBrackets2025, taxBrackets2024, ltcg2025, fpl2025 } =
  vi.hoisted(() => ({
    // One row of 2025 data per table (enough for each child to render its
    // "has data" branch), plus a second 2024 row on Tax Brackets only — so
    // the union toggle shows two years with different coverage, and IRMAA
    // (no data for either year) exercises the new empty-year state.
    limits2025: [
      {
        id: 1,
        taxYear: 2025,
        limitType: "ss_wage_base",
        value: "176100",
        notes: null,
        shippedSources: [],
      },
    ],
    taxBrackets2025: [
      {
        id: 1,
        taxYear: 2025,
        filingStatus: "MFJ" as const,
        w4Checkbox: false,
        brackets: [{ threshold: 0, baseWithholding: 0, rate: 0.1 }],
      },
    ],
    taxBrackets2024: [
      {
        id: 2,
        taxYear: 2024,
        filingStatus: "MFJ" as const,
        w4Checkbox: false,
        brackets: [{ threshold: 0, baseWithholding: 0, rate: 0.1 }],
      },
    ],
    ltcg2025: [
      {
        id: 1,
        taxYear: 2025,
        filingStatus: "MFJ" as const,
        brackets: [{ threshold: 0, rate: 0 }],
      },
    ],
    fpl2025: [{ id: 1, taxYear: 2025, amounts: { "1": 15000 } }],
  }));

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

import { TaxDataSettings } from "@/components/settings/tax-data";

describe("TaxDataSettings smoke", () => {
  beforeEach(() => {
    currentRole = "admin";
    // No test here writes: nothing to hold.
    resetTrpcMock();
    setQuery("retirement.returnRates.list", []);
    setQuery("settings.appSettings.list", []);
    setQuery("settings.contributionLimits.list", limits2025);
    setQuery("settings.taxBrackets.list", [
      ...taxBrackets2025,
      ...taxBrackets2024,
    ]);
    setQuery("settings.ltcgBrackets.list", ltcg2025);
    setQuery("settings.irmaaBrackets.list", []);
    setQuery("settings.fplByHousehold.list", fpl2025);
  });

  it("defaults to the IRS Limits section", () => {
    render(<TaxDataSettings />);
    expect(screen.getByText("Contribution & Tax Limits")).toBeVisible();
  });

  it("switches sections via the left nav (all stay mounted, visibility toggles)", () => {
    render(<TaxDataSettings />);
    // happy-dom doesn't load Tailwind, so `.hidden` has no computed display —
    // assert on the wrapper class the nav toggles + the active nav button
    // highlight rather than on toBeVisible().
    const limitsWrapper = () =>
      screen.getByText("Contribution & Tax Limits").closest("div")!
        .parentElement!;
    const taxWrapper = () =>
      screen.getByRole("heading", { name: "Tax Brackets" }).closest("div")!
        .parentElement!;

    expect(limitsWrapper()).not.toHaveClass("hidden");
    expect(taxWrapper()).toHaveClass("hidden");

    fireEvent.click(screen.getByRole("button", { name: "Tax Brackets" }));

    expect(screen.getByRole("button", { name: "Tax Brackets" })).toHaveClass(
      "bg-blue-600",
    );
    expect(limitsWrapper()).toHaveClass("hidden");
    expect(taxWrapper()).not.toHaveClass("hidden");
  });

  it("shows per-year coverage counts on the shared year toggle", () => {
    render(<TaxDataSettings />);
    // 2025 has a row in every table except IRMAA (empty, tests the
    // empty-year state below) = 4/5; 2024 only in Tax Brackets = 1/5.
    expect(screen.getByText(/4\/5/)).toBeInTheDocument();
    expect(screen.getByText(/1\/5/)).toBeInTheDocument();
  });

  it("shows an empty state for a section with no data for the active year", () => {
    render(<TaxDataSettings />);
    fireEvent.click(screen.getByRole("button", { name: "IRMAA Tables" }));
    expect(
      screen.getByText(/No IRMAA brackets configured for 2025/),
    ).toBeVisible();
  });

  it("switching the shared year changes what every section shows", () => {
    render(<TaxDataSettings />);
    fireEvent.click(screen.getByRole("tab", { name: /2024/ }));
    fireEvent.click(screen.getByRole("button", { name: "IRS Limits" }));
    expect(screen.getByText(/No limits configured for 2024 yet/)).toBeVisible();
  });

  it("hides the year toggle on the Return Rates section (no year axis)", () => {
    render(<TaxDataSettings />);
    expect(screen.getByRole("tab", { name: /2025/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Return Rates" }));
    expect(screen.queryByRole("tab", { name: /2025/ })).toBeNull();
  });
});
