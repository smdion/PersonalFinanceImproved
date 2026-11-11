"use client";

/** Taxes page: one line per person with a second current job, naming the job counted. */
import type { RouterOutputs } from "@/lib/trpc";

type SummaryPerson =
  RouterOutputs["paycheck"]["computeSummary"]["people"][number];

export function OtherJobsNotes({
  people,
  counted,
}: {
  people: readonly SummaryPerson[];
  /** What the counted job's pay feeds, e.g. "pay and tax are counted here". */
  counted: string;
}) {
  return people.flatMap((d) =>
    "otherCurrentJobs" in d && d.otherCurrentJobs.length > 0
      ? [
          <p key={`jobs-${d.person.id}`} className="text-faint pt-1 text-xs">
            {d.person.name} has another current job (
            {d.otherCurrentJobs.join(", ")}): only {d.job.employerName}&apos;s{" "}
            {counted}. Two jobs at once aren&apos;t modelled yet.
          </p>,
        ]
      : [],
  );
}
