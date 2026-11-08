"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { focusInto, useFocusTrap } from "@/lib/hooks/use-focus-trap";

/** Open modals, by render order, with their layer's rank. */
const openModals = new Map<number, number>();
let rendered = 0;

const OVERLAY = "fixed inset-0 flex print:hidden";

/** Every dialog's shade, above toasts; the first-run wizard keeps its own. */
const LAYER = {
  dialog: "z-[110] bg-black/40",
  firstRun: "z-50 bg-black/60 backdrop-blur-sm",
} as const;

/** Which layer is on top: a dialog opens over the first-run wizard. */
const LAYER_RANK: Record<keyof typeof LAYER, number> = {
  firstRun: 0,
  dialog: 1,
};

/** The modal on top, which alone takes Escape, Tab and focus: the
 *  highest layer, and within it the newest. */
function topModal(): number | undefined {
  let top: [order: number, rank: number] | undefined;
  for (const [order, rank] of openModals)
    if (!top || rank > top[1] || (rank === top[1] && order > top[0]))
      top = [order, rank];
  return top?.[0];
}

const PLACEMENT = {
  center: "items-center justify-center",
  right: "justify-end",
  top: "items-start justify-center pt-[15vh]",
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
  /** `right` docks a full-height panel to the right edge; `top` hangs the
   *  panel below the top, as a command palette. */
  placement?: keyof typeof PLACEMENT;
  /** Keeps a 1rem gap between the panel and the viewport's edges. */
  gutter?: boolean;
  layer?: keyof typeof LAYER;
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
  layer = "dialog",
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

  // Registered before any modal's focus effect runs, so modals opening in
  // one commit agree on which is on top.
  useLayoutEffect(() => {
    openModals.set(order, LAYER_RANK[layer]);
    return () => {
      openModals.delete(order);
    };
  }, [order, layer]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || topModal() !== order) return;
      const panel = trapRef.current;
      // Focus outside the top dialog (a focused button disabled itself
      // mid-write, and focus fell to body): Tab goes back in.
      if (e.key === "Tab" && panel && !panel.contains(document.activeElement)) {
        e.preventDefault();
        focusInto(panel, e.shiftKey);
        return;
      }
      if (e.key !== "Escape" || !latest.current.closeOnEscape) return;
      e.preventDefault();
      latest.current.onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [order, trapRef]);

  // A modal that opens under another (the wizard mounting under quick
  // search) leaves focus there, and gives it back only if it held it.
  useEffect(() => {
    const panel = trapRef.current;
    if (
      topModal() === order &&
      panel &&
      !panel.contains(document.activeElement)
    )
      panel.focus();
    return () => {
      const active = document.activeElement;
      const held =
        !active || active === document.body || panel?.contains(active);
      if (held && opener instanceof HTMLElement && opener.isConnected)
        opener.focus();
    };
  }, [opener, trapRef, order]);

  return (
    <div
      className={`${OVERLAY} ${LAYER[layer]} ${PLACEMENT[placement]} ${gutter ? "p-4" : ""}`}
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
