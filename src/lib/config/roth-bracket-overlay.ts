/** The Roth bracket overlay switch as a stored row reads. */

/**
 * A row's switch, read or copied. Empty only on a row no tag 0022 converter
 * reached (a backup restored past its label): it was saved when the overlay
 * applied to every row, so it reads as on (FALLBACKS § Old stored shapes).
 */
export function storedRothOverlay(stored: boolean | null): boolean {
  return stored ?? true;
}
