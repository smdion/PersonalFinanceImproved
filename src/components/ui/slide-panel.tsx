"use client";

import { useEffect, useRef, useCallback } from "react";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";

export function SlidePanel({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(isOpen);

  const handleClose = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, handleClose]);

  // Move focus into the panel when it opens
  useEffect(() => {
    if (isOpen && trapRef.current) {
      trapRef.current.focus();
    }
  }, [isOpen, trapRef]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

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
        className="bg-surface-primary animate-in slide-in-from-right flex h-full w-full max-w-2xl flex-col shadow-xl duration-200 outline-none"
      >
        <div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
          <h2 className="text-primary text-lg font-semibold">{title}</h2>
          <button
            onClick={handleClose}
            className="text-faint hover:text-secondary hover:bg-surface-elevated rounded-md p-1.5 transition-colors"
            aria-label="Close"
          >
            <svg
              aria-hidden="true"
              className="h-5 w-5"
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
