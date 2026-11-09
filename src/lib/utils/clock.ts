/** The wall clock, for when something happens: a write stamp, a cache
 *  entry's expiry, a log line. Never a business date: those come from the
 *  request scope (RULES § Time Resolution). */
export function writeStamp(): Date {
  return new Date();
}
