import { fireEvent } from "@testing-library/react";

/**
 * Presses a key on an element the way a browser does. happy-dom has no
 * activation behavior, so this adds it: a native button turns Enter (on
 * keydown) and Space (on keyup) into a click, unless a handler prevented
 * the key's default. Any other element gets only the key events, so a
 * clickable div with no key handler does nothing, as in a browser.
 */
export function pressKey(el: HTMLElement, key: "Enter" | " "): void {
  const activates = el instanceof HTMLButtonElement && !el.disabled;
  const down = fireEvent.keyDown(el, { key });
  if (key === "Enter") {
    if (activates && down) fireEvent.click(el);
    return;
  }
  const up = fireEvent.keyUp(el, { key });
  if (activates && down && up) fireEvent.click(el);
}
