"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { DecumulationMethodologyContent } from "@/components/decumulation-methodology-content";

export default function DecumulationMethodologyPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <PageHeader title="Decumulation Methodology" />
      <DecumulationMethodologyContent />
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
