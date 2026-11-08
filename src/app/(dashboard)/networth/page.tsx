/**
 * Net worth page: the server shell for NetWorthContent, which loads its own
 * data (no prefetch).
 */

import { NetWorthContent } from "./networth-content";

export default function NetWorthPage() {
  return <NetWorthContent />;
}
