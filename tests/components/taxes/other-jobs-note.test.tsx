import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OtherJobsNotes } from "@/components/taxes/other-jobs-note";

type People = Parameters<typeof OtherJobsNotes>[0]["people"];

const person = (id: number, name: string, other: string[]) => ({
  person: { id, name },
  job: { employerName: `${name} Co` },
  otherCurrentJobs: other,
});

describe("OtherJobsNotes", () => {
  it("names the counted job for a person with a second current job, and no one else", () => {
    const rows = [
      person(1, "Ana", ["Side Gig", "Weekend"]),
      person(2, "Ben", []),
    ];
    // eslint-disable-next-line no-restricted-syntax -- invented summary people hold only the fields the note reads
    const people = rows as unknown as People;
    render(<OtherJobsNotes people={people} counted="pay is in this MAGI" />);
    expect(
      screen.getByText(/Ana has another current job \(Side Gig, Weekend\)/),
    ).toHaveTextContent(
      "only Ana Co's pay is in this MAGI. Two jobs at once aren't modelled yet.",
    );
    expect(screen.queryByText(/Ben has another/)).toBeNull();
  });
});
