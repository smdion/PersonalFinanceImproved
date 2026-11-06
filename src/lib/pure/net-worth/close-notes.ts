/** The Current Balances card's words for its daily changes: who a close
 *  leaves out and why ("not in yet" only while a report can still come),
 *  and each account's move over closes it sent no report for. */
import { formatCurrency } from "@/lib/utils/format";
import { previousTradingDay } from "../investments/market-calendar";
import type { CloseReport } from "./daily-movement";

type Close = { day: string; missing: readonly string[] };
type Reports = readonly Pick<CloseReport, "name" | "closes" | "gaps">[];

/** "Oct 30" from YYYY-MM-DD. */
export const shortDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** "Nov 4", "Nov 2–4", "Oct 30–Nov 2", from days oldest first. */
function dayRun(days: readonly string[]): string {
  const first = days[0] ?? "";
  const last = days.at(-1) ?? first;
  if (first === last) return shortDay(first);
  return first.slice(0, 7) === last.slice(0, 7)
    ? `${shortDay(first)}–${Number(last.slice(8))}`
    : `${shortDay(first)}–${shortDay(last)}`;
}

/** "Fidelity", "Fidelity and Voya", "Fidelity, Voya and Vanguard". */
const listNames = (names: readonly string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** "Fidelity" from "Fidelity Investments": notes stay on one line; the
 *  full name is in the hover text. */
const shortName = (name: string) => name.split(/\s+/)[0] ?? name;

/** The closes without a value next to `day`, itself included. */
function runAround(closes: CloseReport["closes"], day: string): string[] {
  const i = closes.findIndex((c) => c.day === day);
  let start = i;
  let end = i;
  while (start > 0 && !closes[start - 1]!.valued) start--;
  while (end < closes.length - 1 && !closes[end + 1]!.valued) end++;
  return closes.slice(start, end + 1).map((c) => c.day);
}

/** Why each institution named at a close is out of its change: still to
 *  come (the latest close's report), no report for some days (by run), or
 *  not known (no closes for it). */
function whyMissing(c: Close, target: string | undefined, reports: Reports) {
  const from = previousTradingDay(c.day);
  const late = new Set<string>();
  const noReport = new Map<string, Set<string>>();
  const unknown = new Set<string>();
  for (const name of c.missing) {
    let told = false;
    for (const r of reports.filter((x) => x.name === name)) {
      const start = r.closes.find((x) => x.day === from);
      const end = r.closes.find((x) => x.day === c.day);
      if (!start || !end || (start.valued && end.valued)) continue;
      told = true;
      if (start.valued && c.day === target) {
        late.add(name);
        continue;
      }
      const run = dayRun(runAround(r.closes, end.valued ? from : c.day));
      noReport.set(run, (noReport.get(run) ?? new Set()).add(name));
    }
    if (told) continue;
    if (c.day === target) late.add(name);
    else unknown.add(name);
  }
  return { late: [...late], noReport: [...noReport], unknown: [...unknown] };
}

const short = (names: readonly string[]) =>
  listNames([...new Set(names.map(shortName))]);

/** The note beside a close with accounts missing. */
export function missingNote(
  c: Close,
  target: string | undefined,
  reports: Reports,
): string | null {
  if (c.missing.length === 0) return null;
  const { late, noReport, unknown } = whyMissing(c, target, reports);
  return [
    late.length > 0 &&
      `${short(late)} ${late.length === 1 ? "change" : "changes"} not in yet`,
    ...noReport.map(([run, names]) => `no ${short([...names])} report ${run}`),
    unknown.length > 0 && `excludes ${short(unknown)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Hover text for a close with accounts missing. */
export function missingReason(
  c: Close,
  target: string | undefined,
  reports: Reports,
): string | undefined {
  if (c.missing.length === 0) return undefined;
  const { late, noReport, unknown } = whyMissing(c, target, reports);
  const day = shortDay(c.day);
  const lateText = () => {
    const one = late.length === 1;
    return `${listNames(late)}'s ${day} ${one ? "balance is" : "balances are"} in; the change needs ${one ? "its" : "their"} ${day} fund prices, which arrive with the next sync. This total leaves ${one ? "it" : "them"} out until then.`;
  };
  const noReportText = ([run, names]: [string, Set<string>]) =>
    `${listNames([...names])} sent no report for ${run}, so ${names.size === 1 ? "its" : "their"} change isn't in this total.`;
  return [
    late.length > 0 && lateText(),
    ...noReport.map(noReportText),
    unknown.length > 0 &&
      `${listNames(unknown)} didn't report a price for ${day}, so ${unknown.length === 1 ? "its" : "their"} change isn't in this total.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** One line per account per run of closes it sent no report for: its move
 *  from the close before the run to the close after it. */
export function gapLines(reports: Reports): string[] {
  return reports.flatMap((r) =>
    r.gaps.map(
      (g) =>
        `${shortName(r.name)}: ${g.move >= 0 ? "+" : "−"}${formatCurrency(Math.abs(g.move))} ${shortDay(g.before)} → ${shortDay(g.after)} (no daily ${g.missing.length === 1 ? "report" : "reports"} ${dayRun(g.missing)})`,
    ),
  );
}
