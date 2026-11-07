"use client";

/** The wizard's first step: start setting up, or restore a backup. */

export function WelcomeStep({
  onNext,
  onRestore,
}: {
  onNext: () => void;
  onRestore: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-8 text-center">
      <div className="text-primary text-4xl font-bold">Welcome to Ledgr!</div>
      <p className="text-muted max-w-md text-lg">
        Let&apos;s set up your financial dashboard. We&apos;ll walk you through
        a few quick steps to get your household configured.
      </p>
      <button
        onClick={onNext}
        className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-700"
      >
        Get Started
      </button>
      <div className="flex w-full max-w-xs items-center gap-3">
        <div className="bg-surface-strong h-px flex-1" />
        <span className="text-muted text-sm">or</span>
        <div className="bg-surface-strong h-px flex-1" />
      </div>
      <button
        onClick={onRestore}
        className="border-default text-muted hover:text-primary hover:bg-surface-elevated rounded-lg border px-6 py-3 transition-colors"
      >
        Restore from Backup
      </button>
    </div>
  );
}
