// The pieces every Send Kaspa screen is built from, so they look and behave the same - a port of
// iOS Views/Shared/SendKaspaComponents.swift (4d0324f, afaad34): the recipient on top (paste, scan
// a QR, names resolve), then the big amount (KAS or your currency, Max), the balance pills, the
// fee card (network fee, speed, coin control) and a slide-to-send button. Used by Send Kaspa
// (send.js) and KasSigner's send (cold-send.js). Change these rather than one screen.

import { esc, ICONS } from "./ui.js";
import { KAS_UNIT } from "./net.js";

const SCAN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M7 12h10"/></svg>';
const SWAP = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v16M3 8l4-4 4 4M17 20V4M21 16l-4 4-4-4"/></svg>';
const MERGE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3v6a6 6 0 0 0 6 6M18 3v6a6 6 0 0 1-6 6v6M9 18l3 3 3-3"/></svg>';
const CHEVRONS = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l6 6-6 6M13 6l6 6-6 6"/></svg>';
const PERSON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8" r="4.2"/><path d="M3.5 21a8.5 8.5 0 0 1 17 0z"/></svg>';
export const CHEVRON_DOWN = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9l7 7 7-7"/></svg>';

/** "1.5", "0.0001": exact, trailing zeros dropped. */
export function trimmedKas(sompi) {
  const v = BigInt(sompi ?? 0n);
  const whole = v / 100_000_000n;
  const frac = v % 100_000_000n;
  return frac === 0n ? String(whole) : `${whole}.${String(frac).padStart(8, "0").replace(/0+$/, "")}`;
}

// --- Recipient (SendRecipientCard + AddressResolutionCard) ---------------------------------

/**
 * Who the Kaspa goes to: an address or a name, Paste and Scan QR beside the field, the address it
 * stands for, and a line saying what the input resolved to. The screen runs the lookup.
 *   lockedAddress: Compound UTXOs - the recipient is fixed
 *   status: { resolving, error, resolvedAddress, resolvedName, valid }
 *   extraHtml: below the status (the "Other domains" picker)
 */
export function recipientCardHtml({ input = "", lockedAddress = null, status = {}, extraHtml = "" }) {
  if (lockedAddress) {
    return `
      <div class="sk-card">
        <div class="sk-label">To</div>
        <div class="sk-locked">${MERGE}<span class="mono tiny ellipsis">${esc(lockedAddress)}</span></div>
        <div class="muted tiny">Consolidating This Address</div>
      </div>`;
  }
  const trimmed = input.trim();
  const shownAddress = status.resolvedAddress || (status.valid ? trimmed : null);
  let line = "";
  if (trimmed) {
    if (status.resolving) line = '<div class="sk-status muted"><span class="spinner small-spin"></span><span>Looking up domain...</span></div>';
    else if (status.error) line = `<div class="sk-status bad">${ICONS.xCircle}<span>${esc(status.error)}</span></div>`;
    else if (status.resolvedAddress) {
      line = `<div class="sk-status good">${ICONS.checkFill}<span>Resolved: ${esc(status.resolvedName || "")}</span></div>
        <div class="mono tiny muted ellipsis">${esc(status.resolvedAddress)}</div>`;
    } else {
      line = status.valid
        ? `<div class="sk-status good">${ICONS.checkFill}<span>Valid address</span></div>`
        : `<div class="sk-status bad">${ICONS.xCircle}<span>Invalid address format</span></div>`;
    }
  }
  return `
    <div class="sk-card">
      <div class="sk-label">To</div>
      <div class="sk-field-row">
        <input id="recipient" class="sk-recipient mono" value="${esc(input)}" placeholder="kaspa:qr... or domain" autocomplete="off" autocapitalize="off" spellcheck="false" />
        <button class="icon plain accent" id="paste" aria-label="Paste" title="Paste">${ICONS.clipboard}</button>
        <button class="icon plain accent" id="scan" aria-label="Scan QR" title="Scan QR">${SCAN}</button>
      </div>
      ${shownAddress ? `
        <div class="sk-resolution">
          <span class="sk-avatar">${PERSON}</span>
          <span class="tx-meta">
            <span class="small strong ${status.resolvedName ? "" : "muted"}">${esc(status.resolvedName || "No domain")}</span>
            <span class="mono tiny muted ellipsis">${esc(shownAddress)}</span>
          </span>
        </div>` : ""}
      ${line}
      ${extraHtml}
    </div>`;
}

// --- Amount (KaspaAmountEntry + KaspaFiatAmountState) --------------------------------------

/**
 * The amount as typed - in KAS, or in your currency (`fiat`) - and what it is in KAS. iOS
 * KaspaFiatAmountState: the screen keeps the KAS text; this owns the field's own text and unit.
 */
export function amountState() {
  return {
    fiat: false,
    display: "",
    /** The KAS amount as text after `display` changed; "" when it isn't a number yet. */
    kasFromDisplay(price) {
      const entered = Number(this.display);
      if (!this.display || !Number.isFinite(entered)) return null;
      if (!this.fiat) return entered;
      return price > 0 ? entered / price : null;
    },
    onInput(text, price) {
      this.display = text;
      if (!this.fiat) return text;
      const kas = this.kasFromDisplay(price);
      return kas == null ? "" : plainKas(kas);
    },
    /** Max (or a compound) sets the KAS amount; the field shows it in the unit on screen. */
    setKas(kasText, price) {
      const kas = Number(kasText);
      this.display = this.fiat && price > 0 && Number.isFinite(kas) ? (kas * price).toFixed(2) : String(kasText);
    },
    toggle(price) {
      if (!(price > 0)) return;
      const kas = this.kasFromDisplay(price);
      this.fiat = !this.fiat;
      this.display = kas == null ? "" : this.fiat ? (kas * price).toFixed(2) : plainKas(kas);
    },
    /** The other unit's value for the switch: "$12.34" / "123.4 TKAS"; null while empty.
     *  `formatFiat(kas)` formats a KAS amount in your currency. */
    conversion(price, formatFiat) {
      const kas = this.kasFromDisplay(price);
      if (kas == null) return null;
      if (this.fiat) return `${plainKas(kas)} ${KAS_UNIT}`;
      return price > 0 ? formatFiat(kas) : null;
    },
    reset() { this.fiat = false; this.display = ""; },
  };
}

function plainKas(kas) {
  return kas.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * The big centred amount and its unit, with the KAS / currency switch (showing the converted
 * value) and Max under it.
 *   { display, unit, conversion, currencyCode, canSwitch, maxEnabled, estimatingMax, readOnly }
 */
export function amountEntryHtml({ display = "", unit = KAS_UNIT, conversion = null, currencyCode = "", canSwitch = false, maxEnabled = true, estimatingMax = false, readOnly = false, fiat = false }) {
  const size = display.length <= 7 ? 46 : display.length <= 10 ? 36 : 28;
  return `
    <div class="sk-amount">
      <label class="sk-amount-row" style="--size:${size}px">
        <input id="amount" class="sk-amount-input" inputmode="decimal" placeholder="0" value="${esc(display)}" autocomplete="off" aria-label="Amount" ${readOnly ? "readonly" : ""} style="width:${Math.max(1, (display || "0").length) + 0.1}ch" />
        <span class="sk-amount-unit">${esc(unit)}</span>
      </label>
      <div class="sk-amount-actions">
        ${canSwitch ? `<button class="sk-chip" id="unit-switch" aria-label="Switch between Kaspa and your currency">${SWAP}<span>${esc(conversion || (fiat ? KAS_UNIT : currencyCode))}</span></button>` : ""}
        ${readOnly ? "" : `<button class="sk-chip accent strong" id="max" ${maxEnabled && !estimatingMax ? "" : "disabled"}>${estimatingMax ? '<span class="spinner small-spin"></span>' : "Max"}</button>`}
      </div>
    </div>`;
}

/** Grows the amount field with its text and re-sizes the font, without a repaint while typing. */
export function fitAmountInput(input) {
  const text = input.value || "0";
  input.style.width = `${Math.max(1, text.length) + 0.1}ch`;
  const size = text.length <= 7 ? 46 : text.length <= 10 ? 36 : 28;
  input.closest(".sk-amount-row")?.style.setProperty("--size", `${size}px`);
}

// --- Pills (SendInfoPill) ------------------------------------------------------------------

/** A small one-line pill; with `id` it is a button (the Send From picker). */
export function pillHtml(content, { id = null, disabled = false } = {}) {
  return id
    ? `<button class="sk-pill" id="${id}" ${disabled ? "disabled" : ""}>${content}</button>`
    : `<span class="sk-pill">${content}</span>`;
}

// --- Fee and coin control (SendFeeControls) ------------------------------------------------

export const FEE_TIERS = [
  { id: "normal", label: "Normal", multiplier: 1 },
  { id: "fast", label: "Fast", multiplier: 2 },
  { id: "priority", label: "Priority", multiplier: 5 },
];

/**
 * Network fee (tap to set a custom one), the fee speed, and coin control - one card.
 *   { tier, custom, editing, customText, estimating, feeText, showsCoinControl, coinSummary }
 */
export function feeControlsHtml({ tier = "normal", custom = false, editing = false, customText = "", estimating = false, feeText = null, showsCoinControl = true, coinSummary = "Automatic" }) {
  let fee;
  if (editing) {
    fee = `<span class="fee-edit"><input id="custom-fee" inputmode="decimal" value="${esc(customText)}" placeholder="0.00" /><button class="icon plain accent" id="fee-ok" aria-label="Use this fee">${ICONS.checkCircle}</button></span>`;
  } else if (estimating) {
    fee = '<span class="spinner small-spin"></span>';
  } else if (feeText) {
    fee = `<button class="link-button underline" id="fee">${esc(feeText)} ${ICONS.pencilSmall}</button>`;
  } else {
    fee = '<span class="muted">—</span>';
  }
  return `
    <div class="sk-card">
      <div class="sk-fee-row"><span>Network Fee</span>${fee}</div>
      <div class="segmented wide" role="radiogroup" aria-label="Fee">
        ${FEE_TIERS.map((t) => `<button type="button" role="radio" data-tier="${t.id}" aria-checked="${!custom && tier === t.id}">${t.label}</button>`).join("")}
      </div>
      <div class="muted tiny">If the network is busy, Fast or Priority pays a higher fee to help this confirm sooner. Tap the fee amount to set a custom fee.</div>
      ${showsCoinControl ? `
        <div class="sk-divider"></div>
        <button class="sk-coin-row" id="coins"><span>Coin Control</span><span class="muted">${esc(coinSummary)} ${ICONS.chevron}</span></button>` : ""}
    </div>`;
}

/** "Automatic" or "3 UTXOs selected". */
export function coinSummary(selected) {
  if (!selected) return "Automatic";
  return `${selected.size} UTXO${selected.size === 1 ? "" : "s"} selected`;
}

// --- Send button (SendActionButton) --------------------------------------------------------

/**
 * Slide the knob to the right end to send, so a payment can't go out on a stray click. Let go
 * early and it springs back. With `requiresSlide: false` it is an ordinary button in the same
 * look (KasSigner's Build Unsigned Transaction, which moves nothing by itself).
 */
export function slideButtonHtml({ title, busy = false, enabled = true, requiresSlide = true }) {
  const active = enabled && !busy;
  if (!requiresSlide) {
    return `<button class="sk-slide sk-tap ${enabled || busy ? "" : "off"}" id="slide" ${active ? "" : "disabled"}>${busy ? '<span class="spinner small-spin dark"></span>' : `<span class="sk-slide-label">${esc(title)}</span>`}</button>`;
  }
  return `
    <div class="sk-slide ${enabled || busy ? "" : "off"}" id="slide" role="button" tabindex="${active ? 0 : -1}" aria-label="${esc(title)}" aria-disabled="${!active}">
      <div class="sk-slide-fill"></div>
      <span class="sk-slide-label">${busy ? '<span class="spinner small-spin dark"></span>' : esc(title)}</span>
      ${busy ? "" : `<span class="sk-knob">${CHEVRONS}</span>`}
    </div>`;
}

/** Wires the slide (or tap) button: `onAction` runs once the knob reaches the end. Keyboard users
 *  press Enter or Space (the VoiceOver action on iOS). */
export function bindSlideButton(root, onAction) {
  const track = root.querySelector("#slide");
  if (!track || track.getAttribute("aria-disabled") === "true" || track.disabled) return;
  if (track.tagName === "BUTTON") { track.onclick = onAction; return; }
  const knob = track.querySelector(".sk-knob");
  const fill = track.querySelector(".sk-slide-fill");
  const label = track.querySelector(".sk-slide-label");
  if (!knob) return;
  let startX = null;
  let offset = 0;
  const maxOffset = () => Math.max(1, track.clientWidth - knob.offsetWidth - 8);
  const place = (x, animate = false) => {
    offset = Math.min(Math.max(0, x), maxOffset());
    const transition = animate ? "transform .3s cubic-bezier(.2,.9,.3,1.2), width .3s ease" : "none";
    knob.style.transition = transition;
    fill.style.transition = transition;
    knob.style.transform = `translateX(${offset}px)`;
    fill.style.width = `${knob.offsetWidth + 8 + offset}px`;
    label.style.opacity = String(1 - offset / maxOffset());
  };
  const reset = () => place(0, true);
  knob.addEventListener("pointerdown", (event) => {
    startX = event.clientX - offset;
    knob.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  knob.addEventListener("pointermove", (event) => { if (startX != null) place(event.clientX - startX); });
  const end = () => {
    if (startX == null) return;
    startX = null;
    if (offset >= maxOffset() * 0.95) {
      place(maxOffset());
      onAction();
      // A send that didn't start (a validation error) leaves the screen as it was: back it goes.
      setTimeout(() => { if (track.isConnected) reset(); }, 600);
    } else reset();
  };
  knob.addEventListener("pointerup", end);
  knob.addEventListener("pointercancel", end);
  track.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onAction(); }
  });
}
