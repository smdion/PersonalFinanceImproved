"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { AccumulationMethodologyContent } from "@/components/accumulation-methodology-content";

export default function AccumulationMethodologyPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <PageHeader title="Accumulation Methodology" />
      <AccumulationMethodologyContent />
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
