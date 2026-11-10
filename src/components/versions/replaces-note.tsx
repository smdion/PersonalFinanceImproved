"use client";

/** The opening of a restore or import confirmation: what it replaces. */

import type { ReactNode } from "react";
import { useUser, isAdmin } from "@/lib/context/user-context";

/** "This will replace all current data …", saying for someone who isn't an
 *  admin what stays (installation-rows.ts, connection-links.ts). */
export function ReplacesNote({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  const admin = isAdmin(useUser());
  return (
    <p className={`text-muted text-sm ${className}`}>
      This will replace <strong>all current data</strong>
      {admin
        ? ""
        : " (sign-ins, access settings and each integration's credentials stay as they are, and so do its account links where they still name the same accounts)"}{" "}
      {children}
    </p>
  );
}
