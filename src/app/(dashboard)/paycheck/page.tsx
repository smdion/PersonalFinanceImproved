/**
 * Paycheck page: the server shell for PaycheckContent, which loads its own
 * data (no prefetch).
 */

import { PaycheckContent } from "./paycheck-content";

export default function PaycheckPage() {
  return <PaycheckContent />;
}
