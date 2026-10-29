// The keypad's rules (iOS KaspaKeypad.applying, KeypadAmountText; KaPay 05db583), with no screen
// code, so tools/test-send-steps.mjs runs them in node. send-steps.js draws the keypad itself.
// From KaChat-Desktop ui/send-steps.js.

import { groupedAmountText, usesCommaDecimal as engineUsesCommaDecimal } from "../shared/engine/amounts.js";

/** Whether this browser writes "," for the decimal point (iOS KaspaAmountEntry.usesCommaDecimal). */
export function usesCommaDecimal() {
  return engineUsesCommaDecimal();
}

/**
 * The amount text after a key (iOS KaspaKeypad.applying): plain digits with "." as the point, at
 * most `maxDecimals` decimals and 11 whole digits (more than all the Kaspa there will ever be). A
 * leading zero gives way to the next digit; the point on an empty amount writes "0.". A key that
 * can't apply leaves the text as it was. Keys: "0"-"9", "decimal", "delete", "clear".
 */
export function applyKeypadKey(key, text, maxDecimals = 8) {
  const current = String(text ?? "");
  if (key === "clear") return "";
  if (key === "delete") return current.slice(0, -1);
  if (key === "decimal") {
    if (current.includes(".") || maxDecimals <= 0) return current;
    return current ? `${current}.` : "0.";
  }
  if (!/^[0-9]$/.test(String(key))) return current;
  const point = current.indexOf(".");
  if (point >= 0) return current.length - point - 1 >= maxDecimals ? current : current + key;
  if (current === "0") return String(key);
  if (current.length >= 11) return current;
  return current + key;
}

/** The keys a physical keyboard types into a keypad: digits, "." / ",", Backspace (Delete clears). */
export function keypadKeyForKeyboard(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (/^[0-9]$/.test(event.key)) return event.key;
  if (event.key === "." || event.key === ",") return "decimal";
  if (event.key === "Backspace") return "delete";
  if (event.key === "Delete") return "clear";
  return null;
}

/** Big when short, smaller as it grows (iOS KeypadAmountText: 60 / 46 / 34 pt; the popup is
 *  narrower than a phone, so 52 / 40 / 30 px here). */
export function keypadFontSize(text) {
  const length = String(text || "").length;
  return length <= 7 ? 52 : (length <= 10 ? 40 : 30);
}

/** The typed amount as shown: thousands grouped the way this browser writes them, "0" while empty. */
export function keypadDisplayText(typed) {
  return typed ? groupedAmountText(String(typed), { commaDecimal: usesCommaDecimal() }) : "0";
}
