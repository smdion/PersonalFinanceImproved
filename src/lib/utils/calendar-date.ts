/** A calendar day, "YYYY-MM-DD", with no time or zone. */
export type CalendarDate = `${number}-${string}-${string}`;

/** The day `instant` falls on in the server's zone, which is the
 *  household's (server/helpers/household-timezone.ts sets `TZ`). */
export function calendarDateOf(instant: Date): CalendarDate {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${instant.getFullYear()}-${two(instant.getMonth() + 1)}-${two(instant.getDate())}`;
}
