import { formatDate } from "@/lib/utils/format";

/** "Oct 30" from YYYY-MM-DD. */
export const shortDay = (day: string) => formatDate(day, "monthDay");
