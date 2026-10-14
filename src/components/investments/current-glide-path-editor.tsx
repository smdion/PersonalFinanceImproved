"use client";

/**
 * Edit the household's current glide path — the target mix by age for what
 * it holds today, separate from the retirement simulation's glide path.
 * Admins edit (household setting); the server checks each age adds to 100%.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { SK_CURRENT_GLIDE_PATH } from "@/lib/constants/settings-keys";
import { toast } from "@/lib/hooks/use-toast";
import { formatPercent } from "@/lib/utils/format";

type AssetClass = { assetClassId: number; name: string };
type Row = { key: number; age: number; percents: Record<number, string> };

/** Stable row keys for the editing session (ages can change). */
let nextKey = 0;

const toRows = (
  path: { age: number; allocations: Record<number, number> }[],
): Row[] =>
  path.map((p) => ({
    key: nextKey++,
    age: p.age,
    percents: Object.fromEntries(
      Object.entries(p.allocations).map(([id, v]) => [
        Number(id),
        String(Math.round(v * 1000) / 10),
      ]),
    ),
  }));

const rowTotal = (r: Row) =>
  Object.values(r.percents).reduce((s, v) => s + (Number(v) || 0), 0);

export function CurrentGlidePathEditor({
  classes,
  currentGlidePath,
  age,
  todaysTarget,
  onClose,
}: {
  classes: AssetClass[];
  currentGlidePath:
    { age: number; allocations: Record<number, number> }[] | null;
  /** The primary person's age — the first row's default. */
  age: number | null;
  /** Today's target (whichever path it comes from), to start from. */
  todaysTarget: Record<number, number | null>;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const save = trpc.settings.appSettings.upsert.useMutation({
    onSuccess: () => {
      void utils.investments.invalidate();
      void utils.settings.appSettings.list.invalidate();
      toast.success("Current glide path saved");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const [rows, setRows] = useState<Row[]>(() =>
    currentGlidePath
      ? toRows(currentGlidePath)
      : [
          {
            key: nextKey++,
            age: age ?? 40,
            percents: Object.fromEntries(
              classes.map((c) => [
                c.assetClassId,
                String(
                  Math.round((todaysTarget[c.assetClassId] ?? 0) * 1000) / 10,
                ),
              ]),
            ),
          },
        ],
  );
  // Whole ages 0–120 (a cleared field reads as 0 — or NaN — and must not
  // save), each once, every mix adding to 100%.
  const valid =
    rows.length > 0 &&
    rows.every((r) => Number.isInteger(r.age) && r.age >= 0 && r.age <= 120) &&
    new Set(rows.map((r) => r.age)).size === rows.length &&
    rows.every((r) => Math.abs(rowTotal(r) - 100) < 0.5);
  const update = (i: number, change: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...change } : r)));

  return (
    <div className="bg-surface-sunken mb-3 space-y-2 rounded-lg p-3 text-xs">
      <p className="text-muted">
        Your target mix for what you hold today, by age — kept apart from the
        retirement simulation&apos;s glide path, so it can be more conservative
        on purpose. Between ages the mix slides in a straight line; before the
        first and after the last it holds steady.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-faint text-left">
              <th className="pr-2 font-normal">Age</th>
              {classes.map((c) => (
                <th key={c.assetClassId} className="pr-2 font-normal">
                  {c.name}
                </th>
              ))}
              <th className="font-normal">Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const total = rowTotal(r);
              return (
                <tr key={r.key}>
                  <td className="pr-2">
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={Number.isNaN(r.age) ? "" : r.age}
                      aria-label="Age"
                      className="bg-surface-primary w-14 rounded border px-1"
                      onChange={(e) =>
                        update(i, {
                          age:
                            e.target.value === ""
                              ? NaN
                              : Number(e.target.value),
                        })
                      }
                    />
                  </td>
                  {classes.map((c) => (
                    <td key={c.assetClassId} className="pr-2">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={r.percents[c.assetClassId] ?? ""}
                        aria-label={`${c.name} % at age ${r.age}`}
                        className="bg-surface-primary w-16 rounded border px-1"
                        onChange={(e) =>
                          update(i, {
                            percents: {
                              ...r.percents,
                              [c.assetClassId]: e.target.value,
                            },
                          })
                        }
                      />
                    </td>
                  ))}
                  <td
                    className={
                      Math.abs(total - 100) < 0.5
                        ? "text-secondary"
                        : "text-red-600"
                    }
                  >
                    {formatPercent(total / 100, 1)}
                  </td>
                  <td>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        className="text-muted hover:text-red-600"
                        onClick={() =>
                          setRows((rs) => rs.filter((_, j) => j !== i))
                        }
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="text-blue-600 hover:underline"
          onClick={() =>
            setRows((rs) => {
              const last = rs[rs.length - 1]!;
              return [
                ...rs,
                {
                  key: nextKey++,
                  age: last.age + 10,
                  percents: { ...last.percents },
                },
              ];
            })
          }
        >
          + Add an age
        </button>
        <span className="flex-1" />
        {currentGlidePath && (
          <button
            type="button"
            className="text-muted hover:text-primary"
            disabled={save.isPending}
            onClick={() =>
              save.mutate({ key: SK_CURRENT_GLIDE_PATH, value: null })
            }
            title="Go back to the retirement simulation's glide path"
          >
            Use the retirement glide path
          </button>
        )}
        <button type="button" className="text-muted" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!valid || save.isPending}
          className="rounded bg-blue-600 px-2 py-0.5 text-white disabled:opacity-50"
          onClick={() =>
            save.mutate({
              key: SK_CURRENT_GLIDE_PATH,
              value: rows.map((r) => ({
                age: r.age,
                allocations: Object.fromEntries(
                  Object.entries(r.percents)
                    .map(([id, v]) => [id, (Number(v) || 0) / 100] as const)
                    .filter(([, v]) => v > 0),
                ),
              })),
            })
          }
        >
          Save
        </button>
      </div>
      {!valid && (
        <p className="text-red-600">
          Each age needs its own row, and each row must add up to 100%.
        </p>
      )}
    </div>
  );
}
