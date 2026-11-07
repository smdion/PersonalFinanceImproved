import type { KeyboardEvent, MouseEvent } from "react";

type PressEvent = MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>;

/**
 * Props that make a non-button element a button: focusable, Enter or Space
 * does what its click does, and `expanded` (if given) is its aria-expanded.
 */
export function asButton(onPress: (e: PressEvent) => void, expanded?: boolean) {
  return {
    role: "button",
    tabIndex: 0,
    "aria-expanded": expanded,
    onClick: onPress,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      onPress(e);
    },
  } as const;
}
