"use client";

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ColumnItem = {
  key: string;
  node: ReactNode;
  /** A first guess at its height (e.g. its row count), before it's measured. */
  weight: number;
};

/** Each item in turn goes to the shorter column: the columns end level. */
function assign(heights: readonly number[], columns: number): number[] {
  const totals = Array.from({ length: columns }, () => 0);
  return heights.map((h) => {
    const col = totals.indexOf(Math.min(...totals));
    totals[col]! += h;
    return col;
  });
}

/**
 * Cards in two columns of about equal height, in reading order. Placed by
 * a guess first, then by their measured heights once rendered — only when
 * the set of cards changes, never when one opens a row (a card jumping
 * columns mid-click would be worse than an uneven bottom). One column on
 * small screens.
 */
export function BalancedColumns({
  items,
  gap = "gap-3",
}: {
  items: readonly ColumnItem[];
  gap?: string;
}) {
  const signature = items.map((i) => i.key).join("|");
  const guess = useMemo(
    () =>
      assign(
        items.map((i) => i.weight),
        2,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- placed per set of cards
    [signature],
  );
  const [placed, setPlaced] = useState<{ sig: string; cols: number[] }>({
    sig: signature,
    cols: guess,
  });
  const refs = useRef(new Map<string, HTMLDivElement>());

  useLayoutEffect(() => {
    const heights = items.map(
      (i) => refs.current.get(i.key)?.offsetHeight ?? 0,
    );
    if (heights.some((h) => h === 0)) return;
    const cols = assign(heights, 2);
    setPlaced((p) =>
      p.sig === signature && p.cols.join() === cols.join()
        ? p
        : { sig: signature, cols },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- measured per set of cards
  }, [signature]);

  const cols = placed.sig === signature ? placed.cols : guess;
  const column = (c: number) =>
    items
      .filter((_, i) => cols[i] === c)
      .map((i) => (
        <div
          key={i.key}
          ref={(el) => {
            if (el) refs.current.set(i.key, el);
            else refs.current.delete(i.key);
          }}
        >
          {i.node}
        </div>
      ));

  return (
    <div className={`grid grid-cols-1 items-start lg:grid-cols-2 ${gap}`}>
      <div className={`flex flex-col ${gap}`}>{column(0)}</div>
      <div className={`flex flex-col ${gap}`}>{column(1)}</div>
    </div>
  );
}
