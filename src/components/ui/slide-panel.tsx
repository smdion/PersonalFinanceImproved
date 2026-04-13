"use client";

import { useEffect, useRef, useCallback } from "react";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";

export function SlidePanel({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(open);

  const handleClose = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, handleClose]);

  // Move focus into the panel when it opens
  useEffect(() => {
    if (open && trapRef.current) {
      trapRef.current.focus();
    }
  }, [open, trapRef]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[100] flex justify-end bg-black/40 print:hidden"
      onClick={(e) => {
        if (e.target === backdropRef.current) handleClose();
      }}
      role="presentation"
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="bg-surface-primary w-full max-w-2xl h-full shadow-xl flex flex-col animate-in slide-in-from-right duration-200 outline-none"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="text-lg font-semibold text-primary">{title}</h2>
          <button
            onClick={handleClose}
            className="p-1.5 text-faint hover:text-secondary rounded-md hover:bg-surface-elevated transition-colors"
            aria-label="Close"
          >
            <svg
              aria-hidden="true"
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
