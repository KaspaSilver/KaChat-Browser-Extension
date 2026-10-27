// Send Kaspa - iOS WithdrawKaspaView / SpendingAddressWithdrawView, built from the shared Send
// Kaspa pieces (send-pieces.js, iOS 4d0324f / afaad34 / e994235):
//   the recipient card (a kaspa: address, or a name on any service - .kachat, .kas, .k, .kaspa -
//     resolved as you type, with "Other domains"; Paste and Scan QR)
//   the big amount (KAS or your currency, Max), the Available pill - on a spending address it
//     opens Send From to pay from another one
//   the fee card (network fee - tap to set your own -, Normal / Fast / Priority, Coin Control)
//   Slide to Send. A sent transaction ends on the Sent sheet.
// The same screen is Compound UTXOs: the recipient locked to the address itself, amount Max.

import * as wallet from "./wallet.js";
import * as vault from "./vault.js";
import { app, esc, render, $, toast, copyText, settings, showSheet, ICONS, formatKas8 } from "./ui.js";
import { otherDomainsHtml, bindOtherDomains, splitTypedName } from "./names.js";
import { scanQr } from "./camera.js";
import { loadOwnAddresses } from "./own-addresses.js";
import { sompiFromUserText, sanitizeAmountInput, sompiToKasNumber } from "./amounts.js";
import { KAS_UNIT } from "./net.js";
import { parsePaymentRequestLink, paymentRequestAmountText } from "../shared/engine/payment-request.js";
import { entryFor, entryName } from "./address-book.js";
import {
  FEE_TIERS, recipientCardHtml, bindAddressBookButton, amountState, amountEntryHtml, fitAmountInput, pillHtml, feeControlsHtml,
  coinSummary, slideButtonHtml, bindSlideButton, trimmedKas, CHEVRON_DOWN,
} from "./send-pieces.js";

/**
 * @param {object} opts
 * @param {{kind:"main"}|{kind:"spending",index:number}} opts.source
 * @param {string} opts.fromAddress
 * @param {string} [opts.title]      a line under the bar (Donate says who it is for)
 * @param {string} [opts.navTitle]   the bar title: iOS "Send Kaspa" / "Send Kaspa from Address #n"
 * @param {string} [opts.feeFooter]  the Fee footer (iOS words it per screen)
 * @param {boolean} [opts.compound]
 * @param {string} [opts.recipient]  prefill (Donate)
 * @param {boolean} [opts.lockedSource] opened from one address's own page: that address only, no
 *                                    From choice (iOS 7a8102b)
 * @param {Function} opts.onClose    back / cancel / done
 * @param {Function} [opts.onSent]   after a successful send, before the Sent sheet closes
 */
export function showSend(opts) {
  const state = {
    recipientInput: opts.compound ? opts.fromAddress : (opts.recipient || ""),
    recipient: opts.compound ? { address: opts.fromAddress, domain: null } : null,
    recipientError: "",
    resolving: false,
    resolutions: [],        // every name service's answer for a typed name ("Other domains")
    othersOpen: false,
    amountText: "",
    maxMode: false,
    coins: null,            // all spendable coins at the source
    selected: null,         // Set of coin keys, or null for Automatic
    tier: "normal",
    base: null,             // { policyKas, sdkBaseKas } for the current amount/coins
    customFeeKas: null,     // number when the user typed their own
    editingFee: false,
    estimating: false,
    price: null,
    sending: false,
    error: "",
    currency: "usd",
    sourceLabel: null,
    request: null,          // a kachat.app/pay link pasted, scanned or typed (EXT-023)
  };
  const view = { screen: "form" };
  // The amount field (KAS or your currency) - iOS KaspaFiatAmountState.
  const amountField = amountState();
  amountField.display = state.amountText;

  // --- derived --------------------------------------------------------------------------
  const spendableSompi = () => {
    if (!state.coins) return null;
    const list = state.selected ? state.coins.filter((c) => state.selected.has(c.key)) : state.coins;
    return list.reduce((sum, c) => sum + c.amount, 0n);
  };
  const inputCount = () => (state.selected ? state.selected.size : (state.coins?.length || 1));
  const tierMultiplier = () => FEE_TIERS.find((t) => t.id === state.tier)?.multiplier || 1;
  const totalFeeKas = () => {
    if (state.customFeeKas != null) return state.customFeeKas;
    return state.base ? state.base.policyKas * tierMultiplier() : null;
  };
  const amountSompi = () => wallet.kasToSompi(state.amountText);
  const selectedOutpoints = () => (state.selected ? [...state.selected] : null);
  const canSend = () => {
    if (state.sending || !state.recipient || state.resolving) return false;
    const amount = amountSompi();
    const fee = totalFeeKas();
    const available = spendableSompi();
    if (amount == null || amount <= 0n || fee == null || available == null) return false;
    if (state.maxMode || opts.compound) return true;
    return amount + wallet.kasToSompi(fee.toFixed(8)) <= available;
  };

  // --- loading ----------------------------------------------------------------------------
  const load = async () => {
    wallet.utxoLabels(opts.fromAddress).then((labels) => { state.labels = labels; }).catch(() => {});
    try {
      state.coins = await wallet.utxos(opts.fromAddress);
    } catch (error) {
      state.error = `Couldn't load this address's coins: ${error.message}`;
    }
    const currency = (await settings()).currency || "usd";
    state.currency = currency;
    wallet.price(currency).then((p) => { state.price = p; paint(); }).catch(() => {});
    if (opts.source?.kind === "spending" && !state.sourceLabel) {
      vault.readAccounts()
        .then((view) => wallet.spendingState(view.activeAccountId))
        .then((st) => { state.sourceLabel = wallet.labelFor(st, opts.source.index); paint(); })
        .catch(() => {});
    }
    if (opts.compound) await fillMax(); else await estimate();
    paint();
  };

  let estimateTimer = null;
  const scheduleEstimate = () => {
    clearTimeout(estimateTimer);
    estimateTimer = setTimeout(() => estimate().then(paint), 400);
  };
  const estimate = async () => {
    if (state.maxMode || opts.compound) return;
    state.estimating = true;
    try {
      const available = spendableSompi();
      let amount = amountSompi();
      if (amount == null || amount <= 0n) amount = 20_000_000n;
      // Never estimate more than the balance: that throws "insufficient" instead of a fee.
      if (available != null && amount >= available) amount = available > 100_000n ? available - 100_000n : 1n;
      const result = await wallet.estimateFee({
        address: opts.fromAddress,
        amountKas: wallet.sompiToKasText(amount),
        selectedOutpoints: selectedOutpoints(),
      });
      if (result && result.policyKas > 0) state.base = result;
      else if (!state.base) state.base = { policyKas: 0.002, sdkBaseKas: 0.00002 };
    } catch {
      if (!state.base) state.base = { policyKas: 0.002, sdkBaseKas: 0.00002 };
    } finally {
      state.estimating = false;
    }
  };

  // Max: the fee for spending EVERY coin Max uses, at the live rate, then amount = spendable -
  // fee exactly, so the send is one output and nothing is left for a dust change output.
  const fillMax = async () => {
    const available = spendableSompi();
    if (available == null) return;
    state.estimating = true;
    paint();
    try {
      state.base = await wallet.maxFee(inputCount(), { sourceIndex: opts.source?.kind === "spending" ? opts.source.index : null });
    } catch {
      state.base = state.base || { policyKas: 0.002, sdkBaseKas: 0.00002 };
    }
    state.estimating = false;
    const fee = wallet.kasToSompi(totalFeeKas().toFixed(8));
    if (available <= fee) {
      state.error = "Balance too low after network fees.";
      setAmountKas("");
      state.maxMode = false;
      return;
    }
    setAmountKas(wallet.sompiToKasText(available - fee));
    state.maxMode = true;
    state.error = "";
  };

  // --- payment requests (EXT-023, iOS PaymentRequest.found(in:) -> apply, Desktop
  // applyPaymentRequestToSendKaspa): a kachat.app/pay link fills in the address and the exact
  // amount, with the request above the amount. A chat-payment request is sent as a plain transfer
  // here (the extension has no chats): its memo is shown to you only.
  /** `text` as a payment request link: applied, and true; else false. */
  const applyRequestLink = (text) => {
    const request = parsePaymentRequestLink(text);
    if (!request || opts.compound) return false;
    state.request = request;
    state.recipientInput = request.address;
    // the exact amount is what's sent: the field goes back to KAS for it
    amountField.fiat = false;
    setAmountKas(paymentRequestAmountText(request));
    state.maxMode = false;
    state.error = "";
    resolveRecipient();
    scheduleEstimate();
    return true;
  };
  const requestHtml = () => {
    const r = state.request;
    if (!r) return "";
    const saved = r.creator ? entryFor(r.creator) : null;
    const maker = r.creator
      ? `<div class="sk-status good">${ICONS.checkFill}<span>Requested by ${esc(saved ? entryName(saved) : `${r.creator.slice(0, 14)}...${r.creator.slice(-6)}`)}</span></div>
         ${r.creator.toLowerCase() !== r.address.toLowerCase() ? '<div class="muted tiny">Signed by their chatting address. The payment goes to the address above.</div>' : ""}`
      : `<div class="sk-status bad">${ICONS.warning || ICONS.xCircle}<span>Not signed: who made this request can't be confirmed.</span></div>`;
    return `
      <div class="sk-card pay-request">
        <div class="sk-label">Requested</div>
        <div class="strong">${esc(`${paymentRequestAmountText(r)} ${KAS_UNIT}`)}</div>
        ${r.memo ? `<div class="small">${esc(r.memo)}</div>` : ""}
        ${r.toChattingAddress ? '<div class="muted tiny">Sent as a plain payment: the memo is for you only.</div>' : ""}
        ${maker}
      </div>`;
  };

  let resolveSeq = 0;
  const resolveRecipient = async () => {
    const seq = ++resolveSeq;
    const input = state.recipientInput.trim();
    state.recipient = null;
    state.recipientError = "";
    state.resolutions = [];
    state.othersOpen = false;
    if (!input) { paint(); return; }
    state.resolving = true;
    paint();
    try {
      const resolved = await wallet.resolveRecipient(input);
      if (seq !== resolveSeq) return;
      state.recipient = resolved;
      state.resolutions = resolved.resolutions || [];
    } catch (error) {
      if (seq !== resolveSeq) return;
      state.recipientError = error.message;
      state.resolutions = error.resolutions || [];
      // Nothing for the ending typed, but another service has the name: show it straight away.
      state.othersOpen = state.resolutions.some((r) => r.address);
    } finally {
      if (seq === resolveSeq) { state.resolving = false; paint(); }
    }
  };

  // --- sending ---------------------------------------------------------------------------
  const doSend = async () => {
    if (!canSend()) return;
    state.sending = true;
    state.error = "";
    paint();
    const fee = totalFeeKas();
    try {
      let result;
      if (opts.compound) {
        result = await wallet.compound(opts.source, fee.toFixed(8));
      } else if (state.maxMode) {
        result = await wallet.send({
          source: opts.source, destination: state.recipient.address, max: true,
          totalFeeKas: fee.toFixed(8), selectedOutpoints: selectedOutpoints(), maxAmountSompi: amountSompi(),
        });
      } else {
        const tip = Math.max(0, fee - (state.base?.sdkBaseKas || 0));
        result = await wallet.send({
          source: opts.source, destination: state.recipient.address,
          amountKas: state.amountText, tipKas: tip.toFixed(8), selectedOutpoints: selectedOutpoints(),
        });
      }
      const txid = (result?.txids || [])[result?.txids?.length - 1] || "";
      opts.onSent?.();
      showSent({
        amountSompi: result?.amountSompi ?? result?.result?.summary?.amountSompi ?? amountSompi(),
        feeKas: fee,
        to: state.recipient,
        txid,
        compound: Boolean(opts.compound),
        onDone: opts.onClose,
      });
    } catch (error) {
      state.sending = false;
      // the password prompt was cancelled: nothing was sent, the screen stays as it was
      if (error?.code === wallet.SEND_CANCELLED) { paint(); return; }
      console.warn("[KaPay] send failed:", error);
      state.error = friendlySendError(error);
      paint();
    }
  };

  // --- rendering (iOS SendKaspaComponents) ----------------------------------------------
  const fiatText = (kas) => (state.price?.price ? wallet.formatFiat(wallet.kasToSompi(kas.toFixed(8)), state.price) : "");
  const feeText = () => {
    const fee = totalFeeKas();
    return fee == null ? null : `${fee.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")} ${KAS_UNIT}`;
  };
  const recipientStatus = () => ({
    resolving: state.resolving,
    error: state.recipientError,
    resolvedAddress: state.recipient?.domain ? state.recipient.address : null,
    resolvedName: state.recipient?.domain || null,
    valid: Boolean(state.recipient && !state.recipient.domain),
  });

  const paint = () => {
    if (view.screen !== "form") return;
    const focusedId = document.activeElement?.id;
    const caret = document.activeElement?.selectionStart;
    const available = spendableSompi();
    const price = state.price?.price || 0;
    // From (iOS 6333dd3 SendFromSection): which of your addresses pays - the chatting address by
    // default, or any one picked; the chosen address and what it holds.
    const isChatting = opts.source?.kind !== "spending";
    const fromTitle = isChatting ? "Chatting Address" : (state.sourceLabel || `Address #${opts.source.index}`);
    const fromHtml = opts.compound ? "" : `
      <div class="sk-card sk-from">
        <div class="sk-label">From</div>
        ${opts.lockedSource ? "" : `<div class="sel-pills">
          <button type="button" class="sel-pill ${isChatting ? "on" : ""}" id="from-chatting">Chatting Address</button>
          <button type="button" class="sel-pill ${isChatting ? "" : "on"}" id="from-choose">Choose an Address</button>
        </div>`}
        <div class="sk-from-row">
          <span class="tx-meta"><span class="strong small">${esc(fromTitle)}</span><span class="mono tiny muted">${esc(`${opts.fromAddress.slice(0, 14)}...${opts.fromAddress.slice(-6)}`)}</span></span>
          ${available != null ? `<span class="small">${esc(wallet.formatKas(available, 8))} ${KAS_UNIT}</span>` : '<span class="spinner small-spin"></span>'}
        </div>
      </div>`;
    const pill = "";
    render(`
      <header class="navbar form-bar">
        <button class="bar-text" id="cancel">Cancel</button>
        <div class="nav-title ellipsis">${esc(opts.compound ? "Compound UTXOs" : opts.navTitle || "Send Kaspa")}</div>
        <span class="bar-text bar-spacer" aria-hidden="true">Cancel</span>
      </header>
      <section class="form sk-form">
        ${opts.title ? `<p class="muted small center-text">${esc(opts.title)}</p>` : ""}
        ${fromHtml}
        ${recipientCardHtml({
          input: state.recipientInput,
          lockedAddress: opts.compound ? opts.fromAddress : null,
          status: recipientStatus(),
          extraHtml: state.resolutions.length
            ? otherDomainsHtml({ resolutions: state.resolutions, selectedTld: state.recipient?.tld || splitTypedName(state.recipientInput).tld, open: state.othersOpen })
            : "",
        })}
        ${requestHtml()}
        ${amountEntryHtml({
          display: amountField.display,
          unit: amountField.fiat ? state.currency.toUpperCase() : KAS_UNIT,
          fiat: amountField.fiat,
          conversion: amountField.conversion(price, fiatText),
          currencyCode: state.currency.toUpperCase(),
          canSwitch: price > 0 && !opts.compound,
          maxEnabled: Boolean(state.recipient),
          estimatingMax: state.estimating && state.maxMode,
          readOnly: Boolean(opts.compound),
        })}
        <div class="sk-pills">${pill}</div>
        ${feeControlsHtml({
          tier: state.tier,
          custom: state.customFeeKas != null,
          editing: state.editingFee,
          customText: totalFeeKas() != null ? totalFeeKas().toFixed(8).replace(/0+$/, "").replace(/\.$/, "") : "",
          estimating: state.estimating,
          feeText: feeText(),
          showsCoinControl: !opts.compound,
          coinSummary: coinSummary(state.selected),
        })}
        ${state.error ? `<p class="error-text small center-text">${esc(state.error)}</p>` : ""}
        ${slideButtonHtml({ title: opts.compound ? "Slide to Consolidate" : "Slide to Send", busy: state.sending, enabled: canSend() })}
      </section>`, "send");

    $("#cancel").onclick = opts.onClose;
    bindSlideButton(app, doSend);
    const recipient = $("#recipient");
    if (recipient) {
      recipient.oninput = () => {
        if (applyRequestLink(recipient.value)) return;
        state.recipientInput = recipient.value;
        // another recipient typed over a request's address: the request no longer applies
        if (state.request && recipient.value.trim().toLowerCase() !== state.request.address) { state.request = null; paint(); }
        clearTimeout(recipientTimer);
        recipientTimer = setTimeout(resolveRecipient, 350);
      };
    }
    bindOtherDomains(app, {
      onToggle: () => { state.othersOpen = !state.othersOpen; paint(); },
      onPick: (tld) => {
        const pick = state.resolutions.find((r) => r.tld === tld && r.address);
        if (!pick) return;
        state.recipient = { address: pick.address, domain: pick.display, tld: pick.tld, resolutions: state.resolutions };
        state.recipientError = "";
        state.othersOpen = false;
        paint();
      },
    });
    bindAddressBookButton(app, (address) => { state.recipientInput = address; resolveRecipient(); });
    const paste = $("#paste");
    if (paste) paste.onclick = async () => {
      try {
        const text = (await navigator.clipboard.readText()).trim();
        if (applyRequestLink(text)) return;
        state.request = null;
        state.recipientInput = text;
        resolveRecipient();
      } catch {
        toast("Clipboard unavailable - paste with ⌘V instead.");
      }
    };
    const scan = $("#scan");
    if (scan) scan.onclick = async () => {
      const code = await scanQr({ title: "Scan QR Code", hint: "Point camera at a Kaspa address QR code" });
      if (!code) return;
      // a KaChat payment request first; else a payment URI's address, without its ?amount=... query
      if (applyRequestLink(String(code))) return;
      state.request = null;
      state.recipientInput = String(code).trim().split("?")[0];
      resolveRecipient();
    };
    const amountInput = $("#amount");
    amountInput.oninput = () => {
      const cleaned = sanitizeAmountInput(amountInput.value);
      if (cleaned !== amountInput.value) amountInput.value = cleaned;
      fitAmountInput(amountInput);
      state.amountText = amountField.onInput(cleaned, price);
      state.maxMode = false;
      state.error = "";
      const chip = $("#unit-switch span");
      if (chip) chip.textContent = amountField.conversion(price, fiatText) || (amountField.fiat ? KAS_UNIT : state.currency.toUpperCase());
      scheduleEstimate();
      refreshSendEnabled();
    };
    const unitSwitch = $("#unit-switch");
    if (unitSwitch) unitSwitch.onclick = () => { amountField.toggle(price); paint(); };
    const max = $("#max");
    if (max) max.onclick = async () => { await fillMax(); paint(); };
    const fromChatting = $("#from-chatting");
    if (fromChatting) fromChatting.onclick = () => switchToChatting();
    const fromChoose = $("#from-choose");
    if (fromChoose) fromChoose.onclick = showSendFrom;
    const coins = $("#coins");
    if (coins) coins.onclick = () => {
      view.screen = "coins";
      showCoinControl({
        coins: state.coins || [],
        selected: state.selected,
        labels: state.labels,
        onCancel: () => { view.screen = "form"; paint(); },
        onDone: (selection) => {
          state.selected = selection;
          state.maxMode = false;
          view.screen = "form";
          estimate().then(paint);
          paint();
        },
      });
    };
    for (const button of app.querySelectorAll("[data-tier]")) {
      button.onclick = async () => {
        state.tier = button.dataset.tier;
        state.customFeeKas = null;
        state.editingFee = false;
        if (state.maxMode) await fillMax();
        paint();
      };
    }
    const feeButton = $("#fee");
    if (feeButton) feeButton.onclick = () => { state.editingFee = true; paint(); $("#custom-fee")?.select(); };
    const feeOk = $("#fee-ok");
    if (feeOk) {
      const commit = async () => {
        const sompi = sompiFromUserText($("#custom-fee").value);
        const value = sompi == null ? NaN : sompiToKasNumber(sompi);
        state.editingFee = false;
        if (Number.isFinite(value) && value > 0) {
          state.customFeeKas = value;
          if (state.maxMode) {
            const avail = spendableSompi();
            const feeSompi = wallet.kasToSompi(value.toFixed(8));
            if (avail > feeSompi) setAmountKas(wallet.sompiToKasText(avail - feeSompi));
          }
        }
        paint();
      };
      feeOk.onclick = commit;
      $("#custom-fee").onkeydown = (event) => { if (event.key === "Enter") commit(); };
    }
    // Typing must not lose the caret when a repaint lands mid-word.
    if (focusedId) {
      const again = document.getElementById(focusedId);
      if (again && again !== document.activeElement) {
        again.focus();
        if (caret != null && typeof again.setSelectionRange === "function") {
          try { again.setSelectionRange(caret, caret); } catch { /* not a text field */ }
        }
      }
    }
  };
  let recipientTimer = null;

  // Enables/disables the slide button without a full repaint while typing the amount.
  const refreshSendEnabled = () => {
    const track = $("#slide");
    if (!track || state.sending) return;
    const enabled = canSend();
    if (enabled === !track.classList.contains("off")) return;
    const holder = document.createElement("div");
    holder.innerHTML = slideButtonHtml({ title: opts.compound ? "Slide to Consolidate" : "Slide to Send", enabled });
    track.replaceWith(holder.firstElementChild);
    bindSlideButton(app, doSend);
  };

  // Choose an Address (iOS 6333dd3 OwnAddressPicker): the chatting address, then the spending
  // addresses (the visible ones plus hidden ones holding Kaspa) in number order, each with its
  // balance and whether it was ever used.
  const showSendFrom = async () => {
    const sheet = showSheet({ title: "Send From", headerHtml: '<div class="center-text"><span class="spinner small-spin"></span></div>', rows: [] });
    let list;
    let chatting = null;
    try {
      list = await wallet.spendingList();
      const view = await vault.readAccounts();
      chatting = (await wallet.cachedAddresses(view.activeAccountId))?.main || null;
    } catch { sheet.close(); return; }
    const balances = await wallet.balancesFor([chatting, ...list.rows.map((r) => r.address)].filter(Boolean)).catch(() => ({}));
    const usedText = async (address, balance) => {
      if (balance > 0n) return "Used";
      const known = await wallet.knownUsedState(address).catch(() => null);
      return known == null ? "" : known ? "Used" : "Unused";
    };
    const spending = list.rows.filter((r) => !r.hidden || r.balanceSompi > 0n).sort((a, b) => a.index - b.index);
    const current = opts.source?.kind === "spending" ? opts.source.index : null;
    const row = async (label, address, balance, onClick, picked) => {
      const used = await usedText(address, balance);
      return {
        label: `${label}${picked ? " ✓" : ""}`,
        subtitle: `${address.slice(0, 14)}...${address.slice(-6)} · ${wallet.formatKas(balance, 8)} ${KAS_UNIT}${used ? ` · ${used}` : ""}`,
        onClick,
      };
    };
    const rows = [];
    if (chatting) rows.push(await row("Chatting Address", chatting, BigInt(balances[chatting] ?? 0n), () => switchToChatting(chatting), current == null));
    for (const r of spending) rows.push(await row(r.label, r.address, r.balanceSompi, () => switchSource(r), current === r.index));
    sheet.update({ headerHtml: "", rows });
  };
  /** Fee estimate, Max and coin control follow the new address (coin control resets). */
  const resetForSource = () => {
    state.coins = null;
    state.selected = null;
    state.customFeeKas = null;
    state.maxMode = false;
    state.base = null;
    state.error = "";
    paint();
    load();
  };
  const switchSource = (row) => {
    if (opts.source?.kind === "spending" && row.index === opts.source.index) return;
    opts.source = { kind: "spending", index: row.index };
    opts.fromAddress = row.address;
    state.sourceLabel = row.label;
    resetForSource();
  };
  const switchToChatting = async (known = null) => {
    if (opts.source?.kind !== "spending") return;
    let address = known;
    if (!address) {
      try { address = (await wallet.cachedAddresses((await vault.readAccounts()).activeAccountId))?.main || null; } catch { address = null; }
    }
    if (!address) return;
    opts.source = { kind: "main" };
    opts.fromAddress = address;
    state.sourceLabel = null;
    resetForSource();
  };

  const setAmountKas = (kasText) => {
    state.amountText = kasText;
    amountField.setKas(kasText, state.price?.price || 0);
  };

  paint();
  load();
  // the recipient card marks one of your own addresses (iOS 56f004f)
  loadOwnAddresses().then((changed) => { if (changed) paint(); });
  if (state.recipientInput && !opts.compound && !applyRequestLink(state.recipientInput)) resolveRecipient();
}

function friendlySendError(error) {
  const message = String(error?.message || error || "");
  if (/storage mass/i.test(message)) return "This amount can't be sent from these coins without leaving a tiny change output the network rejects. Try a slightly different amount, or Compound UTXOs first.";
  if (/insufficient/i.test(message)) return "Not enough Kaspa for this amount plus the network fee.";
  if (/not connected|timed out|timeout/i.test(message)) return "Couldn't reach the Kaspa network. Try again in a moment.";
  return message || "Send failed.";
}

// --- Coin Control: iOS CoinControlView --------------------------------------------------------

export function showCoinControl({ coins, selected, labels = {}, onCancel, onDone }) {
  const picked = new Set(selected || []);
  let menuOpen = false;
  const paint = () => {
    const total = coins.filter((c) => picked.has(c.key)).reduce((sum, c) => sum + c.amount, 0n);
    render(`
      <header class="navbar form-bar">
        <button class="bar-text" id="cancel">Cancel</button>
        <div class="nav-title">Coin Control</div>
        <button class="icon plain nav-menu accent" id="menu" aria-label="More">${ICONS.ellipsis}</button>
      </header>
      ${menuOpen ? `
        <div class="menu-sheet" role="menu">
          <button class="menu-item" id="select-all"><span>Select All</span></button>
          <button class="menu-item" id="clear"><span>Automatic (Clear Selection)</span></button>
        </div>` : ""}
      <section class="form">
        <div class="form-section">
          <div class="form-card">
            ${coins.length ? coins.map((coin) => `
              <button class="form-row coin" data-key="${esc(coin.key)}" role="checkbox" aria-checked="${picked.has(coin.key)}">
                <span class="${picked.has(coin.key) ? "accent" : "muted"}">${picked.has(coin.key) ? ICONS.circleCheck : ICONS.circle}</span>
                <span class="coin-meta">
                  ${labels[coin.key] ? `<span class="accent tiny strong">${esc(labels[coin.key])}</span>` : ""}
                  <span class="coin-amount">${esc(formatKas8(coin.amount))} KAS</span>
                  <span class="mono tiny muted">${esc(coin.transactionId.slice(0, 10))}...:${coin.index}</span>
                </span>
              </button>`).join("") : '<div class="form-row muted">No UTXOs found at this address.</div>'}
          </div>
          ${picked.size ? `<div class="form-footer">Selected: ${esc(formatKas8(total))} KAS (${picked.size} UTXO${picked.size === 1 ? "" : "s"})</div>` : ""}
        </div>
      </section>
      <div class="ios-bottom-bar"><button class="ios-capsule" id="confirm">${picked.size ? "Confirm Selection" : "Use Automatic Selection"}</button></div>`, "coins");
    $("#cancel").onclick = onCancel;
    $("#menu").onclick = () => { menuOpen = !menuOpen; paint(); };
    const selectAll = $("#select-all");
    if (selectAll) selectAll.onclick = () => { for (const c of coins) picked.add(c.key); menuOpen = false; paint(); };
    const clear = $("#clear");
    if (clear) clear.onclick = () => { picked.clear(); menuOpen = false; paint(); };
    $("#confirm").onclick = () => onDone(picked.size ? new Set(picked) : null);
    for (const row of app.querySelectorAll(".coin")) {
      row.onclick = () => {
        const key = row.dataset.key;
        if (picked.has(key)) picked.delete(key); else picked.add(key);
        paint();
      };
    }
  };
  paint();
}

// --- Sent: iOS SentConfirmationSheet -----------------------------------------------------------

// Sent, the amount, "to <recipient>" (not for a compound), the transaction as an explorer link,
// "Tap the transaction to open it in the explorer.", Done.
function showSent({ amountSompi, to, txid, compound, onDone }) {
  render(`
    <section class="screen sent">
      <div class="sent-check" style="color:#30d158">${ICONS.checkBig}</div>
      <h2>Sent</h2>
      <div class="sent-amount">${esc(wallet.sompiToKasText(amountSompi ?? 0n))} KAS</div>
      ${compound ? "" : `<div class="muted small center-text break">to ${esc(to?.domain || to?.address || "")}</div>`}
      ${txid ? `<a class="link-button center mono tiny break sent-tx" href="${esc(wallet.explorerTxUrl(txid))}" target="_blank" rel="noopener noreferrer">${esc(txid)} ${ICONS.upRightSquare}</a>
      <p class="muted tiny center-text">Tap the transaction to open it in the explorer.</p>` : ""}
      <div class="spacer"></div>
      <button id="done" class="big">Done</button>
    </section>`, "sent");
  $("#done").onclick = onDone;
}
