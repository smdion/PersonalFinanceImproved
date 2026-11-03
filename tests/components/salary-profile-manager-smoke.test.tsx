/**
 * Manager-level smoke test before the split of budget/salary-profile-
 * manager.tsx (RULES § Refactoring: smoke tests before any split;
 * target-architecture § 8.7: manager smoke). A dated temporary net: the
 * split that replaces the file replaces this test. The shared salary
 * sections inside it are covered by salary-sections.test.tsx.
 *
 * Invented household: Priya (a job in both profiles) and Tomas (a job only
 * the second profile sets).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { RouterOutputs } from "@/lib/trpc";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserProvider } from "@/lib/context/user-context";
import { BLANK_SALARY_ENTRY } from "@/lib/db/salary-entry-defaults";
import { SK_ACTIVE_SALARY_PROFILE_ID } from "@/lib/constants/settings-keys";
import { formatCurrency } from "@/lib/utils/format";
import { mutationCalls, resetTrpcMock, setQuery } from "./trpc-mock";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));
vi.mock("@/components/ui/confirm-dialog", () => ({
  confirm: vi.fn(async () => true),
  promptText: vi.fn(async () => null),
}));

import { SalaryProfileManager } from "@/components/budget/salary-profile-manager";

type ProfileList = RouterOutputs["salaryProfile"]["list"];
type ProfileDetail = NonNullable<RouterOutputs["salaryProfile"]["getById"]>;
type JobOption = ProfileDetail["salaryDetails"][number]["jobOptions"][number];

const entry = (salary: number) => ({
  ...BLANK_SALARY_ENTRY,
  salary,
  bonusPercent: 0.1,
});
const profiles: ProfileList = [
  {
    id: 7,
    name: "This Year",
    description: null,
    createdAt: "2026-01-02T00:00:00.000Z",
    salaries: { "10": entry(118000) },
    pinnedCount: 1,
    pinnedSalaryTotal: 118000,
  },
  {
    id: 8,
    name: "Both Working",
    description: "Tomas back full time",
    createdAt: "2026-03-01T00:00:00.000Z",
    salaries: { "10": entry(118000), "20": entry(76000) },
    pinnedCount: 2,
    pinnedSalaryTotal: 194000,
  },
];

function jobOption(
  id: number,
  employerName: string,
  salary: number | null,
): JobOption {
  return {
    id,
    employerName,
    startDate: "2021-04-05",
    endDate: null,
    hasEntry: salary !== null,
    ...BLANK_SALARY_ENTRY,
    salary: salary ?? 0,
    bonusPercent: salary !== null ? 0.1 : 0,
    bonusDestination: "budget",
    earningRows: [],
    effectiveSalary: salary ?? 0,
    estimatedBonus: salary !== null ? salary * 0.1 : 0,
    formulaBonus: salary !== null ? salary * 0.1 : 0,
  };
}

function detail(id: number): ProfileDetail {
  const p = profiles.find((x) => x.id === id)!;
  const rows = [
    {
      personId: 1,
      personName: "Priya",
      job: jobOption(10, "Northwind", 118000),
    },
    {
      personId: 2,
      personName: "Tomas",
      job: jobOption(20, "Harbor Schools", id === 8 ? 76000 : null),
    },
  ];
  const salaryDetails = rows.map(({ personId, personName, job }) => {
    const { id: jobId, startDate: _s, endDate: _e, ...rest } = job;
    return { personId, personName, jobId, jobOptions: [job], ...rest };
  });
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    createdAt: p.createdAt,
    salaries: p.salaries,
    salaryDetails,
    combinedIncome: salaryDetails.reduce(
      (s, d) => s + d.effectiveSalary + d.estimatedBonus,
      0,
    ),
  };
}

beforeEach(() => {
  resetTrpcMock();
  localStorage.clear();
  setQuery("salaryProfile.list", profiles);
  setQuery("salaryProfile.getById", (input) =>
    detail((input as { id: number }).id),
  );
  setQuery("settings.appSettings.list", [
    { key: SK_ACTIVE_SALARY_PROFILE_ID, value: 7 },
  ]);
});

const renderManager = (locked = false) =>
  render(
    <UserProvider user={{ name: "Priya", role: "admin", permissions: [] }}>
      <TooltipProvider>
        <SalaryProfileManager canEdit locked={locked} />
      </TooltipProvider>
    </UserProvider>,
  );

/** Clicks a profile's row in the list (the row, not its rename field). */
const selectRow = (name: string) =>
  fireEvent.click(
    screen.getAllByRole("button", { name: new RegExp(`^${name}`) })[0]!,
  );

describe("SalaryProfileManager smoke", () => {
  it("lists the profiles and opens the active one: who is in it and for how much", () => {
    renderManager();
    expect(screen.getAllByText("This Year").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Both Working").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("spinbutton", { name: "Priya salary" }),
    ).toHaveValue(118000);
    // Tomas has no entry in the active profile: shown, contributing $0.
    expect(screen.getByText("Not in this profile")).toBeInTheDocument();
    expect(document.body).toHaveTextContent(formatCurrency(118000 * 1.1));
  });

  it("selecting another profile shows its entries", () => {
    renderManager();
    selectRow("Both Working");
    expect(
      screen.getByRole("spinbutton", { name: "Tomas salary" }),
    ).toHaveValue(76000);
  });

  it("a salary edit commits on blur to that job's entry", () => {
    renderManager();
    const salary = screen.getByRole("spinbutton", { name: "Priya salary" });
    fireEvent.change(salary, { target: { value: "125000" } });
    fireEvent.blur(salary);
    expect(mutationCalls("salaryProfile.patchEntry")).toMatchObject([
      { id: 7, jobId: 10, fields: { salary: 125000 } },
    ]);
  });

  it("activating another profile writes the active-profile setting", async () => {
    renderManager();
    selectRow("Both Working");
    fireEvent.click(
      screen.getAllByRole("button", { name: /activate/i }).at(-1)!,
    );
    await waitFor(() =>
      expect(mutationCalls("salaryProfile.setActive")).toEqual([{ id: 8 }]),
    );
  });

  it("locked: read-only, no salary inputs", () => {
    renderManager(true);
    expect(screen.getByText("Priya")).toBeInTheDocument();
    expect(
      screen.queryByRole("spinbutton", { name: "Priya salary" }),
    ).toBeNull();
  });
});
