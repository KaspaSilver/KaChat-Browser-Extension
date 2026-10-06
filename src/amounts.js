// Amounts typed by a person - iOS KaspaUnit.sompi(fromUserText:) / sanitizeAmountInput (16b64bc,
// audit IOS-010). One exact parser for every KAS amount and fee field: "1.5", "1,5" (comma-decimal
// keyboards), ".5", Arabic-Indic and Persian digits, at most 8 decimals, no grouping, signs or
// exponents. Integer math only (no floats), and null above a little more than Kaspa's supply, so
// no input can be rounded or blow up.

/** Most sompi any typed amount can mean: a little above Kaspa's 28.7 billion KAS supply. */
export const MAX_TYPED_SOMPI = 29_000_000_000n * 100_000_000n;

/** Arabic-Indic and Persian digits as ASCII digits; "," and the Arabic decimal sign as ".". */
function asciiAmountCharacter(c) {
  if (c === "," || c === "٫") return ".";
  const v = c.codePointAt(0);
  if (v >= 0x0660 && v <= 0x0669) return String.fromCharCode(v - 0x0660 + 0x30);
  if (v >= 0x06F0 && v <= 0x06F9) return String.fromCharCode(v - 0x06F0 + 0x30);
  return c;
}

/** A typed KAS amount in sompi (BigInt), or null when it isn't one. 0 is a valid result. */
export function sompiFromUserText(text) {
  const t = [...String(text ?? "").trim()].map(asciiAmountCharacter).join("");
  const dot = t.indexOf(".");
  const whole = dot < 0 ? t : t.slice(0, dot);
  const frac = dot < 0 ? "" : t.slice(dot + 1);
  if (!whole && !frac) return null;
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac) || frac.length > 8) return null;
  const wholeDigits = whole.replace(/^0+/, "");
  // 29e9 KAS has 11 digits; anything longer is over the cap anyway.
  if (wholeDigits.length > 11) return null;
  const total = BigInt(wholeDigits || "0") * 100_000_000n + BigInt((frac + "00000000").slice(0, 8));
  return total <= MAX_TYPED_SOMPI ? total : null;
}

/** Cleans an amount field as it's typed: digits and one decimal point ("," becomes "."), at most
 *  8 decimals. */
export function sanitizeAmountInput(value) {
  let result = "";
  let dotSeen = false;
  let decimals = 0;
  for (const raw of String(value ?? "")) {
    const ch = asciiAmountCharacter(raw);
    if (ch === ".") {
      if (dotSeen) continue;
      dotSeen = true;
      result += ch;
    } else if (ch >= "0" && ch <= "9") {
      if (dotSeen) {
        if (decimals === 8) continue;
        decimals += 1;
      }
      result += ch;
    }
  }
  return result;
}

/** sompi as a KAS number, for the fee math that works in KAS. */
export const sompiToKasNumber = (sompi) => Number(sompi) / 1e8;
