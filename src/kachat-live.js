// The live .kachat screens, TESTNET ONLY (testnet-10 and a verified registry manifest) - a port of
// iOS KachatNamesLiveViews.swift: the hub's search, registrations in flight, Marketplace / My
// Names / Activity, the name detail with its actions, every transaction sheet and Your Domains >
// .kachat. On mainnet none of this is reached: market.js keeps its "Coming soon" mockups.
//
// Every spending or destructive action shows its cost first (built against live UTXOs, nothing
// sent), asks to confirm - twice for the destructive ones - then asks for the wallet password
// (the browser's stand-in for iOS's device lock, DeviceAuth) before anything is signed.
//
// Left out on purpose: iOS's Message button on a name's owner (the wallet has no chats).

import { app, esc, render, $, toast, ICONS, navHeader, unitText, showSheet } from "./ui.js";
import { KAS_UNIT } from "./net.js";
import * as vault from "./vault.js";
import * as wallet from "./wallet.js";
import { kachatNames, kachatRegistry } from "./kachat-names.js";
import { SYMBOLS, openPanel } from "./kachat-ui.js";
import { Operation, Stage, isOpen, needsDriving, KachatNamesActions } from "../shared/engine/kachat-names/actions.js";
import { KachatNamesRegistry } from "../shared/engine/kachat-names/registry.js";
import { Status, Profile, SocialKind, SocialPlatform, SocialSource } from "../shared/engine/kachat-names/registry-state.js";
import { normalize, unhex32, p2pkScript, bytesEqual, yearMs } from "../shared/engine/kachat-names/codec.js";
import { paramsPrice, paramsRenewPrice } from "../shared/engine/kachat-names/manifest.js";

// --- Amounts (iOS KaspaUnit.amount / signed / parseSompi) ----------------------------------

const SOMPI = 100_000_000n;

/** "35", "0.2", "1.99831": exact, trailing zeros dropped. */
function plain(sompi) {
  const v = BigInt(sompi ?? 0n);
  const whole = v / SOMPI;
  const frac = v % SOMPI;
  if (frac === 0n) return String(whole);
  return `${whole}.${String(frac).padStart(8, "0").replace(/0+$/, "")}`;
}

/** "35 TKAS". */
export function amount(sompi) { return `${plain(sompi)} ${KAS_UNIT}`; }

/** "+1.99 TKAS" / "-36.002 TKAS". */
function signed(delta) {
  const v = BigInt(delta);
  return v >= 0n ? `+${amount(v)}` : `-${amount(-v)}`;
}

/** "12.5" or "12,5" -> sompi; null for anything else or more than 8 decimals. */
function parseSompi(text) {
  const t = String(text ?? "").trim().replace(",", ".");
  if (!t) return null;
  const parts = t.split(".");
  if (parts.length > 2 || !/^\d*$/.test(parts[0])) return null;
  const whole = BigInt(parts[0] || "0");
  let frac = 0n;
  if (parts.length === 2) {
    if (parts[1].length > 8 || !/^\d*$/.test(parts[1])) return null;
    frac = BigInt(parts[1].padEnd(8, "0") || "0");
  }
  return whole * SOMPI + frac;
}

const positive = (v) => (v != null && v > 0n ? v : null);

// --- Shared pieces (iOS KachatLive) --------------------------------------------------------

/** What the password prompt says before any .kachat transaction is signed. */
const AUTH_REASON = "Confirm this .kachat transaction";
/** testnet-10 runs at 10 blocks per second */
const DAA_PER_SECOND = 10n;

const dateOf = (ms) => new Date(Number(ms));
const day = (ms) => dateOf(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/** "2 hours ago", "yesterday" (iOS .relative(presentation: .named)). */
function relative(ms) {
  const seconds = (Number(ms) - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units = [["year", 31_536_000], ["month", 2_592_000], ["week", 604_800], ["day", 86_400], ["hour", 3_600], ["minute", 60]];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(Math.round(seconds), "second");
}

const registry = () => kachatRegistry();
const graceMs = () => registry()?.graceMs ?? 0n;
const statusOf = (info) => info.status(graceMs());
const shortAddress = (a) => KachatNamesRegistry.shortAddress(a);
const addressOf = (key) => KachatNamesRegistry.addressOf(key);

/** An event party: an address (indexer) or an x-only key in hex (walker), as a short address. */
function party(s) {
  if (!s) return null;
  if (s.startsWith("kaspa")) return shortAddress(s);
  try {
    const a = addressOf(unhex32(s));
    if (a) return shortAddress(a);
  } catch { /* not a key */ }
  return s;
}

let myKey = null; // the bound signer's x-only key, set when the runtime is fetched
const isMine = (key) => Boolean(myKey && key && bytesEqual(myKey, key));

const EVENT_ICONS = {
  register: SYMBOLS.atPlus, transfer: SYMBOLS.arrows, list: SYMBOLS.tag, delist: SYMBOLS.tagSlash,
  sale: SYMBOLS.cart, offer_accepted: SYMBOLS.cart, renew: SYMBOLS.renew, release: SYMBOLS.release, reclaim: SYMBOLS.reclaim,
};
const EVENT_TITLES = {
  register: "Registered", transfer: "Transferred", list: "Listed", delist: "Delisted", sale: "Sold",
  offer_accepted: "Offer accepted", offer_accept: "Offer accepted", renew: "Renewed", release: "Released",
  reclaim: "Reclaimed", offer: "Offer made", offer_withdraw: "Offer withdrawn", offer_refund: "Offer refunded",
};

/** Why a typed name is not a name. */
function invalidReason(name) {
  const bytes = new TextEncoder().encode(name);
  if (!bytes.length || bytes.length > 32) return "A name is 1 to 32 characters.";
  if (!/^[a-z0-9-]+$/.test(name)) return "Use a-z, 0-9 and hyphens only.";
  if (name.startsWith("-") || name.endsWith("-")) return "A name can't start or end with a hyphen.";
  return null;
}

const errorText = (error) => String(error?.message || error || "Something went wrong.");

function statusPill(status) {
  const title = status === Status.active ? "Active" : status === Status.grace ? "Expired" : "Lapsed";
  return `<span class="kl-pill kl-${status}">${title}</span>`;
}

export const testnetBadge = () => '<span class="kl-testnet">Testnet</span>';

const sectionHeader = (title, detail = null) => `
  <div class="km-header"><div class="km-title">${esc(title)}</div>${detail ? `<div class="muted tiny">${esc(detail)}</div>` : ""}</div>`;

/** iOS KachatLiveEmpty: the text, or a spinner while loading (text null). */
const emptyCard = (text) => `<div class="km-card km-empty-card ${text ? "muted small" : ""}">${text ? esc(text) : '<span class="spinner"></span>'}</div>`;

/** One name in a list: the name, a line about it, and its price or status (iOS KachatLiveNameRow). */
function nameRowHtml(info, { showPrice = true, attr = "" } = {}) {
  const status = statusOf(info);
  const owner = isMine(info.owner) ? "Yours" : (addressOf(info.owner) ? shortAddress(addressOf(info.owner)) : "");
  const trailing = showPrice && info.isListed && status === Status.active
    ? `<span class="strong small">${esc(amount(info.price))}</span>`
    : status !== Status.active ? statusPill(status) : "";
  return `
    <button class="km-row" data-name="${esc(info.name)}" ${attr}>
      <span class="kl-at">${SYMBOLS.at}</span>
      <span class="tx-meta"><span class="strong small ellipsis">${esc(info.display)}</span><span class="muted tiny ellipsis">${esc(owner)} · until ${esc(day(info.expiresAt))}</span></span>
      ${trailing}
      <span class="km-chevron">${ICONS.chevron}</span>
    </button>`;
}

/** iOS KachatEventRow. */
function eventRowHtml(event, showName = false) {
  const to = event.op !== "offer" ? party(event.to) : null;
  const trailing = event.price != null
    ? `<span class="small">${esc(amount(event.price))}</span>`
    : event.years != null ? `<span class="muted small">+${esc(String(event.years))}</span>` : "";
  return `
    <div class="km-row">
      <span class="accent km-icon">${EVENT_ICONS[event.op] || SYMBOLS.hand}</span>
      <span class="tx-meta">
        <span class="strong small ellipsis">${esc(EVENT_TITLES[event.op] || "Activity")}${showName && event.name ? ` ${esc(event.name)}.kachat` : ""}</span>
        <span class="muted tiny ellipsis">${to ? `→ ${esc(to)} ` : ""}${event.at != null ? esc(relative(event.at)) : ""}</span>
      </span>
      ${trailing}
    </div>`;
}

// --- Password confirmation (iOS DeviceAuth) ------------------------------------------------

/** Asks for the wallet password; resolves true once it is right, false when cancelled. */
export function confirmPassword(reason = AUTH_REASON) {
  return new Promise((resolve) => {
    document.querySelector(".kl-auth")?.remove();
    const backdrop = document.createElement("div");
    backdrop.className = "alert-backdrop kl-auth";
    backdrop.innerHTML = `
      <form class="alert" role="alertdialog" aria-modal="true" aria-label="${esc(reason)}">
        <div class="alert-body">
          <div class="alert-title">${esc(reason)}</div>
          <div class="alert-message">Enter your wallet password.</div>
          <input class="alert-field" type="password" autocomplete="current-password" placeholder="Password" aria-label="Password" />
          <div class="error kl-auth-error"></div>
        </div>
        <div class="alert-buttons two">
          <button type="button" class="alert-button" data-cancel>Cancel</button>
          <button type="submit" class="alert-button strong">Confirm</button>
        </div>
      </form>`;
    const done = (ok) => { backdrop.remove(); document.removeEventListener("keydown", onKey); resolve(ok); };
    const onKey = (event) => { if (event.key === "Escape") done(false); };
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop || event.target.closest("[data-cancel]")) done(false); });
    const input = backdrop.querySelector(".alert-field");
    backdrop.querySelector("form").onsubmit = async (event) => {
      event.preventDefault();
      if (await vault.verifyPassword(input.value)) return done(true);
      backdrop.querySelector(".kl-auth-error").textContent = "Wrong password.";
      input.select();
    };
    document.body.appendChild(backdrop);
    input.focus();
  });
}

/** An iOS alert with a destructive confirm button; resolves true on confirm. */
export function confirmAlert({ title, message, confirmLabel, cancelLabel = "Cancel", destructive = true }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "alert-backdrop";
    backdrop.innerHTML = `
      <div class="alert" role="alertdialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="alert-body">
          <div class="alert-title">${esc(title)}</div>
          ${message ? `<div class="alert-message">${unitText(esc(message))}</div>` : ""}
        </div>
        <div class="alert-buttons two">
          <button type="button" class="alert-button" data-cancel>${esc(cancelLabel)}</button>
          <button type="button" class="alert-button strong ${destructive ? "danger-text" : ""}" data-ok>${esc(confirmLabel)}</button>
        </div>
      </div>`;
    const done = (ok) => { backdrop.remove(); document.removeEventListener("keydown", onKey); resolve(ok); };
    const onKey = (event) => { if (event.key === "Escape") done(false); };
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop || event.target.closest("[data-cancel]")) done(false);
      else if (event.target.closest("[data-ok]")) done(true);
    });
    document.body.appendChild(backdrop);
    backdrop.querySelector("[data-ok]").focus();
  });
}

// --- A finished transaction (iOS KachatTxDone / KachatTxDoneSheet) --------------------------

/**
 * The half sheet every finished name transaction shows: what happened, the transaction id (tap
 * to copy) and View in Explorer - the explorer picked in Settings, testnet-10's on testnet.
 * `onClose` runs when it goes away (the action sheet under it closes with it, as on iOS).
 */
export function showTxDone({ txId, title = "Transaction sent", onClose = () => {} }) {
  document.querySelector(".kl-done-backdrop")?.remove();
  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop kl-done-backdrop";
  backdrop.innerHTML = `
    <div class="sheet kl-done" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-grabber"></div>
      <span class="kl-green kl-done-icon">${SYMBOLS.sent}</span>
      <div class="kl-done-title">${esc(title)}</div>
      <p class="muted small center-text">It shows here once the network accepts it, usually within seconds.</p>
      <button class="kl-txid" id="kl-copy-tx" title="Copy">
        <span class="mono tiny ellipsis">${esc(txId)}</span><span class="kl-copy-icon">${ICONS.copy || ""}</span>
      </button>
      <a class="km-prominent kl-full kl-explorer" href="${esc(wallet.explorerTxUrl(txId))}" target="_blank" rel="noopener noreferrer">View in Explorer</a>
      <button class="bar-text strong" data-done>Done</button>
    </div>`;
  const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey); onClose(); };
  const onKey = (event) => { if (event.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop || event.target.closest("[data-done]")) close(); });
  backdrop.querySelector("#kl-copy-tx").onclick = async () => {
    try { await navigator.clipboard.writeText(txId); toast("Transaction ID copied"); } catch { /* clipboard refused */ }
  };
  document.body.appendChild(backdrop);
}

// --- The runtime ---------------------------------------------------------------------------

/** The runtime with the signer bound (keeps `myKey` current). */
async function runtime() {
  const rt = await kachatNames();
  myKey = rt?.actions.myKey ?? null;
  return rt;
}

// --- Hub model (iOS KachatHubModel) --------------------------------------------------------

/**
 * The hub's state, kept while you go into a name and back (iOS @StateObject). market.js renders
 * it; `hub.onChange` is the screen's repaint.
 */
export const hub = {
  /** null until the manifest is checked; false when it fails (the hub then stays a mockup) */
  ready: null,
  setupError: null,
  search: { kind: "idle" },
  listings: [],
  lapsed: [],
  mine: [],
  myOffers: [],
  activity: [],
  loadError: null,
  loaded: false,
  pending: [],
  virtualDaa: null,
  onChange: null,
  _started: false,
  _lookupToken: 0,

  get isLive() { return this.ready === true; },

  changed() { this.onChange?.(); },

  async start() {
    let rt;
    try {
      rt = await runtime();
      await rt.registry.prepare({ forceSourceCheck: true });
      this.ready = true;
      this.setupError = null;
    } catch (error) {
      this.ready = false;
      this.setupError = errorText(error);
      this.changed();
      return;
    }
    if (!this._started) {
      this._started = true;
      rt.actions.subscribe(({ pending, virtualDaa }) => {
        notifyFinished(pending);
        this.pending = pending;
        this.virtualDaa = virtualDaa;
        this.changed();
      });
      rt.registry.onChange(() => { if (this.isLive) this.reload(); });
    }
    rt.actions.resume();
    this.pending = rt.actions.pending;
    for (const r of this.pending) if (!seenStages.has(r.id)) seenStages.set(r.id, r.stage);
    this.virtualDaa = rt.actions.virtualDaa;
    this.changed();
    await rt.registry.refresh();
    await this.reload();
  },

  async refresh() {
    if (!this.isLive) return;
    await registry().refresh();
    await this.reload();
  },

  async reload() {
    if (!this.isLive) return;
    const reg = registry();
    try {
      this.listings = await reg.listings();
      this.lapsed = await reg.lapsed();
      if (myKey) {
        this.mine = await reg.namesOf(myKey, { includeInactive: true });
        this.myOffers = await reg.myOffers(myKey);
        if (this.myOffers.length) await (await runtime()).actions.refreshVirtualDaa();
      } else {
        this.mine = [];
        this.myOffers = [];
      }
      this.activity = await reg.activity();
      this.loadError = null;
    } catch (error) {
      this.loadError = errorText(error);
    }
    this.loaded = true;
    this.changed();
  },

  /** The typed name's availability, after iOS's 350 ms pause. */
  lookup(text) {
    const token = ++this._lookupToken;
    const typed = normalize(text);
    if (!typed) { this.search = { kind: "idle" }; this.changed(); return; }
    if (invalidReason(typed)) { this.search = { kind: "invalid", name: typed }; this.changed(); return; }
    this.search = { kind: "checking", name: typed };
    this.changed();
    setTimeout(async () => {
      if (token !== this._lookupToken) return;
      try {
        const found = await registry().lookup(typed);
        if (token !== this._lookupToken) return;
        this.search = found.kind === "registered"
          ? { kind: "registered", name: typed, info: found.info }
          : { kind: "free", name: typed, gap: found.gap };
      } catch (error) {
        if (token !== this._lookupToken) return;
        this.search = { kind: "failed", name: typed, message: errorText(error) };
      }
      this.changed();
    }, 350);
  },

  pricePerYear(name) {
    const params = registry()?.manifest?.params;
    return params ? paramsPrice(params, new TextEncoder().encode(name).length) : null;
  },
};

// --- Hub: search result (iOS KachatLiveSearchResult) ---------------------------------------

/** The search result card for `typed` (already lowercased), or "". */
export function searchResultHtml(typed) {
  const name = normalize(typed);
  if (!name) return "";
  const s = hub.search;
  const title = (text) => `<span class="strong ellipsis">${esc(text)}</span>`;
  let body;
  if (s.kind === "registered" && s.name === name) {
    const n = s.info;
    const status = statusOf(n);
    let line;
    if (status === Status.active) {
      line = `<span class="muted tiny">${isMine(n.owner) ? "Yours" : n.isListed ? `Taken · for sale at ${esc(amount(n.price))}` : "Taken"}</span>`;
    } else if (status === Status.grace) {
      line = '<span class="tiny kl-orange">Expired - the owner can still renew it</span>';
    } else {
      line = '<span class="tiny kl-red">Lapsed - reclaim it, then claim it</span>';
    }
    return `
      <button class="km-card km-search-result kl-result-button" data-name="${esc(n.name)}">
        <span class="tx-meta">${title(n.display)}${line}</span>
        <span class="km-chevron">${ICONS.chevron}</span>
      </button>`;
  }
  if (s.kind === "free" && s.name === name) {
    const price = hub.pricePerYear(name);
    body = `
      <span class="tx-meta">${title(`${name}.kachat`)}${price != null ? `<span class="tiny kl-green">Available · ${esc(amount(price))} a year</span>` : ""}</span>
      <button class="km-prominent small-button" id="claim" ${s.gap ? "" : "disabled"}>Claim</button>`;
  } else if (s.kind === "invalid" && s.name === name) {
    body = `<span class="tx-meta">${title(`${name}.kachat`)}<span class="muted tiny">${esc(invalidReason(name) || "Not a valid name.")}</span></span>`;
  } else if (s.kind === "failed" && s.name === name) {
    body = `<span class="tx-meta">${title(`${name}.kachat`)}<span class="muted tiny">${esc(s.message)}</span></span>`;
  } else {
    body = `<span class="tx-meta">${title(`${name}.kachat`)}</span><span class="spinner small-spin"></span>`;
  }
  return `<div class="km-card km-search-result">${body}</div>`;
}

/** Wires the search result inside `container`. */
export function bindSearchResult(container, nav) {
  container.querySelector("#claim")?.addEventListener("click", () => {
    const s = hub.search;
    if (s.kind === "free" && s.gap) openClaimSheet({ name: s.name, gap: s.gap });
  });
  container.querySelector(".kl-result-button")?.addEventListener("click", () => {
    if (hub.search.kind === "registered") nav.openName(hub.search.info);
  });
}

// --- Hub: registrations in flight (iOS KachatRegistrationCard) -----------------------------

const STAGE_TEXT = {
  [Stage.committing]: "Sending the hidden commit...",
  [Stage.registering]: "Registering...",
  [Stage.registered]: "Registered. It's yours.",
  [Stage.taken]: "Someone registered this name first. Cancel the commit to get its 0.2 KAS back.",
  [Stage.failed]: "The registration stopped.",
  [Stage.cancelling]: "Cancelling the commit...",
  [Stage.cancelled]: "Cancelled.",
};

const cardErrors = new Map(); // registration id -> error from a cancel here
const cardWorking = new Set();

export function registrationCardsHtml() {
  if (!hub.isLive) return "";
  const tCommit = registry()?.manifest?.params.tCommit ?? 600n;
  return hub.pending.filter(isOpen).map((r) => {
    const icon = needsDriving(r)
      ? '<span class="spinner small-spin"></span>'
      : r.stage === Stage.registered ? `<span class="kl-green">${SYMBOLS.seal}</span>` : `<span class="kl-orange">${SYMBOLS.alertCircle}</span>`;
    let stage = STAGE_TEXT[r.stage] || "";
    if (r.stage === Stage.waiting) {
      stage = r.commitDaa == null
        ? "Waiting for the commit to confirm..."
        : "The commit has to age for about a minute before the name can be registered. Keep KaChat Wallet open - it registers by itself, and picks up where it left off if you leave.";
    }
    let progress = "";
    if (r.stage === Stage.waiting && r.commitDaa != null && hub.virtualDaa != null) {
      const target = Number(BigInt(tCommit) + 20n);
      const commitDaa = BigInt(r.commitDaa);
      const done = Number(hub.virtualDaa > commitDaa ? hub.virtualDaa - commitDaa : 0n);
      const left = Math.max(0, Math.floor((target - done) / Number(DAA_PER_SECOND)));
      progress = `<progress max="${target}" value="${Math.min(done, target)}"></progress><div class="muted tiny">About ${left} s to go</div>`;
    }
    const message = cardErrors.get(r.id) || (r.stage === Stage.failed ? r.lastError : null);
    const working = cardWorking.has(r.id);
    let buttons = "";
    if (r.stage === Stage.registered || r.stage === Stage.cancelled) {
      buttons = `<div class="kl-buttons">
        ${finishedTx(r) ? `<button class="km-prominent small-button" data-reg-view="${esc(r.id)}">View Transaction</button>` : ""}
        <button class="km-bordered small-button" data-reg-done="${esc(r.id)}">Done</button>
      </div>`;
    }
    else if (r.stage === Stage.taken) buttons = `<button class="km-bordered small-button danger-text" data-reg-cancel="${esc(r.id)}" ${working ? "disabled" : ""}>Cancel Commit</button>`;
    else if (r.stage === Stage.failed) {
      buttons = `<div class="kl-buttons">
        <button class="km-prominent small-button" data-reg-retry="${esc(r.id)}">Try Again</button>
        <button class="km-bordered small-button danger-text" data-reg-cancel="${esc(r.id)}" ${working ? "disabled" : ""}>Cancel Commit</button>
      </div>`;
    }
    return `
      <div class="km-card kl-reg">
        <div class="kl-reg-head"><span class="km-title">${esc(r.name)}.kachat</span>${icon}</div>
        <div class="muted small">${unitText(esc(stage))}</div>
        ${progress}
        ${message ? `<div class="error-text tiny">${esc(message)}</div>` : ""}
        ${buttons}
      </div>`;
  }).join("");
}

/** The finished registration (or cancelled commit) as the done sheet shows it, or null. */
function finishedTx(r) {
  if (r.stage === Stage.registered && r.registerTxId) return { txId: r.registerTxId, title: "Name registered" };
  if (r.stage === Stage.cancelled && r.cancelTxId) return { txId: r.cancelTxId, title: "Commit cancelled" };
  return null;
}

// The stage each registration was last seen in: the done sheet pops up the moment one lands.
const seenStages = new Map();
function notifyFinished(pending) {
  for (const r of pending) {
    const before = seenStages.get(r.id);
    seenStages.set(r.id, r.stage);
    if (before && before !== r.stage) {
      const done = finishedTx(r);
      if (done && app.dataset.screen === "kachat-market") showTxDone(done);
    }
  }
}

export function bindRegistrationCards(container) {
  const find = (id) => hub.pending.find((r) => r.id === id);
  for (const b of container.querySelectorAll("[data-reg-view]")) b.onclick = () => { const r = find(b.dataset.regView); const done = r && finishedTx(r); if (done) showTxDone(done); };
  for (const b of container.querySelectorAll("[data-reg-done]")) b.onclick = async () => (await runtime()).actions.dismiss(b.dataset.regDone);
  for (const b of container.querySelectorAll("[data-reg-retry]")) b.onclick = async () => (await runtime()).actions.retry(b.dataset.regRetry);
  for (const b of container.querySelectorAll("[data-reg-cancel]")) {
    b.onclick = async () => {
      const id = b.dataset.regCancel;
      const ok = await confirmAlert({
        title: "Cancel the commit?",
        message: "The registration stops and the commit's 0.2 KAS comes back to you, less the network fee.",
        confirmLabel: "Cancel Commit", cancelLabel: "Keep",
      });
      if (!ok || !(await confirmPassword())) return;
      cardWorking.add(id);
      cardErrors.delete(id);
      hub.changed();
      try { await (await runtime()).actions.cancel(find(id) || id); } catch (error) { cardErrors.set(id, errorText(error)); }
      cardWorking.delete(id);
      hub.changed();
    };
  }
}

// --- Hub: pages (iOS KachatLiveMarketPage / MyNamesPage / ActivityPage) ---------------------

function listCard(names, options) {
  return `<div class="km-card km-list">${names.map((n) => nameRowHtml(n, options)).join("")}</div>`;
}

export function livePageHtml(page) {
  if (page === "market") {
    return `
      ${sectionHeader("For sale", "Names their owners have listed. Buying pays the owner and moves the name to you in one transaction.")}
      ${hub.listings.length ? listCard(hub.listings) : emptyCard(hub.loaded ? "No names are listed right now." : null)}
      ${sectionHeader("Reclaimable", "Names whose owners let them lapse. Anyone may reclaim one: the bond goes back to its last owner, you keep the freed deposit as a bounty, and the name is free to claim.")}
      ${hub.lapsed.length
        ? `<div class="km-card km-list">${hub.lapsed.map((n) => `
            <div class="kl-row-with-button">${nameRowHtml(n, { showPrice: false })}<button class="km-bordered small-button" data-reclaim="${esc(n.name)}">Reclaim</button></div>`).join("")}</div>`
        : emptyCard(hub.loaded ? "Nothing to reclaim." : null)}
      ${hub.loadError ? `<p class="error-text small kl-pad">${esc(hub.loadError)}</p>` : ""}`;
  }
  if (page === "myNames") {
    const chain = registry()?.source?.kind === "chain";
    return `
      ${sectionHeader("My Names", "Renew, list, transfer or release them, and pick the one KaChat shows for you.")}
      ${hub.mine.length ? listCard(hub.mine) : `
        <div class="km-empty">
          <span class="accent">${ICONS.atCircle}</span>
          <div class="km-title">No .kachat names yet</div>
          <p class="muted small">Search for a name above and claim it.</p>
        </div>`}
      ${sectionHeader("My Offers", "Offers you made. Withdraw one any time; once it passes its refund time anyone can return it to you.")}
      ${hub.myOffers.length
        ? `<div class="km-card km-list">${hub.myOffers.map((o) => offerRowHtml(o, { isBuyer: true, isOwner: false })).join("")}</div>`
        : emptyCard(hub.loaded ? "No open offers." : null)}
      ${chain ? '<p class="muted small kl-pad">Offers from others appear once a names indexer is connected.</p>' : ""}`;
  }
  return `
    ${sectionHeader("Recent activity", "Claims, renewals, listings, sales and transfers across the registry.")}
    ${hub.activity.length
      ? `<div class="km-card km-list">${hub.activity.slice(0, 100).map((e) => eventRowHtml(e, true)).join("")}</div>`
      : emptyCard(hub.loaded ? "Nothing yet." : null)}`;
}

export function bindLivePage(container, nav) {
  for (const row of container.querySelectorAll("[data-name]")) {
    row.onclick = () => {
      const name = row.dataset.name;
      const info = [...hub.listings, ...hub.lapsed, ...hub.mine].find((n) => n.name === name);
      if (info) nav.openName(info);
    };
  }
  for (const b of container.querySelectorAll("[data-reclaim]")) {
    b.onclick = () => {
      const info = hub.lapsed.find((n) => n.name === b.dataset.reclaim);
      if (info) openReclaimSheet(info);
    };
  }
  bindOfferRows(container, hub.myOffers, null);
}

// --- Offers (iOS KachatOfferAction / KachatOfferRow) ---------------------------------------

function offerRowHtml(offer, { isBuyer, isOwner }) {
  const refundable = hub.virtualDaa != null && offer.refundable(hub.virtualDaa);
  const who = isBuyer ? "Your offer" : (addressOf(offer.buyer) ? shortAddress(addressOf(offer.buyer)) : "");
  let trailing = "";
  if (isBuyer) trailing = `<button class="icon plain accent" data-offer-menu="${esc(offer.id)}" aria-label="Offer actions">${SYMBOLS.ellipsisCircle}</button>`;
  else if (isOwner) trailing = `<button class="km-prominent small-button" data-offer-accept="${esc(offer.id)}">Accept</button>`;
  else if (refundable) trailing = `<button class="km-bordered small-button" data-offer-refund="${esc(offer.id)}">Refund</button>`;
  return `
    <div class="km-row">
      <span class="accent km-icon">${SYMBOLS.hand}</span>
      <span class="tx-meta">
        ${offer.name ? `<span class="strong small">${esc(offer.name)}.kachat</span>` : ""}
        <span class="muted tiny">${esc(who)}</span>
        ${refundable ? '<span class="tiny kl-orange">Refundable now</span>' : ""}
      </span>
      <span class="strong small">${esc(amount(offer.amount))}</span>
      ${trailing}
    </div>`;
}

function bindOfferRows(container, offers, name) {
  const find = (id) => offers.find((o) => o.id === id);
  for (const b of container.querySelectorAll("[data-offer-menu]")) {
    b.onclick = () => {
      const offer = find(b.dataset.offerMenu);
      if (!offer) return;
      const refundable = hub.virtualDaa != null && offer.refundable(hub.virtualDaa);
      offerMenu(offer, refundable);
    };
  }
  for (const b of container.querySelectorAll("[data-offer-accept]")) b.onclick = () => { const o = find(b.dataset.offerAccept); if (o && name) openOfferAction("accept", o, name); };
  for (const b of container.querySelectorAll("[data-offer-refund]")) b.onclick = () => { const o = find(b.dataset.offerRefund); if (o) openOfferAction("refund", o); };
}

function offerMenu(offer, refundable) {
  // iOS Menu { Withdraw, Refund (when refundable) } - here as a small sheet.
  showSheet({
    title: offer.name ? `${offer.name}.kachat` : "Your offer",
    subtitle: amount(offer.amount),
    rows: [
      { label: "Withdraw", subtitle: "Takes the offer back.", icon: SYMBOLS.release, onClick: () => openOfferAction("withdraw", offer) },
      ...(refundable ? [{ label: "Refund", subtitle: "Returns the offer to you now that it passed its refund time.", icon: SYMBOLS.renew, onClick: () => openOfferAction("refund", offer) }] : []),
    ],
  });
}

function openOfferAction(kind, offer, name = null) {
  const offerRow = { title: "Offer", value: amount(offer.amount) };
  if (kind === "withdraw") {
    return openTxSheet({ title: "Withdraw Offer", confirmTitle: "Withdraw", doneTitle: "Offer withdrawn", rows: [offerRow], operation: () => Operation.withdraw(offer) });
  }
  if (kind === "refund") {
    return openTxSheet({ title: "Refund Offer", confirmTitle: "Refund", doneTitle: "Offer refunded", rows: [offerRow], operation: () => Operation.refund(offer) });
  }
  const buyer = addressOf(offer.buyer);
  return openTxSheet({
    title: "Accept Offer", confirmTitle: "Accept and Transfer", doneTitle: "Offer accepted",
    warning: "The name goes to the buyer and the offer's amount comes to you, in one transaction. This can't be undone.",
    rows: [{ title: "Name", value: name.display }, offerRow, { title: "Buyer", value: buyer ? shortAddress(buyer) : "" }],
    operation: () => Operation.accept(offer, name),
  });
}

// --- The transaction sheet (iOS KachatTxSheet) ---------------------------------------------

/** What the transaction does to the wallet: its outputs to the wallet minus its inputs from it. */
function balanceChange(plan, me) {
  const mine = p2pkScript(me);
  const received = plan.unsignedTx.outputs.filter((o) => bytesEqual(o.script, mine)).reduce((a, o) => a + o.value, 0n);
  const spent = plan.entries.filter((e) => bytesEqual(e.script, mine)).reduce((a, e) => a + e.amount, 0n);
  return received - spent;
}

// A short value stays on one line; a long one (an address) wraps anywhere.
const labeledRow = (title, value, bold = false) =>
  `<div class="form-row between"><span class="${bold ? "strong" : ""}">${esc(title)}</span><span class="kl-value ${String(value).length > 24 ? "kl-long" : ""} ${bold ? "strong" : ""}">${esc(value)}</span></div>`;

/**
 * Every action's sheet: its inputs, what it costs (built against live UTXOs, nothing sent), one
 * Confirm - an extra warning for the destructive ones - then the password, then the transaction.
 * Shows the txid when it is sent.
 *   rows: [{ title, value }] or a function returning them (recomputed with the inputs)
 *   operation(): the Operation for the current inputs, or null
 *   inputsHtml / bindInputs(panel, changed): the sheet's own fields; `changed()` rebuilds
 */
function openTxSheet({ title, confirmTitle, doneTitle = "Transaction sent", warning = null, footer = null, rows = [], operation, inputsHtml = "", bindInputs = null, onDone = () => {} }) {
  const state = { plan: null, planError: null, building: false, sending: false, txId: null, sendError: null, token: 0, balance: null };
  let handle = null;
  const rowsNow = () => (typeof rows === "function" ? rows() : rows);
  const footerNow = () => (typeof footer === "function" ? footer() : footer);

  const planHtml = () => {
    const p = state.plan;
    let costs = "";
    if (p) {
      costs = `${p.priceFee > 0n ? labeledRow("Price (to miners)", amount(p.priceFee)) : ""}
        ${labeledRow("Network fee", amount(p.networkFee))}
        ${myKey ? balanceRows(balanceChange(p, myKey)) : ""}`;
    } else if (state.building) {
      costs = '<div class="form-row between"><span>Network fee</span><span class="spinner small-spin"></span></div>';
    }
    const list = rowsNow().map((r) => labeledRow(r.title, r.value)).join("") + costs;
    const foot = state.planError ? `<span class="error-text">${esc(state.planError)}</span>` : footerNow() ? esc(footerNow()) : "";
    const confirm = state.txId
      ? `<div class="form-row kl-sent">
          <span class="kl-green kl-sent-title">${SYMBOLS.sent}<span>Sent</span></span>
          <span class="mono tiny muted break">${esc(state.txId)}</span>
          <span class="muted tiny">It shows here once the network accepts it, usually within seconds.</span>
        </div>`
      : `<button class="form-row km-form-button ${warning ? "danger-text" : ""}" id="kl-confirm" ${state.plan && !state.sending ? "" : "disabled"}>
          ${state.sending ? '<span class="spinner small-spin"></span>' : esc(confirmTitle)}
        </button>`;
    return `
      <div class="form-section">
        ${list ? `<div class="form-card">${list}</div>` : ""}
        ${foot ? `<div class="form-footer">${unitText(foot)}</div>` : ""}
      </div>
      ${warning ? `<div class="form-section"><div class="form-card"><div class="form-row kl-warning">${SYMBOLS.warning}<span>${esc(warning)}</span></div></div></div>` : ""}
      <div class="form-section">
        <div class="form-card">${confirm}</div>
        ${state.sendError ? `<div class="form-footer error-text">${esc(state.sendError)}</div>` : ""}
      </div>`;
  };

  // Names always spend from, and pay back to, the chatting address: show its real balance and
  // what it will be once this is sent (iOS 8ecc38c).
  const balanceRows = (change) => (state.balance != null
    ? labeledRow("Chatting address balance", amount(state.balance)) + labeledRow("Balance after", amount(state.balance + change > 0n ? state.balance + change : 0n), true)
    : labeledRow("Balance change", signed(change), true));

  const paint = () => {
    if (!handle?.isOpen()) return;
    const host = handle.panel.querySelector("[data-plan]");
    host.innerHTML = unitText(planHtml());
    host.querySelector("#kl-confirm")?.addEventListener("click", confirm);
  };

  const rebuild = () => {
    const token = ++state.token;
    state.plan = null;
    state.planError = null;
    const op = operation();
    state.building = Boolean(op);
    paint();
    if (!op) return;
    setTimeout(async () => {
      if (token !== state.token) return;
      try {
        const plan = await (await runtime()).actions.plan(op);
        if (token !== state.token) return;
        state.plan = plan;
      } catch (error) {
        if (token !== state.token) return;
        state.planError = errorText(error);
      }
      state.building = false;
      paint();
    }, 300);
  };

  async function confirm() {
    if (!state.plan || state.sending) return;
    if (warning && !(await confirmAlert({ title, message: warning, confirmLabel: confirmTitle }))) return;
    if (!(await confirmPassword())) return;
    const op = operation();
    if (!op) return;
    state.sending = true;
    state.sendError = null;
    paint();
    try {
      const id = await (await runtime()).actions.perform(op);
      state.txId = id;
      handle.setBar({ trailing: "Done" });
      onDone(id);
      showTxDone({ txId: id, title: doneTitle, onClose: () => handle.close() });
    } catch (error) {
      state.sendError = errorText(error);
    }
    state.sending = false;
    paint();
  }

  handle = openPanel({
    title, leading: "Cancel", full: true,
    body: `<div data-inputs class="kl-inputs">${inputsHtml}</div><div data-plan></div>`,
  });
  bindInputs?.(handle.panel, rebuild);
  rebuild();
  chattingBalance().then((balance) => { state.balance = balance; paint(); });
  return handle;
}

/** The chatting address's balance (sompi), read from a node; null when it can't be read. */
async function chattingBalance() {
  try {
    const rt = await runtime();
    const utxos = await rt.engine.getUtxosWithCovenants([rt.actions.myAddress]);
    return utxos.reduce((sum, u) => sum + u.amount, 0n);
  } catch {
    return null;
  }
}

/** A segmented control (iOS .pickerStyle(.segmented)). */
const segmented = (name, options, selected) => `
  <div class="segmented wide" role="radiogroup" data-seg="${name}">
    ${options.map(([value, label]) => `<button type="button" role="radio" data-value="${esc(String(value))}" aria-checked="${String(value) === String(selected)}">${esc(label)}</button>`).join("")}
  </div>`;

function bindSegmented(panel, name, onPick) {
  const group = panel.querySelector(`[data-seg="${name}"]`);
  for (const b of group.querySelectorAll("[data-value]")) {
    b.onclick = () => {
      for (const other of group.querySelectorAll("[data-value]")) other.setAttribute("aria-checked", String(other === b));
      onPick(b.dataset.value);
    };
  }
}

const yearsText = (y) => (Number(y) === 1 ? "1 year" : `${y} years`);
const maxYears = () => Number(registry()?.manifest?.params.maxYears ?? 2n);
const amountField = (id) => `
  <div class="form-card"><div class="form-row">
    <input class="plain-input kl-amount" id="${id}" inputmode="decimal" placeholder="0" autocomplete="off" />
    <span class="muted">${esc(KAS_UNIT)}</span>
  </div></div>`;

// --- Claim (iOS KachatClaimSheet) ----------------------------------------------------------

function openClaimSheet(target) {
  const state = { years: 1n, quote: null, quoteError: null, starting: false, startError: null, token: 0 };
  const yearOptions = Array.from({ length: Math.max(1, maxYears()) }, (_, i) => [i + 1, yearsText(i + 1)]);
  const step = (n, text) => `<div class="form-row kl-step"><span class="kl-step-n">${n}</span><span class="small">${esc(text)}</span></div>`;
  let handle = null;

  const costHtml = () => {
    const q = state.quote;
    let rows;
    if (q) {
      rows = `${labeledRow("Price (to miners)", `${amount(q.price / (q.years > 0n ? q.years : 1n))} × ${q.years}`)}
        ${labeledRow("Bond (returned on release)", amount(q.bond))}
        ${labeledRow("Registry deposit (returned on release)", amount(q.gapDeposit))}
        ${labeledRow("Commit (returned at registration)", amount(q.commit))}
        ${labeledRow("Network fees", amount(q.networkFee))}
        ${labeledRow("Total", amount(q.total), true)}
        ${labeledRow("Available", amount(q.spendable))}`;
    } else if (state.quoteError) {
      rows = `<div class="form-row error-text">${esc(state.quoteError)}</div>`;
    } else {
      rows = '<div class="form-row between"><span>Total</span><span class="spinner small-spin"></span></div>';
    }
    const foot = q && !q.affordable
      ? '<span class="error-text">Not enough KAS on your chatting address for this name.</span>'
      : "The price goes to the miners - KaChat takes nothing. The bond and the deposit come back when you release the name.";
    return `
      <div class="form-section">
        <div class="form-header">Cost</div>
        <div class="form-card">${rows}</div>
        <div class="form-footer">${unitText(foot)}</div>
      </div>
      <div class="form-section">
        <div class="form-header">How claiming works</div>
        <div class="form-card">
          ${step(1, "A hidden commit goes on chain first. Nobody can see which name it is for.")}
          ${step(2, "About a minute later KaChat Wallet registers the name by itself. Keep it open; if you close it, it continues next time.")}
          ${step(3, "The name is yours for the years you paid. Renew it any time before it expires.")}
        </div>
      </div>
      <div class="form-section">
        <div class="form-card">
          <button class="form-row km-form-button" id="kl-claim" ${state.quote?.affordable && !state.starting ? "" : "disabled"}>
            ${state.starting ? '<span class="spinner small-spin"></span>' : `Claim ${esc(target.name)}.kachat`}
          </button>
        </div>
        ${state.startError ? `<div class="form-footer error-text">${esc(state.startError)}</div>` : ""}
      </div>`;
  };

  const paint = () => {
    if (!handle?.isOpen()) return;
    const host = handle.panel.querySelector("[data-cost]");
    host.innerHTML = unitText(costHtml());
    host.querySelector("#kl-claim")?.addEventListener("click", start);
  };

  const requote = async () => {
    const token = ++state.token;
    state.quote = null;
    state.quoteError = null;
    paint();
    try {
      const q = await (await runtime()).actions.quote({ name: target.name, years: state.years, gap: target.gap });
      if (token === state.token) state.quote = q;
    } catch (error) {
      if (token === state.token) state.quoteError = errorText(error);
    }
    if (token === state.token) paint();
  };

  async function start() {
    if (!(await confirmPassword())) return;
    state.starting = true;
    state.startError = null;
    paint();
    try {
      await (await runtime()).actions.startRegistration({ name: target.name, years: state.years });
      handle.close();
      toast(`Claiming ${target.name}.kachat`);
      return;
    } catch (error) {
      state.startError = errorText(error);
    }
    state.starting = false;
    paint();
  }

  handle = openPanel({
    title: "Claim Name", leading: "Cancel", full: true,
    body: `
      <div class="form-section">
        <div class="form-card">
          ${labeledRow("Name", `${target.name}.kachat`, true)}
          <div class="form-row">${segmented("years", yearOptions, 1)}</div>
        </div>
      </div>
      <div data-cost></div>`,
  });
  bindSegmented(handle.panel, "years", (value) => { state.years = BigInt(value); requote(); });
  requote();
}

// --- Sheets with inputs --------------------------------------------------------------------

function openBuySheet(info) {
  const soon = info.expiresAt - 30n * 86_400_000n < BigInt(Date.now());
  openTxSheet({
    title: "Buy Name", confirmTitle: "Confirm Purchase", doneTitle: "Name bought",
    footer: soon ? "Less than 30 days are left before this name expires. You'd have to renew it soon." : "The payment reaches the seller and the name reaches you in the same transaction - both happen, or neither does.",
    rows: [{ title: "Name", value: info.display }, { title: "Price (to the seller)", value: amount(info.price) }, { title: "Expires", value: day(info.expiresAt) }],
    operation: () => Operation.buy(info),
  });
}

function openOfferSheet(name, info) {
  const state = { amount: null, days: 3, virtualDaa: null };
  const refundAfter = () => (state.virtualDaa != null ? state.virtualDaa + BigInt(state.days) * 86_400n * DAA_PER_SECOND : null);
  const belowListing = () => Boolean(info?.isListed && state.amount != null && info.price < state.amount);
  openTxSheet({
    title: "Make an Offer", confirmTitle: "Send Offer", doneTitle: "Offer sent",
    footer: () => (belowListing() ? "This name is listed for less than your offer. Anyone could buy the listing with your offer, so consider buying it instead." : null),
    rows: () => [
      { title: "Name", value: `${name}.kachat` },
      ...(info?.isListed ? [{ title: "Listed at", value: amount(info.price) }] : []),
      ...(info ? [{ title: "Expires", value: day(info.expiresAt) }] : []),
      ...(state.amount != null ? [{ title: "Offer", value: amount(state.amount) }] : []),
    ],
    operation: () => (state.amount != null && refundAfter() != null ? Operation.offer(name, state.amount, refundAfter(), info) : null),
    inputsHtml: `
      <div class="form-section">
        <div class="form-header">Your offer</div>
        ${amountField("kl-offer-amount")}
        <div class="form-footer">${unitText("Your KAS stays locked on chain until the owner accepts, you withdraw the offer, or it expires - then anyone can send it back to you.")}</div>
      </div>
      <div class="form-section">
        <div class="form-header">Refundable after</div>
        <div class="form-card"><div class="form-row">${segmented("days", [[1, "1 Day"], [3, "3 Days"], [7, "7 Days"], [30, "30 Days"]], 3)}</div></div>
      </div>`,
    bindInputs(panel, changed) {
      const input = panel.querySelector("#kl-offer-amount");
      input.oninput = () => { state.amount = positive(parseSompi(input.value)); changed(); };
      bindSegmented(panel, "days", (value) => { state.days = Number(value); changed(); });
      runtime().then((rt) => rt.engine.currentVirtualDaaScore()).then((daa) => { state.virtualDaa = daa; changed(); }).catch(() => {});
    },
  });
}

function openRenewSheet(info) {
  const state = { years: 1n };
  const params = registry()?.manifest?.params;
  const perYear = params ? paramsRenewPrice(params, new TextEncoder().encode(info.name).length) : 0n;
  openTxSheet({
    title: "Renew", confirmTitle: "Renew", doneTitle: "Renewed",
    footer: "A renewal adds to the current expiry, even after it passed. The price goes to the miners.",
    rows: () => [
      { title: "Name", value: info.display },
      { title: "Price per year", value: amount(perYear) },
      { title: "New expiry", value: day(info.expiresAt + state.years * yearMs) },
    ],
    operation: () => Operation.renew(info, state.years),
    inputsHtml: `<div class="form-section"><div class="form-card"><div class="form-row">${segmented("years", Array.from({ length: Math.max(1, maxYears()) }, (_, i) => [i + 1, yearsText(i + 1)]), 1)}</div></div></div>`,
    bindInputs(panel, changed) {
      bindSegmented(panel, "years", (value) => { state.years = BigInt(value); changed(); });
    },
  });
}

function openListSheet(info) {
  const state = { price: null };
  openTxSheet({
    title: info.isListed ? "Change Price" : "List for Sale", confirmTitle: info.isListed ? "Change Price" : "List", doneTitle: info.isListed ? "Price changed" : "Listed for sale",
    footer: "Anyone can buy it at this price: the payment reaches you and the name reaches them in one transaction. Delist any time.",
    rows: info.isListed ? [{ title: "Listed at", value: amount(info.price) }] : [],
    operation: () => (state.price != null ? Operation.list(info, state.price) : null),
    inputsHtml: `<div class="form-section"><div class="form-header">Price</div>${amountField("kl-price")}</div>`,
    bindInputs(panel, changed) {
      const input = panel.querySelector("#kl-price");
      input.oninput = () => { state.price = positive(parseSompi(input.value)); changed(); };
    },
  });
}

function openTransferSheet(info) {
  const state = { resolved: null, error: null, resolving: false, token: 0 };
  let statusEl = null;
  const showStatus = () => {
    if (!statusEl) return;
    statusEl.innerHTML = state.resolving
      ? '<span class="spinner small-spin"></span>'
      : state.resolved ? `<span class="mono tiny muted break">${esc(state.resolved.address)}</span>`
      : state.error ? `<span class="tiny error-text">${esc(state.error)}</span>` : "";
  };
  const resolve = async (text, token, changed) => {
    state.resolved = null;
    state.error = null;
    const t = text.trim().toLowerCase();
    if (!t) return;
    if (t.startsWith("kaspatest:") || t.startsWith("kaspa:")) {
      const key = KachatNamesRegistry.keyOf(t);
      if (!key) { state.error = "Not a testnet Schnorr address."; return; }
      try { KachatNamesActions.validateKey(key, ""); } catch { state.error = "That address's key is not valid."; return; }
      state.resolved = { address: t, key };
      return;
    }
    const name = normalize(t);
    if (invalidReason(name)) { state.error = "Enter an address or a .kachat name."; return; }
    state.resolving = true;
    showStatus();
    try {
      const found = await registry().lookup(name);
      if (token !== state.token) return;
      if (found.kind === "registered" && statusOf(found.info) === Status.active && addressOf(found.info.owner)) {
        state.resolved = { address: addressOf(found.info.owner), key: found.info.owner };
      } else {
        state.error = "No active .kachat name by that name.";
      }
    } catch {
      state.error = "Couldn't look that name up.";
    }
    state.resolving = false;
  };
  openTxSheet({
    title: "Transfer", confirmTitle: "Transfer", doneTitle: "Name transferred",
    warning: "A transfer can't be undone. The new owner gets the name with its current expiry; your profile stays with your address.",
    rows: () => [{ title: "Name", value: info.display }, ...(state.resolved ? [{ title: "To", value: state.resolved.address }] : [])],
    operation: () => (state.resolved ? Operation.transfer(info, state.resolved.key) : null),
    inputsHtml: `
      <div class="form-section">
        <div class="form-header">New owner</div>
        <div class="form-card">
          <div class="form-row"><input class="plain-input" id="kl-to" placeholder="kaspatest:... or name.kachat" autocomplete="off" autocapitalize="off" spellcheck="false" /></div>
          <div class="form-row kl-resolve" id="kl-to-status"></div>
        </div>
        <div class="form-footer">A testnet address, or a .kachat name - it's resolved to the address shown.</div>
      </div>`,
    bindInputs(panel, changed) {
      const input = panel.querySelector("#kl-to");
      statusEl = panel.querySelector("#kl-to-status");
      let timer = null;
      input.oninput = () => {
        clearTimeout(timer);
        const token = ++state.token;
        timer = setTimeout(async () => {
          await resolve(input.value, token, changed);
          if (token !== state.token) return;
          showStatus();
          changed();
        }, 400);
      };
    },
  });
}

function openReclaimSheet(info) {
  openTxSheet({
    title: "Reclaim", confirmTitle: "Reclaim", doneTitle: "Name reclaimed",
    footer: "The name's bond goes back to its last owner, you keep the freed registry deposit (less the fee) as a bounty, and the name is free. To own it, claim it afterwards.",
    rows: [{ title: "Name", value: info.display }, { title: "Bond to the last owner", value: amount(registry()?.manifest?.params.bond ?? 0n) }],
    operation: () => Operation.reclaim(info),
  });
}

// --- Name detail (iOS KachatLiveNameDetail) ------------------------------------------------

/**
 * A registered name, live: who owns it, its status and expiry, its price, and what the person
 * can do with it - buy or make an offer; or, for their own names, renew, list, transfer, release
 * and make it their primary name. Offers and history below.
 */
export async function showLiveNameDetail({ info: initial, onBack }) {
  await runtime().catch(() => null);
  const state = { info: initial, ownerLabel: null, offers: [], history: [], gone: false };
  const here = () => app.dataset.screen === "kachat-name" && app.dataset.kachatName === state.info.name;

  const nameCard = () => {
    const info = state.info;
    const status = statusOf(info);
    const mine = isMine(info.owner);
    let note = "";
    if (status === Status.grace) {
      note = mine
        ? '<p class="small kl-orange">Expired - renew to keep it. Until the grace period ends nobody else can take it.</p>'
        : '<p class="small kl-orange">Expired. It no longer resolves; the owner can still renew it.</p>';
    } else if (status === Status.lapsed) {
      note = '<p class="small kl-red">Lapsed: anyone may reclaim it, and then claim it again.</p>';
    }
    return `
      <div class="km-card km-name-card kl-name-card">
        <div class="km-name-banner">${esc(info.display)}</div>
        <div class="km-price-row">
          <div class="tx-meta"><span class="muted tiny">${info.isListed ? "Price" : "Not for sale"}</span>${info.isListed ? `<span class="km-price">${esc(amount(info.price))}</span>` : ""}</div>
          <div class="kl-expiry">${statusPill(status)}<span class="muted tiny">Expires ${esc(day(info.expiresAt))}</span></div>
        </div>
        ${note}
      </div>`;
  };

  const action = (id, label, icon, { prominent = false, disabled = false } = {}) =>
    `<button class="${prominent ? "km-prominent" : "km-bordered"} with-icon" id="${id}" ${disabled ? "disabled" : ""}>${icon}<span>${esc(label)}</span></button>`;

  const actionButtons = () => {
    const info = state.info;
    const status = statusOf(info);
    if (isMine(info.owner)) {
      const active = status === Status.active;
      return `
        <div class="km-actions">
          ${action("kl-renew", "Renew", SYMBOLS.renew, { prominent: !active })}
          ${action("kl-list", info.isListed ? "Change Price" : "List for Sale", SYMBOLS.tag, { disabled: !active })}
          ${action("kl-transfer", "Transfer", SYMBOLS.arrows)}
          ${info.isListed ? action("kl-delist", "Delist", SYMBOLS.tagSlash) : action("kl-primary", "Set as Primary", SYMBOLS.primary, { disabled: !active })}
        </div>
        ${info.isListed ? `<div class="kl-pad">${action("kl-primary", "Set as Primary", SYMBOLS.primary, { disabled: !active })}</div>` : ""}
        <div class="kl-pad"><button class="km-bordered with-icon danger-text kl-full" id="kl-release">${SYMBOLS.trash}<span>Release Name</span></button></div>`;
    }
    if (status === Status.lapsed) return `<div class="kl-pad">${action("kl-reclaim", "Reclaim", SYMBOLS.reclaim, { prominent: true })}</div>`;
    const buy = info.isListed && status === Status.active;
    return `<div class="${buy ? "km-actions" : "kl-pad"}">${buy ? action("kl-buy", "Buy Now", SYMBOLS.cart, { prominent: true }) : ""}${action("kl-offer", "Make an Offer", SYMBOLS.hand)}</div>`;
  };

  const ownerCard = () => {
    const info = state.info;
    const mine = isMine(info.owner);
    const address = addressOf(info.owner);
    return `
      ${sectionHeader("Owner")}
      <div class="km-card km-seller">
        <span class="kl-owner-icon">${SYMBOLS.personFill}</span>
        <span class="tx-meta">
          ${mine ? '<span class="strong small">You</span>' : state.ownerLabel ? `<span class="strong small">${esc(state.ownerLabel)}.kachat</span>` : ""}
          ${address ? `<span class="mono tiny muted break">${esc(address)}</span>` : ""}
        </span>
      </div>`;
  };

  const offersSection = () => {
    const mine = isMine(state.info.owner);
    const indexer = registry()?.source?.kind === "indexer";
    return `
      ${sectionHeader("Offers", mine ? "Accept one to sell the name for it." : null)}
      ${state.offers.length
        ? `<div class="km-card km-list">${state.offers.map((o) => offerRowHtml(o, { isBuyer: isMine(o.buyer), isOwner: mine && indexer })).join("")}</div>`
        : '<div class="km-card km-empty-card muted small">No open offers.</div>'}
      ${registry()?.source?.kind === "chain" ? '<p class="muted small kl-pad">Offers from others appear once a names indexer is connected.</p>' : ""}`;
  };

  const historySection = () => `
    ${sectionHeader("History")}
    ${state.history.length
      ? `<div class="km-card km-list">${state.history.slice(0, 50).map((e) => eventRowHtml(e)).join("")}</div>`
      : '<div class="km-card km-empty-card muted small">No history yet.</div>'}`;

  const paint = () => {
    const scroll = app.querySelector(".km")?.scrollTop || 0;
    render(`
      ${navHeader({ title: state.info.display })}
      <section class="km kl-detail">
        ${nameCard()}
        ${state.gone
          ? '<p class="muted small kl-pad">This name was released or reclaimed. It\'s free to claim again.</p>'
          : `${actionButtons()}
             ${ownerCard()}
             ${offersSection()}`}
        ${historySection()}
      </section>`, "kachat-name");
    app.dataset.kachatName = state.info.name;
    const scroller = app.querySelector(".km");
    if (scroller) scroller.scrollTop = scroll;
    $("#back").onclick = () => { unsubscribe(); onBack(); };
    const info = state.info;
    const on = (id, fn) => { const el = $(`#${id}`); if (el) el.onclick = fn; };
    on("kl-buy", () => openBuySheet(info));
    on("kl-offer", () => openOfferSheet(info.name, info));
    on("kl-renew", () => openRenewSheet(info));
    on("kl-list", () => openListSheet(info));
    on("kl-transfer", () => openTransferSheet(info));
    on("kl-reclaim", () => openReclaimSheet(info));
    on("kl-delist", () => openTxSheet({
      title: "Delist", confirmTitle: "Delist", doneTitle: "Delisted",
      rows: [{ title: "Name", value: info.display }, { title: "Listed at", value: amount(info.price) }],
      operation: () => Operation.list(info, 0n),
    }));
    on("kl-release", () => openTxSheet({
      title: "Release Name", confirmTitle: "Release", doneTitle: "Name released",
      warning: "Releasing gives the name up for good: it becomes free for anyone to register, and the time you paid for is lost. You get the bond and the registry deposit back.",
      rows: [{ title: "Name", value: info.display }],
      operation: () => Operation.release(info),
    }));
    on("kl-primary", setPrimary);
    bindOfferRows(app, state.offers, info);
  };

  // Setting a primary name rewrites the profile record: confirmed on the save sheet with its fee
  // (iOS 7e238e5).
  const setPrimary = () => openProfileSaveSheet({
    title: "Set as Primary", confirmTitle: "Set as Primary", doneTitle: "Primary name set",
    async makeProfile() {
      const rt = await runtime();
      const address = rt.actions.myAddress;
      let profile = null;
      if (address) {
        profile = (await rt.registry.ownProfile(address))?.profile ?? null;
        if (!profile) profile = (await rt.registry.identity(address).catch(() => null))?.profile ?? null;
      }
      profile = profile ?? new Profile();
      profile.primaryName = state.info.name;
      return profile;
    },
  });

  const reload = async () => {
    const reg = registry();
    try {
      const found = await reg.lookup(state.info.name);
      if (found.kind === "registered") { state.info = found.info; state.gone = false; } else state.gone = true;
    } catch { /* keep what we have */ }
    const owner = addressOf(state.info.owner);
    if (!isMine(state.info.owner) && owner) {
      try { state.ownerLabel = (await reg.identity(owner))?.label ?? null; } catch { /* no label */ }
    }
    state.offers = await reg.offersFor(state.info.name).catch(() => []);
    state.history = await reg.history(state.info.name).catch(() => []);
    if (state.offers.length) await (await runtime()).actions.refreshVirtualDaa().catch(() => {});
    if (here()) paint();
  };

  const unsubscribe = registry()?.onChange(() => { if (here()) reload(); }) ?? (() => {});
  paint();
  reload();
}

// --- Saving the profile record (iOS KachatProfileSaveSheet) --------------------------------

const PRIVACY_SEEN_KEY = "kachat_profile_privacy_seen";

/** "X · x.com/name", or "None". */
function sourceText(link, kind) {
  const s = link ? SocialSource.fromLink(link, kind) : null;
  return s ? `${SocialPlatform.displayName(s.platform)} · ${SocialPlatform.prefix(s.platform)}${s.displayHandle}` : "None";
}

/**
 * The confirmation every profile save shows - Edit .kachat Profile and Set as Primary: what will
 * be saved, the network fee (quoted by building the record as the save does, nothing sent) and
 * the chatting address's balance before and after; then the password, then the done sheet.
 *   makeProfile(): the record to save, built when the sheet opens
 *   onSaved(): after the done sheet closes
 */
export function openProfileSaveSheet({ title, confirmTitle, doneTitle, makeProfile, onSaved = () => {} }) {
  const state = { profile: null, fee: null, quoteError: null, balance: null, sending: false, sendError: null, done: false };
  let handle = null;
  let privacySeen = false;
  try { privacySeen = localStorage.getItem(PRIVACY_SEEN_KEY) === "1"; } catch { /* first time */ }

  const bodyHtml = () => {
    const p = state.profile;
    const profileRows = p ? `
      <div class="form-section">
        <div class="form-header">Your Profile</div>
        <div class="form-card">
          ${labeledRow("Avatar", sourceText(p.avatar, SocialKind.avatar))}
          ${labeledRow("Banner", sourceText(p.banner, SocialKind.banner))}
          ${labeledRow("Bio", sourceText(p.bio, SocialKind.bio))}
          ${labeledRow("Linktree", p.linktree ? p.linktree.replace("https://", "") : "None")}
          ${labeledRow("Primary name", p.primaryName ? `${p.primaryName}.kachat` : "None")}
        </div>
      </div>` : "";
    let cost = "";
    if (state.fee != null) {
      cost = labeledRow("Network fee", amount(state.fee));
      if (state.balance != null) {
        cost += labeledRow("Chatting address balance", amount(state.balance))
          + labeledRow("Balance after", amount(state.balance > state.fee ? state.balance - state.fee : 0n), true);
      }
    } else if (!state.quoteError) {
      cost = '<div class="form-row between"><span>Network fee</span><span class="spinner small-spin"></span></div>';
    }
    const foot = state.quoteError
      ? `<span class="error-text">${esc(state.quoteError)}</span>`
      : privacySeen
        ? "Saved on chain from your chatting address to itself."
        : "Profiles are public and on chain: anyone can read them, and earlier versions stay readable after you change them.";
    return `
      ${profileRows}
      <div class="form-section">
        ${cost ? `<div class="form-card">${cost}</div>` : ""}
        <div class="form-footer">${foot}</div>
      </div>
      <div class="form-section">
        <div class="form-card">
          <button class="form-row km-form-button" id="kl-save-profile" ${state.fee == null || !state.profile || state.sending || state.done ? "disabled" : ""}>
            ${state.sending ? '<span class="spinner small-spin"></span>' : esc(confirmTitle)}
          </button>
        </div>
        ${state.sendError ? `<div class="form-footer error-text">${esc(state.sendError)}</div>` : ""}
      </div>`;
  };

  const paint = () => {
    if (!handle?.isOpen()) return;
    const host = handle.panel.querySelector("[data-save]");
    host.innerHTML = unitText(bodyHtml());
    host.querySelector("#kl-save-profile")?.addEventListener("click", save);
  };

  async function save() {
    if (!state.profile || state.fee == null || state.sending) return;
    if (!(await confirmPassword())) return;
    state.sending = true;
    state.sendError = null;
    paint();
    try {
      const tx = await (await runtime()).actions.saveProfile(state.profile);
      try { localStorage.setItem(PRIVACY_SEEN_KEY, "1"); } catch { /* shown again next time */ }
      state.done = true;
      showTxDone({ txId: tx, title: doneTitle, onClose: () => { handle.close(); onSaved(); } });
    } catch (error) {
      state.sendError = errorText(error);
    }
    state.sending = false;
    paint();
  }

  handle = openPanel({ title, leading: "Cancel", full: true, stack: true, body: "<div data-save></div>" });
  paint();
  (async () => {
    try {
      state.profile = await makeProfile();
      paint();
      state.fee = await (await runtime()).actions.profileFee(state.profile);
    } catch (error) {
      state.quoteError = errorText(error);
    }
    paint();
  })();
  chattingBalance().then((balance) => { state.balance = balance; paint(); });
  return handle;
}

// --- Your Domains > .kachat (iOS KachatLiveDomainsTab) -------------------------------------

/** The tab's body for `address`: `{ html, bind(container, nav) }`, loading on its own. */
export function liveDomainsTab({ address, repaint }) {
  const cache = liveDomainsTab.cache || (liveDomainsTab.cache = new Map());
  const entry = cache.get(address) || { names: [], loaded: false, loading: false, revision: -1 };
  cache.set(address, entry);
  const reg = registry();
  // Loads when the registry changed since the last load (iOS .task(id: registry.revision)).
  if (reg && !entry.loading && entry.revision !== reg.revision) {
    entry.loading = true;
    (async () => {
      const key = KachatNamesRegistry.keyOf(String(address).toLowerCase());
      if (key) {
        try {
          await runtime().catch(() => null);
          if (reg.refreshedAt == null) await reg.refresh();
          entry.names = await reg.namesOf(key, { includeInactive: true });
        } catch { /* stays empty */ }
      }
      entry.revision = reg.revision;
      entry.loaded = true;
      entry.loading = false;
      repaint();
    })();
  }
  const badge = (n) => {
    const status = statusOf(n);
    if (status === Status.active) return n.isListed ? "Listed" : null;
    return status === Status.grace ? "Expired" : "Lapsed";
  };
  const html = !entry.loaded && !entry.names.length
    ? '<div class="center-text"><span class="spinner"></span></div>'
    : !entry.names.length
      ? `<div class="kachat-coming">
          <span class="accent">${ICONS.atCircle}</span>
          <h3>No .kachat names yet</h3>
          <p class="muted small">Claim one in .kachat Marketplace, on your Profile.</p>
        </div>`
      : entry.names.map((n) => `
          <button class="domain-button" data-kachat-name="${esc(n.name)}" aria-label="${esc(n.display)}">
            <div class="domain-card"><span class="domain-name">${esc(n.display)}</span>${badge(n) ? `<span class="domain-badge">${esc(badge(n))}</span>` : ""}</div>
          </button>`).join("");
  return {
    html,
    bind(container, nav) {
      for (const b of container.querySelectorAll("[data-kachat-name]")) {
        b.onclick = () => {
          const info = entry.names.find((n) => n.name === b.dataset.kachatName);
          if (info) nav.openName(info);
        };
      }
    },
  };
}
