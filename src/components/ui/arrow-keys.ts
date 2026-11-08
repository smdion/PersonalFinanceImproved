import type { KeyboardEvent } from "react";

const NEXT = new Set(["ArrowRight", "ArrowDown"]);
const PREV = new Set(["ArrowLeft", "ArrowUp"]);

/**
 * Arrow keys, Home and End along a row of tabs or options (WAI-ARIA tabs and
 * radio group): the one they land on is chosen and focused. The row's
 * buttons are its element's children, in the order of `values`.
 */
export function moveChoice<T>(
  e: KeyboardEvent<HTMLElement>,
  values: readonly T[],
  index: number,
  choose: (value: T) => void,
  { vertical }: { vertical: boolean },
): void {
  const key = e.key;
  const along = vertical || (key !== "ArrowUp" && key !== "ArrowDown");
  const last = values.length - 1;
  let next: number;
  if (NEXT.has(key) && along) next = index >= last ? 0 : index + 1;
  else if (PREV.has(key) && along) next = index <= 0 ? last : index - 1;
  else if (key === "Home") next = 0;
  else if (key === "End") next = last;
  else return;
  e.preventDefault();
  if (next === index || last < 0) return;
  choose(values[next]!);
  const target = e.currentTarget.parentElement?.children[next];
  if (target instanceof HTMLElement) target.focus();
}

/** The one button of a row that Tab reaches: the chosen one, else the first. */
export function rovingTabIndex(chosenIndex: number, index: number): 0 | -1 {
  return index === (chosenIndex < 0 ? 0 : chosenIndex) ? 0 : -1;
}
