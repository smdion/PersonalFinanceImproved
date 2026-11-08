/**
 * House page: the server shell for HouseContent, which loads its own data
 * (no prefetch, so its queries run as before).
 */

import { HouseContent } from "./house-content";

export default function HousePage() {
  return <HouseContent />;
}
