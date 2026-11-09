/** The success/failure toast text for a push to or pull from an external budget API. */

/** Success-toast wording for a push/pull to an external budget API, shared so
 *  every sync toast reads the same. */
export function formatSyncResultToast(
  count: number,
  action: "push" | "pull",
  destination: string,
  /** Items the provider can't take (BudgetApiError "unsupported"/"conflict"),
   *  so a push that couldn't land never reads as "already up to date". */
  skippedUnsupported = 0,
  /** Requests that failed (network/auth/rate-limit/bad shape), so a failure
   *  never reads as "already up to date". */
  failed = 0,
  failureMessage?: string,
  /** An Actual goal push only writes a `#template` note line, live once the
   *  household runs "Apply Budget Template"; the toast says so. Set only for
   *  Actual goal pushes (YNAB writes a real goal field). */
  requiresManualApply = false,
): string {
  if (failed > 0 && count === 0) {
    const detail = failureMessage ? ` (${failureMessage})` : "";
    return `${action === "push" ? "Push" : "Pull"} failed for ${failed} item${failed !== 1 ? "s" : ""}${detail} — nothing was sent to ${destination}.`;
  }
  if (skippedUnsupported > 0 && count === 0) {
    return `Couldn't ${action === "push" ? "set" : "read"} goal amounts in ${destination} for ${skippedUnsupported} item${skippedUnsupported !== 1 ? "s" : ""} — check ${skippedUnsupported !== 1 ? "these goals" : "this goal"} in ${destination}.`;
  }
  if (count === 0) {
    return `No changes to ${action} — already up to date`;
  }
  const verb = action === "push" ? "Pushed" : "Pulled";
  const preposition = action === "push" ? "to" : "from";
  const base = `${verb} ${count} item${count !== 1 ? "s" : ""} ${preposition} ${destination}`;
  const notes = [
    skippedUnsupported > 0 ? `${skippedUnsupported} skipped` : null,
    failed > 0 ? `${failed} failed` : null,
  ].filter((n): n is string => n != null);
  const withNotes =
    notes.length > 0
      ? `${base} (${notes.join(", ")} — check ${destination})`
      : base;
  return requiresManualApply
    ? `${withNotes} as a goal template — open ${destination} and run "Apply Budget Template" to assign it to a month's budget.`
    : withNotes;
}
