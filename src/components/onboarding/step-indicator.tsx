"use client";

/** Which wizard step you are on. */

export function StepIndicator({
  currentStep,
  steps,
}: {
  currentStep: number;
  steps: readonly string[];
}) {
  return (
    <div className="mb-8 flex items-center justify-center gap-2">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div className="flex flex-col items-center">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                i < currentStep
                  ? "bg-blue-600 text-white"
                  : i === currentStep
                    ? "bg-blue-600 text-white ring-2 ring-blue-300"
                    : "bg-surface-strong text-muted"
              }`}
            >
              {i < currentStep ? "\u2713" : i + 1}
            </div>
            <span className="text-muted mt-1 hidden text-xs sm:block">
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={`h-0.5 w-8 sm:w-12 ${
                i < currentStep ? "bg-blue-600" : "bg-surface-strong"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
