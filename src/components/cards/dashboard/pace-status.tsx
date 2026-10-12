"use client";

/**
 * Whether money is actually going in as set up — the live status next to
 * each account on the Contributions card (see lib/pure/savings-pace).
 */
import type { PaceStatus } from "@/lib/pure/savings-pace";
import type { LatestContribution } from "@/lib/pure/deposit-check";
import { formatCurrency, formatDate } from "@/lib/utils/format";

const STATUS_TEXT: Record<PaceStatus, string> = {
  met: "Plan met",
  on_pace: "On pace",
  differs: "Latest deposit differs",
  no_recent: "No recent deposit",
  estimated: "Estimated",
  no_plan: "",
};

const STATUS_TITLE: Record<PaceStatus, string> = {
  met: "Saved this year's full plan already",
  on_pace: "The latest contribution matches today's setup",
  differs: "The latest contribution isn't what today's setup puts in",
  no_recent: "No contribution arrived in the last few months",
  estimated:
    "The institution sends only a balance, so this year's contributions are estimated from your paycheck setup",
  no_plan: "",
};

const STATUS_CLASS: Record<PaceStatus, string> = {
  met: "text-green-600 dark:text-green-400",
  on_pace: "text-green-600 dark:text-green-400",
  differs: "text-amber-600",
  no_recent: "text-amber-600",
  estimated: "text-faint",
  no_plan: "text-faint",
};

/** The hover: what the status was judged on, when there's a deposit to show. */
function titleOf(status: PaceStatus, latest?: LatestContribution | null) {
  if (!latest?.deposit) return STATUS_TITLE[status];
  return `${STATUS_TITLE[status]}.\nLatest: ${formatCurrency(latest.deposit.amount)} on ${formatDate(latest.deposit.day, "medium")} · setup: ${formatCurrency(latest.expected)} per contribution`;
}

export function PaceStatusText({
  status,
  latest,
}: {
  status: PaceStatus;
  /** The account's latest contribution vs its setup (adds the details to the hover). */
  latest?: LatestContribution | null;
}) {
  if (status === "no_plan") return null;
  return (
    <span
      className={`text-caption font-normal ${STATUS_CLASS[status]}`}
      title={titleOf(status, latest)}
    >
      {STATUS_TEXT[status]}
    </span>
  );
}
