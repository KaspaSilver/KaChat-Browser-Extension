// Request Payment (iOS c6851d6 / 86dfd2d / 6dee531 / 338d9f5 / 3f5f79c, CreatePaymentRequestView):
// a payment request link - to a brand-new address or one of yours, an exact amount and what it's
// for. Copy (or share) it and send it anywhere; in KaChat it opens Send Kaspa filled in, and shows
// it was made by your chatting address (signed with its key, shared engine payment-request.js).
//
// A fresh address is shown before it's needed and reserved only when the request is copied or
// shared, so opening the screen and cancelling uses none up; copying and sharing again reuse it.

import { esc, toast, ICONS } from "./ui.js";
import { openPanel } from "./kachat-ui.js";
import * as wallet from "./wallet.js";
import * as vault from "./vault.js";
import { showSheet } from "./ui.js";
import { sompiFromUserText, sanitizeAmountInput } from "./amounts.js";
import { KAS_UNIT } from "./net.js";
import {
  PAYMENT_REQUEST_MEMO_LIMIT, makePaymentRequest, signPaymentRequest, paymentRequestUniversalLink, clampMemoText, memoCharacters,
} from "../shared/engine/payment-request.js";

const short = (a) => `${a.slice(0, 14)}...${a.slice(-6)}`;

export function showRequestPayment() {
  const state = {
    destination: "fresh", // "fresh" | "chosen"
    nextFresh: null,      // shown before it's reserved
    fresh: null,          // reserved once, then reused
    chosen: null,         // { address, label }
    chatting: null,
    amountText: "",
    memo: "",
    copied: false,
    working: false,
    error: "",
  };
  let handle = null;

  const address = () => (state.destination === "fresh" ? (state.fresh || state.nextFresh)?.address : state.chosen?.address) || null;
  const amountSompi = () => { const v = sompiFromUserText(state.amountText); return v != null && v > 0n ? v : null; };
  const canMake = () => amountSompi() != null && (state.destination === "fresh" || state.chosen);

  const destinationHtml = () => {
    if (state.destination === "fresh") {
      const a = (state.fresh || state.nextFresh)?.address;
      return a ? `<div class="sk-from-row"><span class="tx-meta"><span class="strong small">Fresh Address</span><span class="mono tiny muted">${esc(short(a))}</span></span></div>`
        : '<div class="center-text"><span class="spinner small-spin"></span></div>';
    }
    if (!state.chosen) return '<p class="muted small">Pick which of your addresses gets paid.</p>';
    return `
      <div class="sk-from-row"><span class="tx-meta"><span class="strong small">${esc(state.chosen.label)}</span><span class="mono tiny muted">${esc(short(state.chosen.address))}</span></span></div>
      <p class="muted tiny">${state.chosen.address === state.chatting
        ? "The payment lands in your chat with whoever pays, with the memo."
        : "The memo shows to whoever pays, but doesn't travel with the payment."}</p>`;
  };

  const paint = () => {
    if (!handle?.isOpen()) return;
    const host = handle.panel.querySelector("[data-req]");
    const focused = document.activeElement?.id;
    host.innerHTML = `
      <div class="sk-card sk-from">
        <div class="sel-pills">
          <button type="button" class="sel-pill ${state.destination === "fresh" ? "on" : ""}" id="req-fresh">Fresh Address</button>
          <button type="button" class="sel-pill ${state.destination === "chosen" ? "on" : ""}" id="req-choose">Choose an Address</button>
        </div>
        ${destinationHtml()}
      </div>
      <div class="sk-card">
        <div class="sk-label">Amount</div>
        <div class="sk-amount-row req-amount-row"><input id="req-amount" class="sk-amount-input" inputmode="decimal" placeholder="0" value="${esc(state.amountText)}" autocomplete="off" aria-label="Amount" /><span class="sk-unit">${esc(KAS_UNIT)}</span></div>
      </div>
      <div class="sk-card">
        <textarea id="req-memo" class="req-memo" rows="2" placeholder="What it's for (optional)">${esc(state.memo)}</textarea>
        <div class="muted tiny req-count">${memoCharacters(state.memo).length}/${PAYMENT_REQUEST_MEMO_LIMIT}</div>
      </div>
      ${state.error ? `<p class="error-text small center-text">${esc(state.error)}</p>` : ""}
      <button id="req-copy" class="big" ${canMake() && !state.working ? "" : "disabled"}>${state.working ? '<span class="spinner small-spin"></span>' : state.copied ? "Copied" : "Copy Payment Request"}</button>
      ${navigator.share ? `<button id="req-share" class="ghost with-icon" ${canMake() && !state.working ? "" : "disabled"}>${ICONS.share}<span>Share</span></button>` : ""}
      <p class="muted tiny center-text">Anyone who opens or pastes it in KaChat gets Send Kaspa with this filled in, and sees it was made by your chatting address (signed with its key).</p>`;
    const $h = (sel) => host.querySelector(sel);
    $h("#req-fresh").onclick = () => { state.destination = "fresh"; state.copied = false; paint(); };
    $h("#req-choose").onclick = chooseAddress;
    const amount = $h("#req-amount");
    amount.oninput = () => {
      const clean = sanitizeAmountInput(amount.value);
      if (clean !== amount.value) amount.value = clean;
      state.amountText = clean;
      state.copied = false;
      refreshButtons();
    };
    const memo = $h("#req-memo");
    memo.oninput = () => {
      const clamped = clampMemoText(memo.value);
      if (clamped !== memo.value) memo.value = clamped;
      state.memo = clamped;
      state.copied = false;
      $h(".req-count").textContent = `${memoCharacters(clamped).length}/${PAYMENT_REQUEST_MEMO_LIMIT}`;
      refreshButtons();
    };
    $h("#req-copy").onclick = copy;
    const share = $h("#req-share");
    if (share) share.onclick = shareLink;
    if (focused) host.querySelector(`#${focused}`)?.focus();
  };
  const refreshButtons = () => {
    const host = handle.panel.querySelector("[data-req]");
    const ready = canMake() && !state.working;
    const copyBtn = host.querySelector("#req-copy");
    if (copyBtn) { copyBtn.disabled = !ready; if (!state.working) copyBtn.textContent = state.copied ? "Copied" : "Copy Payment Request"; }
    const share = host.querySelector("#req-share");
    if (share) share.disabled = !ready;
  };

  /** Choose an Address: the chatting address, then the spending ones, each Used or Unused. */
  const chooseAddress = async () => {
    const sheet = showSheet({ title: "Choose an Address", headerHtml: '<div class="center-text"><span class="spinner small-spin"></span></div>', rows: [] });
    let list;
    try { list = await wallet.spendingList(); } catch { sheet.close(); return; }
    const entries = [{ label: "Chatting Address", address: state.chatting }, ...list.rows.filter((r) => !r.hidden || r.balanceSompi > 0n).sort((a, b) => a.index - b.index).map((r) => ({ label: r.label, address: r.address }))].filter((e) => e.address);
    const balances = await wallet.balancesFor(entries.map((e) => e.address)).catch(() => ({}));
    const rows = [];
    for (const e of entries) {
      const balance = BigInt(balances[e.address] ?? 0n);
      const known = balance > 0n ? true : await wallet.knownUsedState(e.address).catch(() => null);
      rows.push({
        label: e.label,
        subtitle: `${short(e.address)} · ${known == null ? "" : known ? "Used" : "Unused"}`.replace(/ · $/, ""),
        onClick: () => { state.destination = "chosen"; state.chosen = e; state.copied = false; paint(); },
      });
    }
    sheet.update({ headerHtml: "", rows });
  };

  /** The request to hand out, signed by your chatting address. A fresh address is reserved here,
   *  the first time it's needed. */
  const makeRequest = async () => {
    const sompi = amountSompi();
    if (sompi == null) return null;
    let to;
    if (state.destination === "fresh") {
      if (!state.fresh) {
        try { state.fresh = await wallet.reserveFreshSpendingAddress(); } catch { state.error = "Couldn't make a new address. Please try again."; return null; }
      }
      to = state.fresh.address;
    } else {
      if (!state.chosen) return null;
      to = state.chosen.address;
    }
    const unsigned = makePaymentRequest({ address: to, amountSompi: sompi, memo: state.memo, toChattingAddress: to === state.chatting });
    try {
      const key = await wallet.privateKeyHex({ kind: "main" });
      return signPaymentRequest(unsigned, state.chatting, key) || unsigned;
    } catch {
      return unsigned;
    }
  };

  const copy = async () => {
    state.working = true;
    state.error = "";
    refreshButtons();
    const request = await makeRequest();
    state.working = false;
    if (request) {
      try { await navigator.clipboard.writeText(paymentRequestUniversalLink(request)); state.copied = true; } catch { toast("Clipboard unavailable."); }
    }
    paint();
  };
  const shareLink = async () => {
    state.working = true;
    state.error = "";
    refreshButtons();
    const request = await makeRequest();
    state.working = false;
    paint();
    if (!request) return;
    try { await navigator.share({ url: paymentRequestUniversalLink(request) }); } catch { /* closed */ }
  };

  handle = openPanel({ title: "Request Payment", leading: "Cancel", full: true, body: '<div data-req class="req-form"></div>' });
  paint();
  (async () => {
    try {
      state.chatting = (await wallet.cachedAddresses((await vault.readAccounts()).activeAccountId))?.main || null;
      state.nextFresh = await wallet.nextFreshSpendingAddress();
    } catch { /* shown as loading */ }
    paint();
  })();
}
