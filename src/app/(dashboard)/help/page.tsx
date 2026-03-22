"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { HelpContent } from "@/components/help-content";

export default function HelpPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <PageHeader
        title="Help & Guide"
        subtitle="Everything you need to know to get the most out of Ledgr"
      />
      <HelpContent />
      <div className="text-center pt-4">
        <Link
          href="/"
          className="text-sm text-blue-600 hover:text-blue-700 underline"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
