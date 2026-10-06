// The one exact amount parser (iOS KaspaUnit.sompi(fromUserText:), 16b64bc / IOS-010) lives in
// the shared engine (KaChat-Desktop engine/amounts.js); every amount and fee field reads through
// it: comma or dot, Arabic and Persian digits, at most 8 decimals, integer math, nothing above
// the supply.
export { MAX_TYPED_SOMPI, sompiFromUserText, sanitizeAmountInput } from "../shared/engine/amounts.js";

/** Sompi as a KAS number, for display math only (never for amounts that get sent). */
export const sompiToKasNumber = (sompi) => Number(sompi) / 1e8;
