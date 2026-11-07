"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";

/** Open modals by render order: Escape closes only the newest. */
const openModals = new Set<number>();
let rendered = 0;

const OVERLAY = "fixed inset-0 z-[110] flex bg-black/40 print:hidden";

const PLACEMENT = {
  center: "items-center justify-center",
  right: "justify-end",
} as const;

type ModalName =
  { labelledBy: string; label?: never } | { label: string; labelledBy?: never };

export type ModalProps = ModalName & {
  onClose: () => void;
  children: ReactNode;
  /** The panel's own classes: size, surface, border, padding. */
  className: string;
  role?: "dialog" | "alertdialog";
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  /** `right` docks a full-height panel to the right edge. */
  placement?: keyof typeof PLACEMENT;
  /** Keeps a 1rem gap between the panel and the viewport's edges. */
  gutter?: boolean;
};

/**
 * Every dialog's backdrop and layer (above toasts). Mount it to open it.
 * Focus moves inside, stays there, and goes back to the opener on close.
 */
export function Modal({
  onClose,
  children,
  className,
  role = "dialog",
  closeOnEscape = true,
  closeOnBackdrop = true,
  placement = "center",
  gutter = false,
  labelledBy,
  label,
}: ModalProps) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const [opener] = useState(() =>
    typeof document === "undefined" ? null : document.activeElement,
  );
  const [order] = useState(() => ++rendered);
  const latest = useRef({ onClose, closeOnEscape });
  useEffect(() => {
    latest.current = { onClose, closeOnEscape };
  });

  useEffect(() => {
    openModals.add(order);
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (Math.max(...openModals) !== order) return;
      if (!latest.current.closeOnEscape) return;
      e.preventDefault();
      latest.current.onClose();
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      openModals.delete(order);
    };
  }, [order]);

  useEffect(() => {
    const panel = trapRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [opener, trapRef]);

  return (
    <div
      className={`${OVERLAY} ${PLACEMENT[placement]} ${gutter ? "p-4" : ""}`}
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={trapRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={label}
        tabIndex={-1}
        className={`${className} outline-none`}
      >
        {children}
      </div>
    </div>
  );
}
