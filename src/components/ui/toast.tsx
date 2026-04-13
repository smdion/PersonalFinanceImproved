"use client";

import {
  useToasts,
  type ToastVariant,
  type ToastAction,
} from "@/lib/hooks/use-toast";
import { useEffect, useState } from "react";

const variantStyles: Record<ToastVariant, string> = {
  success: "bg-green-50 border-green-300 text-green-800",
  error: "bg-red-50 border-red-300 text-red-800",
  info: "bg-blue-50 border-blue-300 text-blue-800",
};

const variantIcons: Record<ToastVariant, string> = {
  success: "\u2713",
  error: "\u2715",
  info: "\u2139",
};

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
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border shadow-md text-sm transition-all duration-200 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      } ${variantStyles[variant]}`}
    >
      <span className="font-semibold text-base leading-none" aria-hidden="true">
        {variantIcons[variant]}
      </span>
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
      <button
        type="button"
        onClick={() => onDismiss(id)}
        className="ml-2 opacity-60 hover:opacity-100 transition-opacity p-1 min-w-[44px] min-h-[44px] flex items-center justify-center"
        aria-label="Dismiss notification"
      >
        <svg
          className="w-3 h-3"
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
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm print:hidden"
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
