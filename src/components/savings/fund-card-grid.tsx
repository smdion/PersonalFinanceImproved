"use client";

import React from "react";

export function FundCardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{children}</div>
  );
}
