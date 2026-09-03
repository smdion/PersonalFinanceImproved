import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { AccumulationMethodologyContent } from "@/components/accumulation-methodology-content";

export default function AccumulationMethodologyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      <PageHeader title="Accumulation Methodology" />
      <AccumulationMethodologyContent />
      <div className="pt-4 text-center">
        <Link
          href="/retirement"
          className="text-sm text-blue-600 underline hover:text-blue-700"
        >
          Back to Retirement
        </Link>
      </div>
    </div>
  );
}
