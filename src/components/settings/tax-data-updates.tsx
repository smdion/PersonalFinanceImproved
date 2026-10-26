"use client";

/**
 * Settings → Reference Data: how tax data updates work, whether this
 * install's tax data is current, and the carried-forward figures to check
 * (lib/pure/tax-data-status.ts; server: settings.taxData).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";

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
          {behind[0]!.usually.slice(1)}; a Ledgr update brings them in.
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
