/**
 * Smoke test before the split of contribution-profile-manager.tsx (RULES §
 * Refactoring: smoke tests before any split; target-architecture § 8.7:
 * smoke + one mutation per editor). A dated temporary net: the split that
 * replaces the file replaces this test.
 *
 * One invented household (Dana and Eli, two jobs, three contribution
 * accounts, one deduction) with two profiles. Covers the manager (list,
 * summary, activate), the read-only panel, the inline editor (a value
 * commit), and the new-profile editor (create).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { RouterOutputs } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";
import {
  mutationCalls,
  resetTrpcMock,
  setMutationResult,
  setQuery,
} from "./trpc-mock";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));
vi.mock("@/components/ui/confirm-dialog", () => ({
  confirm: vi.fn(async () => true),
  confirmWithDiff: vi.fn(async () => true),
  promptText: vi.fn(async () => null),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { ContributionProfileManager } from "@/components/budget/contribution-profile-manager";

const renderManager = (locked = false) =>
  render(
    <TooltipProvider>
      <ContributionProfileManager canEdit locked={locked} />
    </TooltipProvider>,
  );

type ProfileList = RouterOutputs["contributionProfile"]["list"];
type ProfileDetail = NonNullable<
  RouterOutputs["contributionProfile"]["getById"]
>;

const profiles: ProfileList = [
  {
    id: 1,
    name: "Current Jobs",
    description: null,
    createdAt: "2026-01-04T00:00:00.000Z",
    activeFieldCount: 3,
    incompleteAccountCount: 0,
    summary: {
      combinedSalary: 185000,
      annualContributions: 31450,
      annualEmployerMatch: 6200,
    },
  },
  {
    id: 2,
    name: "Max Everything",
    description: "Both 401(k)s at the limit",
    createdAt: "2026-02-11T00:00:00.000Z",
    activeFieldCount: 3,
    incompleteAccountCount: 0,
    summary: {
      combinedSalary: 185000,
      annualContributions: 54000,
      annualEmployerMatch: 6200,
    },
  },
];

const account = (
  id: number,
  name: string,
  over: Partial<ProfileDetail["accountDetails"][number]>,
): ProfileDetail["accountDetails"][number] => ({
  id,
  accountType: "401k",
  subType: null,
  label: null,
  accountName: name,
  liveAccountName: name,
  personId: 1,
  taxTreatment: "pre_tax",
  parentCategory: "Retirement",
  liveMatchType: "none",
  liveMatchValue: null,
  liveMatchRate: null,
  liveMaxMatchPct: null,
  liveIsActive: true,
  liveIsPayroll: true,
  activeFields: null,
  isIncomplete: false,
  ...over,
});

function detail(id: number): ProfileDetail {
  const p = profiles.find((x) => x.id === id)!;
  const pct = id === 1 ? "8" : "15";
  return {
    id,
    name: p.name,
    description: p.description,
    createdAt: p.createdAt,
    contributionActiveFields: {
      contributionAccounts: {
        "11": {
          contributionMethod: "percent_of_salary",
          contributionValue: pct,
        },
        "12": {
          contributionMethod: "percent_of_salary",
          contributionValue: "6",
        },
        "13": { contributionMethod: "fixed_annual", contributionValue: "7000" },
      },
      deductions: { "21": { amountPerPeriod: "92.31" } },
    },
    accountDetails: [
      account(11, "Dana 401(k)", {
        liveMatchType: "percent_of_contribution",
        liveMatchValue: "50",
        liveMatchRate: "0.5",
        liveMaxMatchPct: "0.06",
        activeFields: {
          contributionMethod: "percent_of_salary",
          contributionValue: pct,
        },
      }),
      account(12, "Eli 403(b)", {
        accountType: "403b",
        personId: 2,
        activeFields: {
          contributionMethod: "percent_of_salary",
          contributionValue: "6",
        },
      }),
      account(13, "Dana Roth IRA", {
        accountType: "ira",
        taxTreatment: "tax_free",
        liveIsPayroll: false,
        activeFields: {
          contributionMethod: "fixed_annual",
          contributionValue: "7000",
        },
      }),
    ],
    deductionDetails: [
      {
        id: 21,
        jobId: 1,
        employerName: "Northwind Clinic",
        deductionName: "Dental",
        isPretax: true,
        ficaExempt: true,
        activeFields: { amountPerPeriod: "92.31" },
        isIncomplete: false,
      },
    ],
    resolved: { combinedSalary: 185000 },
  };
}

beforeEach(() => {
  resetTrpcMock();
  localStorage.clear();
  setQuery("contributionProfile.list", profiles);
  setQuery("contributionProfile.getById", (input) =>
    detail((input as { id: number }).id),
  );
  setQuery("settings.appSettings.list", [
    { key: SK_ACTIVE_CONTRIB_PROFILE_ID, value: 1 },
  ]);
  setQuery("settings.deductions.list", [
    {
      id: 21,
      jobId: 1,
      deductionName: "Dental",
      isPretax: true,
      ficaExempt: true,
    },
  ]);
  setQuery("settings.jobs.list", [
    { id: 1, personId: 1, employerName: "Northwind Clinic" },
    { id: 2, personId: 2, employerName: "Harbor Schools" },
  ]);
  setQuery("settings.scenarios.list", []);
});

describe("ContributionProfileManager smoke", () => {
  it("lists every profile with its yearly figures and shows the active one", () => {
    renderManager();
    expect(screen.getAllByText("Current Jobs").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Max Everything").length).toBeGreaterThan(0);
    // Each row's yearly contributions, and the summary bar's figures for
    // the active profile.
    expect(document.body).toHaveTextContent(`${formatCurrency(54000)}/yr`);
    expect(document.body).toHaveTextContent(`${formatCurrency(31450)}/yr`);
    expect(document.body).toHaveTextContent(formatCurrency(6200));
    // The inline editor lists the profile's accounts.
    expect(screen.getByText("Dana 401(k)")).toBeInTheDocument();
    expect(screen.getByText("Eli 403(b)")).toBeInTheDocument();
    expect(screen.getByText("Dana Roth IRA")).toBeInTheDocument();
  });

  it("manager: activating another profile writes the active-profile setting", async () => {
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "activate" }));
    await vi.waitFor(() =>
      expect(mutationCalls("contributionProfile.setActive")).toEqual([
        { id: 2 },
      ]),
    );
  });

  it("read-only panel: locked shows the values without inputs", () => {
    renderManager(true);
    expect(screen.getByText("Dana 401(k)")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Custom name...")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("inline editor: a new value commits on blur for that account only", () => {
    setMutationResult("contributionProfile.setAccountActiveFields", {
      limitWarning: null,
    });
    renderManager();
    const row = screen.getByText("Eli 403(b)").closest("tr")!;
    const value = within(row).getAllByRole("spinbutton")[0]!;
    expect(value).toHaveValue(6);
    fireEvent.change(value, { target: { value: "9" } });
    fireEvent.blur(value);
    expect(mutationCalls("contributionProfile.setAccountActiveFields")).toEqual(
      [
        {
          profileId: 1,
          accountId: 12,
          fields: { contributionValue: "9" },
          unset: [],
        },
      ],
    );
  });

  it("new-profile editor: Create sends the name and the values entered", () => {
    setMutationResult("contributionProfile.create", { id: 3 });
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: /new/i }));
    const create = screen.getByRole("button", { name: "Create" });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("e.g., Austin Relocation"), {
      target: { value: "Part-time Eli" },
    });
    // The new profile starts from the first profile's accounts.
    const row = screen.getByText("Eli 403(b)").closest("tr")!;
    fireEvent.change(within(row).getAllByRole("spinbutton")[0]!, {
      target: { value: "3" },
    });
    fireEvent.click(create);
    const [sent] = mutationCalls("contributionProfile.create") as {
      name: string;
      contributionActiveFields: {
        contributionAccounts?: Record<string, Record<string, unknown>>;
      };
    }[];
    expect(sent!.name).toBe("Part-time Eli");
    expect(sent!.contributionActiveFields.contributionAccounts?.["12"]).toEqual(
      {
        contributionValue: "3",
        contributionMethod: "percent_of_salary",
      },
    );
  });
});
