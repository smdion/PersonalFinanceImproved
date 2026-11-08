/**
 * Liabilities page: the server shell for LiabilitiesContent, which loads its
 * own data (no prefetch, so its queries run as before).
 */

import { LiabilitiesContent } from "./liabilities-content";

export default function LiabilitiesPage() {
  return <LiabilitiesContent />;
}
