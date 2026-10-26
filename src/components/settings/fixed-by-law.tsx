"use client";

/**
 * Settings → Reference Data → Fixed by law: the figures set by law and not
 * indexed, read-only, each with its citation (lib/config/fixed-by-law.ts).
 */
import { fixedByLawGroups } from "@/lib/config/fixed-by-law";

export function FixedByLaw() {
  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold">Fixed by law</h2>
      <p className="text-muted mb-4 text-sm">
        Figures set by law that don&apos;t change with inflation. They only
        change when Congress changes the law, so Ledgr builds them in instead of
        updating them yearly, and they can&apos;t be edited here. A few figures
        set by law live with the yearly figures instead — the senior deduction,
        the HSA catch-up and the capital-gains rates — and are edited in their
        own sections.
      </p>
      <div className="space-y-4">
        {fixedByLawGroups().map((g) => (
          <section key={g.label} className="rounded-lg border">
            <h3 className="bg-surface-sunken border-b px-4 py-2 text-sm font-semibold">
              {g.label}
            </h3>
            <dl className="divide-subtle divide-y text-sm">
              {g.items.map((i) => (
                <div
                  key={i.label}
                  className="grid gap-1 px-4 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-4"
                >
                  <dt className="text-secondary">{i.label}</dt>
                  <dd>
                    <div className="text-primary font-medium">{i.value}</div>
                    <div className="text-faint text-xs">{i.citation}</div>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
