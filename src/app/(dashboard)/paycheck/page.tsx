/**
 * Paycheck page: the server shell for PaycheckContent, which loads its own
 * data (no prefetch).
 */

import { PaycheckContent } from "./paycheck-content";
import { FilingStatusConfirm } from "@/components/taxes/filing-status-confirm";

export default function PaycheckPage() {
  return (
    <>
      <FilingStatusConfirm />
      <PaycheckContent />
    </>
  );
}
