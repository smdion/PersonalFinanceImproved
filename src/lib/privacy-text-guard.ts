"use client";

/**
 * Privacy mode's safety net for text the format helpers never touch: names
 * and notes the household typed ("Deck ($20,000)"), milestone labels
 * ("Your first $100k"), server-built sentences. While privacy is on, every
 * "$<digit>" in the page's text and hover tooltips (`title`) is masked — the same rule the privacy E2E
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
type Originals = { text: Map<Text, Original>; title: Map<Element, Original> };

/** A hover tooltip: the browser shows it as text, outside the DOM tree. */
function maskTitle(el: Element, originals: Map<Element, Original>) {
  const value = el.getAttribute("title");
  if (!value || !AMOUNT.test(value) || el.closest(SKIP)) return;
  const masked = maskAmountsInText(value);
  if (masked === value) return;
  originals.set(el, { value, masked });
  el.setAttribute("title", masked);
}

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

function maskTree(root: Node, originals: Originals) {
  if (root.nodeType === Node.TEXT_NODE) {
    maskNode(root as Text, originals.text);
    return;
  }
  if (root.nodeType === Node.ELEMENT_NODE)
    maskTitle(root as Element, originals.title);
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) maskNode(n as Text, originals.text);
    else maskTitle(n as Element, originals.title);
  }
}

/** Start masking `root` (the page); returns a function that stops and
 *  restores every text node it changed that still shows the mask. */
export function startPrivacyTextGuard(root: HTMLElement = document.body) {
  const originals: Originals = { text: new Map(), title: new Map() };
  maskTree(root, originals);
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") maskTree(r.target, originals);
      if (r.type === "attributes")
        maskTitle(r.target as Element, originals.title);
      // A number appended after a "$" node masks via its own record.
      for (const n of r.addedNodes) maskTree(n, originals);
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["title"],
  });
  return () => {
    observer.disconnect();
    for (const [node, o] of originals.text)
      if (node.nodeValue === o.masked) node.nodeValue = o.value;
    for (const [el, o] of originals.title)
      if (el.getAttribute("title") === o.masked)
        el.setAttribute("title", o.value);
    originals.text.clear();
    originals.title.clear();
  };
}
