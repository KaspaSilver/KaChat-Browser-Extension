// Amount fields show thousands commas as you type ("12,345.5") while the value the app reads stays
// plain (iOS 40c5258: KaspaAmountEntry and Binding.groupedAmount). Each field's `value` is
// wrapped: reading it gives the plain number, writing it shows the grouped one, so the code
// that sanitizes, checks and sends an amount is unchanged.

import { groupedAmountText as groupedWithCommas, ungroupedAmountText as ungroupedFromCommas } from "../shared/engine/amounts.js";

// Where the browser writes decimals with "," (de, fr, es, ...), a comma is always the decimal
// point, a pasted "1.234,5" is 1234.5, and thousands show as a narrow space ("2 500"), so nobody
// reads the shown amount wrong. Elsewhere commas stay thousands separators, but "0,001" (no
// grouped number starts "0,") is 0.001 (iOS 73af28a, IOS-078: "0,001" pasted read as 1000x).
const commaDecimal = (() => {
  try { return new Intl.NumberFormat().formatToParts(1.5).find((p) => p.type === "decimal")?.value === ","; } catch { return false; }
})();
const NARROW = "\u202F";

/** The amount as shown: thousands grouped the way this browser's language writes them. */
export function groupedAmountText(plain) {
  const text = groupedWithCommas(plain);
  return commaDecimal ? text.replaceAll(",", NARROW) : text;
}

function ungroupedAmountText(edited, previous) {
  const raw = String(edited ?? "");
  if (commaDecimal) {
    let text = raw.replaceAll(NARROW, "").replaceAll(" ", "").replaceAll("\u00A0", "");
    if (text.includes(",")) {
      text = text.replaceAll(".", "");
      const first = text.indexOf(",");
      text = `${text.slice(0, first)}.${text.slice(first + 1).replaceAll(",", "")}`;
    }
    return text;
  }
  // "0,001" or ",5": a single comma after nothing or a lone 0 is the decimal point
  const comma = raw.indexOf(",");
  if (comma >= 0 && comma === raw.lastIndexOf(",") && !raw.includes(".") && (comma === 0 || raw.slice(0, comma) === "0")) {
    return raw.replace(",", ".");
  }
  return ungroupedFromCommas(raw, previous);
}

// The send screens' amount (Send Kaspa, a spending address's Send, KasSigner's send), the .kachat
// offer and list price, and Add to Portfolio / a portfolio transaction's quantity. The portfolio
// converter keeps its own formatting, as on iOS. (From KaChat-Desktop ui/grouped-amount.js.)
const SELECTOR = ".sk-amount-input, #kl-offer-amount, #kl-price, #pf-ed-qty, #pf-atp-amount";

const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
const wrapped = new WeakSet();

function attach(input) {
  if (wrapped.has(input)) return;
  wrapped.add(input);
  const getShown = () => native.get.call(input);
  // What the field showed before the edit in progress: how a typed comma is told apart from ours.
  let lastShown = groupedAmountText(getShown());
  const show = (text) => { lastShown = text; native.set.call(input, text); };
  Object.defineProperty(input, "value", {
    configurable: true,
    get: () => ungroupedAmountText(getShown(), lastShown),
    set: (plain) => show(groupedAmountText(String(plain ?? ""))),
  });
  show(lastShown);
  // Runs before the page's own input handlers (capture), so they see the regrouped field.
  input.addEventListener("input", () => {
    const edited = getShown();
    const caret = input.selectionStart ?? edited.length;
    const plain = ungroupedAmountText(edited, lastShown);
    const next = groupedAmountText(plain);
    if (next === edited) { lastShown = next; return; }
    // Keep the caret after the same digit: count what isn't a grouping comma before it.
    const decimalComma = plain.includes(".") && !edited.includes(".");
    let keep = 0;
    for (let i = 0; i < caret; i += 1) if (edited[i] !== "," || decimalComma) keep += 1;
    show(next);
    let at = next.length;
    if (caret < edited.length) {
      at = 0;
      for (let seen = 0; at < next.length && seen < keep; at += 1) if (next[at] !== ",") seen += 1;
    }
    try { input.setSelectionRange(at, at); } catch { /* not focusable */ }
  }, true);
}

function scan(node) {
  if (!(node instanceof Element)) return;
  if (node.matches(SELECTOR)) attach(node);
  for (const input of node.querySelectorAll(SELECTOR)) attach(input);
}

/** Wraps every amount field now on the page and each one added later. */
export function installGroupedAmountInputs(root = document.documentElement) {
  scan(root);
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) scan(node);
  }).observe(root, { childList: true, subtree: true });
}
