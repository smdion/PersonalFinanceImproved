/**
 * Historical page: the server shell for HistoricalContent, which loads its
 * own data (no prefetch, so its queries run as before).
 */

import { HistoricalContent } from "./historical-content";

export default function HistoricalPage() {
  return <HistoricalContent />;
}
