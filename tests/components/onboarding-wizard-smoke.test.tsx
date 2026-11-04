/**
 * Smoke test before the split of onboarding/onboarding-wizard.tsx (RULES §
 * Refactoring: smoke tests before any split; target-architecture § 8.7:
 * each step renders; final save). A dated temporary net: the split that
 * replaces the file replaces this test. The Admin step's server-driven
 * behavior is covered by onboarding-wizard.test.tsx.
 *
 * An invented household walks every step on a fresh install that still
 * needs an admin: Robin and Sasha, one job each, then the final save.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  mutationCalls,
  resetTrpcMock,
  setMutationResult,
  setQuery,
} from "./trpc-mock";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

const onComplete = vi.fn();

beforeEach(() => {
  resetTrpcMock();
  onComplete.mockClear();
  setQuery("settings.firstRunState", { adminNeeded: true });
  // A fresh install has one baseline Salary Profile with no entries.
  setQuery("salaryProfile.list", [{ id: 1, name: "Baseline", salaries: {} }]);
  let nextPersonId = 41;
  setMutationResult("settings.people.create", () => ({ id: nextPersonId++ }));
  let nextJobId = 51;
  setMutationResult("settings.jobs.create", () => ({ id: nextJobId++ }));
  setMutationResult("settings.createLocalAdmin", { id: 1 });
});

const next = () =>
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
const heading = () => screen.getByRole("heading", { level: 2 });

function addPerson(name: string, birthYear: string) {
  fireEvent.change(screen.getByPlaceholderText("Name"), {
    target: { value: name },
  });
  fireEvent.change(screen.getByPlaceholderText("Birth year"), {
    target: { value: birthYear },
  });
  fireEvent.click(screen.getByRole("button", { name: /add person/i }));
}

function addJob(personIndex: string, employer: string, salary: string) {
  const [person] = screen.getAllByRole("combobox");
  fireEvent.change(person!, { target: { value: personIndex } });
  fireEvent.change(screen.getByPlaceholderText("Employer name"), {
    target: { value: employer },
  });
  fireEvent.change(screen.getByPlaceholderText("Annual salary"), {
    target: { value: salary },
  });
  fireEvent.click(screen.getByRole("button", { name: /add job/i }));
}

describe("OnboardingWizard smoke", () => {
  it("each step renders in order, and the last one saves the household", async () => {
    const { container } = render(<OnboardingWizard onComplete={onComplete} />);
    expect(screen.getByText("Step 1 of 6")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Get Started" }));

    // Admin
    expect(screen.getByText("Step 2 of 6")).toBeInTheDocument();
    const [name, email, password, confirm] = Array.from(
      container.querySelectorAll("input:not([type=file])"),
    );
    fireEvent.change(name!, { target: { value: "Robin" } });
    fireEvent.change(email!, { target: { value: "robin@example.com" } });
    fireEvent.change(password!, { target: { value: "Smoke-admin-pass-1" } });
    fireEvent.change(confirm!, { target: { value: "Smoke-admin-pass-1" } });
    next();

    // OIDC: optional, configured later.
    await waitFor(() =>
      expect(screen.getByText("Step 3 of 6")).toBeInTheDocument(),
    );
    const oidc = heading().textContent;
    next();

    // People: can't continue empty.
    expect(screen.getByText("Step 4 of 6")).toBeInTheDocument();
    expect(heading().textContent).not.toBe(oidc);
    next();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    addPerson("Robin", "1984");
    addPerson("Sasha", "1986");
    expect(screen.getByText("Robin")).toBeInTheDocument();
    expect(screen.getByText("Sasha")).toBeInTheDocument();
    next();

    // Income
    expect(screen.getByText("Step 5 of 6")).toBeInTheDocument();
    addJob("0", "Northwind Clinic", "98000");
    addJob("1", "Harbor Schools", "71000");
    expect(screen.getByText(/Northwind Clinic/)).toBeInTheDocument();
    expect(screen.getByText(/Harbor Schools/)).toBeInTheDocument();
    next();

    // Done: the final save.
    expect(screen.getByText("Step 6 of 6")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /dashboard/i }));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());

    expect(mutationCalls("settings.createLocalAdmin")).toEqual([
      {
        name: "Robin",
        email: "robin@example.com",
        password: "Smoke-admin-pass-1",
      },
    ]);
    expect(mutationCalls("settings.people.create")).toMatchObject([
      { name: "Robin", dateOfBirth: expect.stringMatching(/^1984/) },
      { name: "Sasha", dateOfBirth: expect.stringMatching(/^1986/) },
    ]);
    expect(mutationCalls("settings.jobs.create")).toMatchObject([
      { personId: 41, employerName: "Northwind Clinic" },
      { personId: 42, employerName: "Harbor Schools" },
    ]);
    // Salaries go into the baseline Salary Profile, one entry per new job.
    expect(mutationCalls("salaryProfile.update")).toEqual([
      {
        id: 1,
        salaries: {
          "51": expect.objectContaining({ salary: 98000 }),
          "52": expect.objectContaining({ salary: 71000 }),
        },
      },
    ]);
    expect(mutationCalls("settings.taxDataSync.setEnabled")).toEqual([
      { enabled: true },
    ]);
    expect(mutationCalls("settings.completeOnboarding")).toHaveLength(1);
  });
});
