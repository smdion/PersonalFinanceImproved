"use client";

/**
 * Privacy mode's safety net for text the format helpers never touch: names
 * and notes the household typed ("Deck ($20,000)"), milestone labels
 * ("Your first $100k"), server-built sentences. While privacy is on, every
 * "$<digit>" in the page's text is masked — the same rule the privacy E2E
 * checks — except inside `[data-privacy-visible]` (ratios like "per $1",
 * unit labels, colour keys). Turning privacy off restores the original text.
 *
 * Amounts the app formats (formatCurrency, compactCurrency) are already
 * masked when rendered; this only catches what slipped past them, so it
 * rarely changes anything.
 */
import { maskAmountsInText, maskedAmount } from "@/lib/utils/format";

const AMOUNT = /\$\s?-?\d/;
/** A "$" (or "-$") that ends one text node, its number starting the next —
 *  how JSX renders `${formatNumber(x)}`. */
const TRAILING_DOLLAR = /-?\$\s?$/;
const LEADING_NUMBER = /^-?\d[\d,]*(?:\.\d+)?(?:[kKMB]\b)?/;
const SKIP = "script, style, textarea, [data-privacy-visible]";

type Original = { value: string; masked: string };

function maskNode(node: Text, originals: Map<Text, Original>) {
  const parent = node.parentElement;
  const value = node.nodeValue;
  if (!parent || !value || parent.closest(SKIP)) return;
  let masked = AMOUNT.test(value) ? maskAmountsInText(value) : value;
  const prev = node.previousSibling;
  if (
    prev?.nodeType === Node.TEXT_NODE &&
    TRAILING_DOLLAR.test(prev.nodeValue ?? "")
  )
    masked = masked.replace(LEADING_NUMBER, (m) => maskedAmount(m).slice(1));
  if (masked === value) return;
  // What the node held before masking is its current text (React may have
  // changed it since an earlier mask).
  originals.set(node, { value, masked });
  node.nodeValue = masked;
}

function maskTree(root: Node, originals: Map<Text, Original>) {
  if (root.nodeType === Node.TEXT_NODE) {
    maskNode(root as Text, originals);
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode())
    maskNode(n as Text, originals);
}

/** Start masking `root` (the page); returns a function that stops and
 *  restores every text node it changed that still shows the mask. */
export function startPrivacyTextGuard(root: HTMLElement = document.body) {
  const originals = new Map<Text, Original>();
  maskTree(root, originals);
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") maskTree(r.target, originals);
      // A number appended after a "$" node masks via its own record.
      for (const n of r.addedNodes) maskTree(n, originals);
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
  });
  return () => {
    observer.disconnect();
    for (const [node, o] of originals)
      if (node.nodeValue === o.masked) node.nodeValue = o.value;
    originals.clear();
  };
}
