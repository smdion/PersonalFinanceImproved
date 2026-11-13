/** Invented retirement settings rows for the Roth-overlay tag: a row saved
 *  before the switch existed keeps the overlay on, an empty target reads
 *  the 12% it always read, and a row with a switch is left as stored. */

export const PERSON = { id: 62, name: "Invented Saver" };

export type RothOverlayCase = {
  readonly id: number;
  /** As stored before the tag (no switch) or after it (`overlay` set). */
  readonly target: string | null;
  readonly overlay?: boolean;
  readonly after: { readonly target: number; readonly overlay: boolean };
};

export const ROWS: readonly RothOverlayCase[] = [
  // Before the tag, a target saved: the overlay stays on at that target.
  { id: 901, target: "0.22", after: { target: 0.22, overlay: true } },
  // Before the tag, an empty target (read as 12%): on, at 12%.
  { id: 902, target: null, after: { target: 0.12, overlay: true } },
  // Saved after the tag with the overlay off: left as stored.
  {
    id: 903,
    target: "0.12",
    overlay: false,
    after: { target: 0.12, overlay: false },
  },
  // Saved after the tag with the overlay on: left as stored.
  {
    id: 904,
    target: "0.24",
    overlay: true,
    after: { target: 0.24, overlay: true },
  },
];

/** The rows the converter writes. */
export const WRITTEN = [901, 902];
