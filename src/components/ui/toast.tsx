"use client";

import {
  useToasts,
  type ToastVariant,
  type ToastAction,
} from "@/lib/hooks/use-toast";
import { useEffect, useState } from "react";
import { STATUS_COLORS } from "@/lib/utils/colors";

const variantStyles: Record<ToastVariant, string> = {
  success: `${STATUS_COLORS.green.bg} ${STATUS_COLORS.green.border} ${STATUS_COLORS.green.text}`,
  error: `${STATUS_COLORS.red.bg} ${STATUS_COLORS.red.border} ${STATUS_COLORS.red.text}`,
  info: `${STATUS_COLORS.blue.bg} ${STATUS_COLORS.blue.border} ${STATUS_COLORS.blue.text}`,
  loading: `${STATUS_COLORS.blue.bg} ${STATUS_COLORS.blue.border} ${STATUS_COLORS.blue.text}`,
};

const variantIcons: Record<Exclude<ToastVariant, "loading">, string> = {
  success: "\u2713",
  error: "\u2715",
  info: "\u2139",
};

function ToastIcon({ variant }: { variant: ToastVariant }) {
  if (variant === "loading") {
    return (
      <svg
        className="h-3.5 w-3.5 animate-spin"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
    );
  }
  return (
    <span className="text-base leading-none font-semibold" aria-hidden="true">
      {variantIcons[variant]}
    </span>
  );
}

function ToastItem({
  id,
  message,
  variant,
  action,
  onDismiss,
}: {
  id: string;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
  onDismiss: (id: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      role="alert"
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-md transition-all duration-200 ${
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      } ${variantStyles[variant]}`}
    >
      <ToastIcon variant={variant} />
      <span className="flex-1">{message}</span>
      {action && (
        <button
          type="button"
          onClick={() => {
            action.onClick();
            onDismiss(id);
          }}
          className="ml-2 px-2 py-1 text-xs font-semibold underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
        >
          {action.label}
        </button>
      )}
      {/* Loading toasts are dismissed programmatically when the operation
       *  settles, not by the user — no manual close affordance. */}
      {variant !== "loading" && (
        <button
          type="button"
          onClick={() => onDismiss(id)}
          className="ml-2 flex min-h-[44px] min-w-[44px] items-center justify-center p-1 opacity-60 transition-opacity hover:opacity-100"
          aria-label="Dismiss notification"
        >
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

/**
 * Renders active toasts. Mount once in the app shell (providers.tsx).
 */
export function ToastContainer() {
  const { toasts, dismiss } = useToasts();

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed right-4 bottom-4 z-[100] flex max-w-sm flex-col gap-2 print:hidden"
    >
      {toasts.map((t) => (
        <ToastItem
          key={t.id}
          id={t.id}
          message={t.message}
          variant={t.variant}
          action={t.action}
          onDismiss={dismiss}
        />
      ))}
    </div>
  );
}
