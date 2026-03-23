/** Redirects legacy /mortgage route to /liabilities. */
import { redirect } from "next/navigation";

export default function MortgagePage() {
  redirect("/liabilities");
}
