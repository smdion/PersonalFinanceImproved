"use client";

/**
 * Shared presentational pieces factored out of ServiceCard (integrations.tsx)
 * and SimplefinCard (integrations-simplefin.tsx) — the two connected-status
 * line and success/error result-message patterns were byte-for-byte
 * duplicated across both. Everything else (credential forms, action sets)
 * genuinely differs per service and stays in each card.
 */
import { STATUS_COLORS } from "@/lib/utils/colors";

export function ConnectionStatusLine({
  connected,
  extra,
}: {
  connected: boolean;
  /** Follow-on content next to the status text — an "Active" Badge, a
   *  "Last synced ..." caption, etc. */
  extra?: React.ReactNode;
}) {
  const colors = connected ? STATUS_COLORS.green : STATUS_COLORS.red;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-400"}`}
      />
      <span className={`text-sm ${colors.text}`}>
        {connected ? "Connected" : "Not connected"}
      </span>
      {extra}
    </div>
  );
}

export function ConnectionResultMessage({
  tone,
  children,
}: {
  tone: "success" | "error";
  children: React.ReactNode;
}) {
  const colors = tone === "success" ? STATUS_COLORS.green : STATUS_COLORS.red;
  return <p className={`text-xs ${colors.text}`}>{children}</p>;
}
