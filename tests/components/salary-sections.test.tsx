/**
 * The shared salary sections (Paycheck page and Profiles → Salary): dates
 * save once, on blur; read-only means read-only; Bonus terms send the
 * fields salaryEntryEdit parses.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DateInput } from "@/components/ui/date-input";
import { PayScheduleSection } from "@/components/paycheck/pay-schedule-section";
import {
  BonusTerms,
  showsAllBonusTerms,
} from "@/components/paycheck/bonus-section";

vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

describe("DateInput", () => {
  it("saves once on blur, not while a year is being typed", () => {
    const onCommit = vi.fn();
    render(
      <DateInput value="2026-01-09" onCommit={onCommit} ariaLabel="Day" />,
    );
    const input = screen.getByLabelText("Day");
    fireEvent.change(input, { target: { value: "0002-01-09" } });
    fireEvent.change(input, { target: { value: "2027-01-09" } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("2027-01-09");
  });

  it("Escape puts the saved value back; an unchanged blur saves nothing", () => {
    const onCommit = vi.fn();
    render(
      <DateInput value="2026-01-09" onCommit={onCommit} ariaLabel="Day" />,
    );
    const input = screen.getByLabelText("Day") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2027-01-09" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("2026-01-09");
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("PayScheduleSection", () => {
  const job = {
    payPeriod: "biweekly",
    payWeek: "even",
    anchorPayDate: "2026-01-09",
    budgetPeriodsPerMonth: null,
  };

  it("saves the pay period and a known payday (on blur)", () => {
    const onUpdateJob = vi.fn();
    render(<PayScheduleSection job={job} onUpdateJob={onUpdateJob} />);
    fireEvent.change(screen.getByLabelText("Pay period"), {
      target: { value: "monthly" },
    });
    expect(onUpdateJob).toHaveBeenCalledWith("payPeriod", "monthly");
    const day = screen.getByLabelText("A known payday");
    fireEvent.change(day, { target: { value: "2026-01-23" } });
    fireEvent.blur(day);
    expect(onUpdateJob).toHaveBeenCalledWith("anchorPayDate", "2026-01-23");
  });

  it("is read-only when locked", () => {
    render(<PayScheduleSection job={job} onUpdateJob={vi.fn()} readOnly />);
    expect(screen.getByLabelText("Pay period")).toBeDisabled();
    expect(screen.getByLabelText("Pay week")).toBeDisabled();
    expect(screen.getByLabelText("A known payday")).toBeDisabled();
  });

  it("asks for payday weeks only on a biweekly schedule", () => {
    render(
      <PayScheduleSection
        job={{ ...job, payPeriod: "monthly" }}
        onUpdateJob={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Pay week")).toBeNull();
  });
});

describe("BonusTerms", () => {
  const terms = { bonusPercent: 0.1, bonusMultiplier: 1, bonusOverride: 0 };
  const props = {
    terms,
    bonusMonth: 3,
    bonusDayOfMonth: 15,
    bonusDestination: "budget" as const,
    editable: true,
    showAll: true,
  };

  it("a recorded $0 actual shows as $0, not as unset", () => {
    render(<BonusTerms {...props} onUpdateJob={vi.fn()} />);
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });

  it("sends where the bonus goes and the pay date as one MM-DD write", () => {
    const onUpdateJob = vi.fn();
    render(<BonusTerms {...props} onUpdateJob={onUpdateJob} />);
    fireEvent.click(screen.getByRole("radio", { name: "Extra spending" }));
    expect(onUpdateJob).toHaveBeenCalledWith("bonusDestination", "spending");
    const date = screen.getByLabelText("Bonus paid on");
    fireEvent.change(date, { target: { value: "2026-04-01" } });
    fireEvent.blur(date);
    expect(onUpdateJob).toHaveBeenCalledWith("bonusDate", "04-01");
  });

  it("nothing is editable when the section is read-only", () => {
    render(<BonusTerms {...props} editable={false} onUpdateJob={vi.fn()} />);
    expect(screen.getByLabelText("Bonus paid on")).toBeDisabled();
    for (const r of screen.getAllByRole("radio")) expect(r).toBeDisabled();
  });

  it("one rule for showing every term", () => {
    expect(showsAllBonusTerms({ bonusPercent: 0, bonusOverride: null })).toBe(
      false,
    );
    expect(showsAllBonusTerms({ bonusPercent: 0, bonusOverride: 0 })).toBe(
      true,
    );
    expect(
      showsAllBonusTerms({ bonusPercent: 0.05, bonusOverride: null }),
    ).toBe(true);
  });
});
