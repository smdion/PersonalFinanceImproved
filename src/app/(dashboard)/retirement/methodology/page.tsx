"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { MethodologyContent } from "@/components/methodology-content";

export default function MethodologyPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <PageHeader title="Monte Carlo Methodology" />
      <MethodologyContent />
      <div className="text-center pt-4">
        <Link
          href="/retirement"
          className="text-sm text-blue-600 hover:text-blue-700 underline"
        >
          Back to Retirement
        </Link>
      </div>
    </div>
  );
}
