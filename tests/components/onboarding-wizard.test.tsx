/**
 * The onboarding wizard's Admin step follows the server's first-run state
 * (`settings.firstRunState`), not local state: an install that already has
 * an admin never sees the step, and a reload after the admin was created
 * can't dead-end on "already exists".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));
import {
  mutationCalls,
  queryRefetch,
  resetTrpcMock,
  setMutationError,
  setMutationResult,
  setQuery,
  setQueryState,
  utilsCalls,
} from "./trpc-mock";

const FIRST_RUN = "settings.firstRunState";
const CREATE_ADMIN = "settings.createLocalAdmin";
/** What a refetch of the first-run state answers (and then shows). */
let refetchAnswer = { adminNeeded: false };

import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

const adminHeading = () =>
  screen.queryByRole("heading", { name: "Create Admin Account" });
const oidcHeading = () =>
  screen.queryByRole("heading", { name: "Connect to Authentik" });

function fillAdmin(container: HTMLElement) {
  const [name, email, password, confirm] = Array.from(
    container.querySelectorAll("input:not([type=file])"),
  );
  fireEvent.change(name!, { target: { value: "Robin" } });
  fireEvent.change(email!, { target: { value: "robin@example.com" } });
  fireEvent.change(password!, { target: { value: "Wizard-admin-pass-1" } });
  fireEvent.change(confirm!, { target: { value: "Wizard-admin-pass-1" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTrpcMock();
  refetchAnswer = { adminNeeded: false };
  queryRefetch(FIRST_RUN).mockImplementation(async () => {
    setQuery(FIRST_RUN, refetchAnswer);
    return { data: refetchAnswer };
  });
});

describe("OnboardingWizard Admin step", () => {
  it("skips the Admin step when an admin exists", () => {
    setQuery(FIRST_RUN, { adminNeeded: false });
    render(<OnboardingWizard onComplete={() => {}} />);
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Get Started" }));
    expect(oidcHeading()).toBeInTheDocument();
    expect(adminHeading()).not.toBeInTheDocument();
    expect(screen.getByText("Step 2 of 5")).toBeInTheDocument();
  });

  it("keeps the Admin step while the server says an admin is needed, then moves on", async () => {
    setQuery(FIRST_RUN, { adminNeeded: true });
    setMutationResult(CREATE_ADMIN, { id: 1 });
    const { container } = render(<OnboardingWizard onComplete={() => {}} />);
    expect(screen.getByText("Step 1 of 6")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Get Started" }));
    expect(adminHeading()).toBeInTheDocument();

    fillAdmin(container);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(oidcHeading()).toBeInTheDocument());
    expect(mutationCalls(CREATE_ADMIN)).toEqual([
      {
        name: "Robin",
        email: "robin@example.com",
        password: "Wizard-admin-pass-1",
      },
    ]);
    expect(utilsCalls("settings.firstRunState.invalidate")).not.toHaveLength(0);
  });

  it("moves past the Admin step when the server refuses because one now exists", async () => {
    // Stale state (another tab, or a reload racing the create): the
    // server refuses, and its fresh answer says no admin is needed.
    setQuery(FIRST_RUN, { adminNeeded: true });
    setMutationError(
      CREATE_ADMIN,
      new Error("A local admin account already exists."),
    );
    const { container } = render(<OnboardingWizard onComplete={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Get Started" }));
    fillAdmin(container);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(oidcHeading()).toBeInTheDocument());
    expect(screen.queryByText(/already exists/)).not.toBeInTheDocument();
    expect(screen.getByText("Step 2 of 5")).toBeInTheDocument();
  });

  it("waits for the server's answer before leaving Welcome", () => {
    setQueryState(FIRST_RUN, { isPending: true });
    render(<OnboardingWizard onComplete={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Get Started" }));
    expect(
      screen.getByRole("button", { name: "Get Started" }),
    ).toBeInTheDocument();
    expect(adminHeading()).not.toBeInTheDocument();
  });
});
