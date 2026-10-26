"use client";

/**
 * Settings → Reference Data: how tax data updates work, whether this
 * install's tax data is current, and the carried-forward figures to check
 * (lib/pure/tax-data-status.ts; server: settings.taxData).
 */
import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatPercent } from "@/lib/utils/format";

/** A figure's value as the IRS limits show it. */
function showValue(v: number | null, format: string): string {
  if (v === null) return "—";
  if (format === "percent") return formatPercent(v, 2);
  if (format === "year") return String(v);
  return formatCurrency(v, 0);
}

/** A waiting community update: what it changes, Approve / Dismiss. */
function CommunityUpdate({ admin }: { admin: boolean }) {
  const utils = trpc.useUtils();
  const { data: sync } = trpc.settings.taxDataSync.status.useQuery();
  const [open, setOpen] = useState(false);
  const { data: preview, error } = trpc.settings.taxDataSync.preview.useQuery(
    undefined,
    { enabled: open && !!sync?.pending },
  );
  const done = () => {
    utils.settings.invalidate();
    utils.projection.invalidate();
    setOpen(false);
  };
  const approve = trpc.settings.taxDataSync.approve.useMutation({
    onSuccess: done,
  });
  const dismiss = trpc.settings.taxDataSync.dismiss.useMutation({
    onSuccess: done,
  });
  if (!sync?.pending) return null;
  const version = sync.pending.dataVersion;

  return (
    <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
      <button
        type="button"
        className="hover:underline"
        onClick={() => setOpen(!open)}
      >
        Tax data update available (data version {version}) — review{" "}
        {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {error && <p className="text-xs text-red-600">{error.message}</p>}
          {preview && (
            <>
              <p className="text-caption">
                Published and signed by the Ledgr project. These figures change;
                figures you&apos;ve changed aren&apos;t included and stay as
                they are.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left">
                      <th className="py-1 pr-2 font-medium">Year</th>
                      <th className="py-1 pr-2 font-medium">Figure</th>
                      <th className="py-1 pr-2 text-right font-medium">Now</th>
                      <th className="py-1 pr-2 text-right font-medium">New</th>
                      <th className="py-1 font-medium">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.changes.map((c) => (
                      <tr
                        key={`${c.section}|${c.year}|${c.figure}`}
                        className="border-t border-blue-200/60"
                      >
                        <td className="py-1 pr-2">{c.year}</td>
                        <td className="py-1 pr-2">
                          <span className="text-faint">{c.section} · </span>
                          {c.figure}
                        </td>
                        <td className="py-1 pr-2 text-right">
                          {c.format === "table"
                            ? c.kind === "insert"
                              ? "—"
                              : "current table"
                            : showValue(c.from, c.format)}
                        </td>
                        <td className="py-1 pr-2 text-right font-medium">
                          {c.format === "table"
                            ? c.kind === "insert"
                              ? "added"
                              : "updated"
                            : showValue(c.to, c.format)}
                        </td>
                        <td className="text-faint py-1">{c.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {admin ? (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      approve.mutate({
                        dataVersion: version,
                        diffHash: preview.diffHash,
                      })
                    }
                    disabled={approve.isPending}
                    className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
                  >
                    {approve.isPending
                      ? "Applying..."
                      : `Apply ${preview.changes.length} change${preview.changes.length === 1 ? "" : "s"}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => dismiss.mutate({ dataVersion: version })}
                    disabled={dismiss.isPending}
                    className="text-xs hover:underline"
                  >
                    Dismiss
                  </button>
                  {approve.isError && (
                    <span className="text-xs text-red-600">
                      {approve.error.message}
                    </span>
                  )}
                </div>
              ) : (
                <p className="text-caption">An admin can apply it.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function HowItWorks() {
  return (
    <details className="text-secondary text-sm">
      <summary className="cursor-pointer text-blue-600 hover:underline">
        How tax data updates work
      </summary>
      <div className="mt-2 space-y-2 text-xs leading-relaxed">
        <p>
          <strong>Where the figures come from.</strong> Every yearly figure
          Ledgr&apos;s tax math uses — IRS contribution limits and other yearly
          amounts, withholding tables (Publication 15-T), capital-gains and
          Medicare (IRMAA) brackets, ACA poverty levels — is taken from the
          published IRS, Social Security, Medicare and HHS notices. Ledgr ships
          them in its tax-data file, each figure with its source.
        </p>
        <p>
          <strong>When they arrive.</strong> Each time Ledgr starts, it checks
          these tables against the tax-data file that came with this version: a
          new year is added, and a figure Ledgr corrected replaces the old one.
          New figures reach you by updating Ledgr.
        </p>
        <p>
          <strong>Your changes stay.</strong> A figure you change here is yours
          from then on — updates never overwrite it. If you changed one Ledgr
          ships, it shows the shipped value and <em>Reset to shipped</em> hands
          it back. Saving a figure without changing it doesn&apos;t make it
          yours.
        </p>
        <p>
          <strong>Planning ahead of the IRS.</strong> <em>+ Year</em> copies the
          latest figures forward so you can plan a year that isn&apos;t
          published yet. Those are <em>carried forward</em>: when a Ledgr update
          brings the real figures, they replace the carried ones automatically —
          unless you&apos;ve edited them. Confirm each one once you&apos;ve
          checked it.
        </p>
        <p>
          <strong>Between Ledgr updates.</strong> With{" "}
          <Link
            href="/settings?tab=integrations&section=taxData"
            className="text-blue-600 hover:underline"
          >
            tax data updates
          </Link>{" "}
          on, Ledgr checks once a week for new figures the project has published
          and signed. You see exactly what would change, with each figure&apos;s
          source, and an admin approves it — the same rules apply: your own
          changes are never touched.
        </p>
        <p>
          <strong>A late year.</strong> Projections grow each table with
          inflation from the year it came from, so they stay sensible while a
          year is late. When figures are overdue, this page and the Data
          indicator in the sidebar say so.
        </p>
      </div>
    </details>
  );
}

export function TaxDataUpdates({ admin }: { admin: boolean }) {
  const utils = trpc.useUtils();
  const { data } = trpc.settings.taxData.status.useQuery();
  const { data: sync } = trpc.settings.taxDataSync.status.useQuery();
  const confirm = trpc.settings.taxData.confirm.useMutation({
    onSuccess: () => utils.settings.taxData.status.invalidate(),
  });
  const [showCarried, setShowCarried] = useState(false);

  const behind = data?.sections.filter((s) => s.behind) ?? [];
  const next = data?.sections.find((s) => s.upcoming);
  const carried = data?.carriedRows ?? [];

  return (
    <div className="mb-4 space-y-2">
      <HowItWorks />
      <CommunityUpdate admin={admin} />
      {behind.length > 0 ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          {behind[0]!.expectedYear} figures aren&apos;t in yet for{" "}
          {behind.map((s) => s.label.toLowerCase()).join(", ")} — Ledgr is using
          the newest year it has (
          {behind
            .map((s) => s.newestYear)
            .filter((y) => y !== null)
            .join(" / ") || "none"}
          ), grown with inflation. {behind[0]!.usually[0]!.toUpperCase()}
          {behind[0]!.usually.slice(1)}; a Ledgr update brings them in
          {sync && !sync.enabled && sync.offReason === "setting" && (
            <>
              {" "}
              — or turn on{" "}
              <Link
                href="/settings?tab=integrations&section=taxData"
                className="underline"
              >
                tax data updates
              </Link>{" "}
              to get them as soon as they&apos;re published
            </>
          )}
          .
        </p>
      ) : next?.upcoming ? (
        <p className="text-faint text-xs">
          Tax data is current. Next: {next.upcoming.year} figures —{" "}
          {next.usually}.
        </p>
      ) : null}
      {carried.length > 0 && (
        <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
          <button
            type="button"
            className="hover:underline"
            onClick={() => setShowCarried(!showCarried)}
          >
            {carried.length} carried-forward figure
            {carried.length === 1 ? "" : "s"} to check {showCarried ? "▾" : "▸"}
          </button>
          {showCarried && (
            <>
              <p className="text-caption mt-1">
                Copied from an earlier year. Check each against the published
                figure, then confirm it — or edit it in its section. A Ledgr
                update with the real figures replaces any you haven&apos;t
                edited.
              </p>
              <ul className="mt-2 space-y-1">
                {carried.map((c) => (
                  <li
                    key={`${c.table}:${c.id}`}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span>
                      {c.taxYear} · {c.name}
                    </span>
                    {admin && (
                      <button
                        type="button"
                        onClick={() =>
                          confirm.mutate({ table: c.table, id: c.id })
                        }
                        className="text-blue-600 hover:underline"
                      >
                        Confirm
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
